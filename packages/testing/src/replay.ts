import { createHash } from 'node:crypto'
import type { CompletionRequest, LLMResponse } from '@elsium-ai/core'

export type ReplayMatchStrategy = 'sequential' | 'hash'

export interface ReplayEntry {
	request: CompletionRequest
	response: LLMResponse
	timestamp: number
}

export interface ReplayRecorder {
	wrap(
		completeFn: (req: CompletionRequest) => Promise<LLMResponse>,
	): (req: CompletionRequest) => Promise<LLMResponse>
	getEntries(): ReplayEntry[]
	toJSON(): string
	clear(): void
}

export interface ReplayPlayer {
	complete(request: CompletionRequest): Promise<LLMResponse>
	readonly remaining: number
}

export interface ReplayPlayerOptions {
	/**
	 * Matching strategy:
	 * - `'sequential'` (default): return entries in record order, ignoring
	 *   request content. Backwards-compatible with v0.12.x and earlier.
	 *   Brittle to reorderings between record and replay.
	 * - `'hash'`: compute a stable SHA-256 over the request shape (model,
	 *   messages, system, tool names, JSON-mode flags) and return the first
	 *   entry whose request hashes to the same value. Order-independent and
	 *   safe when the same request can appear more than once — each match
	 *   advances a per-hash cursor.
	 */
	strategy?: ReplayMatchStrategy
}

export function createReplayRecorder(): ReplayRecorder {
	const entries: ReplayEntry[] = []

	return {
		wrap(
			completeFn: (req: CompletionRequest) => Promise<LLMResponse>,
		): (req: CompletionRequest) => Promise<LLMResponse> {
			return async (request: CompletionRequest): Promise<LLMResponse> => {
				const response = await completeFn(request)
				entries.push({
					request,
					response,
					timestamp: Date.now(),
				})
				return response
			}
		},

		getEntries(): ReplayEntry[] {
			return [...entries]
		},

		toJSON(): string {
			return JSON.stringify(entries, null, 2)
		},

		clear(): void {
			entries.length = 0
		},
	}
}

/**
 * Stable canonical form of a CompletionRequest for hashing. Includes only
 * the fields that affect the semantic identity of the request — not
 * runtime/cosmetic fields like `signal` or `stream`.
 */
function canonicalRequest(req: CompletionRequest): string {
	const canonical = {
		model: req.model ?? null,
		system: req.system ?? null,
		maxTokens: req.maxTokens ?? null,
		temperature: req.temperature ?? null,
		seed: req.seed ?? null,
		topP: req.topP ?? null,
		stopSequences: req.stopSequences ?? null,
		toolNames: (req.tools ?? []).map((t) => t.name).sort(),
		hasSchema: req.schema !== undefined,
		messages: req.messages.map((m) => ({
			role: m.role,
			content: m.content,
			toolCallId: 'toolCallId' in m ? m.toolCallId : undefined,
			toolCalls: 'toolCalls' in m ? m.toolCalls : undefined,
			name: 'name' in m ? m.name : undefined,
		})),
	}
	return JSON.stringify(canonical)
}

export function hashRequest(req: CompletionRequest): string {
	return createHash('sha256').update(canonicalRequest(req)).digest('hex')
}

export function createReplayPlayer(
	entriesOrJson: ReplayEntry[] | string,
	options: ReplayPlayerOptions = {},
): ReplayPlayer {
	const entries =
		typeof entriesOrJson === 'string'
			? (JSON.parse(entriesOrJson) as ReplayEntry[])
			: [...entriesOrJson]
	const strategy = options.strategy ?? 'sequential'
	let index = 0
	// For 'hash' strategy: track per-hash cursor so repeat requests advance
	// through their recorded responses in order.
	const hashCursors = new Map<string, number>()

	return {
		get remaining() {
			if (strategy === 'sequential') return entries.length - index
			let consumed = 0
			for (const cursor of hashCursors.values()) consumed += cursor
			return entries.length - consumed
		},

		async complete(request: CompletionRequest): Promise<LLMResponse> {
			if (strategy === 'sequential') {
				if (index >= entries.length) {
					throw new Error('Replay exhausted: no more recorded responses')
				}
				const entry = entries[index]
				index++
				return entry.response
			}

			// hash strategy
			const target = hashRequest(request)
			let seen = 0
			const cursor = hashCursors.get(target) ?? 0
			for (const entry of entries) {
				if (hashRequest(entry.request) !== target) continue
				if (seen === cursor) {
					hashCursors.set(target, cursor + 1)
					return entry.response
				}
				seen++
			}
			throw new Error(
				`Replay miss for request hash ${target.slice(0, 12)}…: no recorded response matches`,
			)
		},
	}
}
