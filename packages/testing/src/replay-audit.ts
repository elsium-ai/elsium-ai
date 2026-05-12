/**
 * Audit-grade signed replay + streaming replay (R5).
 *
 * Extends the basic replay recorder/player with two production-ready
 * capabilities:
 *  1. HMAC-SHA256 hash chain on the recorded entries. Same pattern as
 *     audit.ts. A tampered or reordered entry detaches the chain,
 *     verifyReplay returns invalid with the offending entry index.
 *  2. Streaming replay: record + replay StreamEvent sequences (not just
 *     complete() responses), so tests that depend on token-level
 *     streaming can be deterministic too.
 *
 * The signature is HMAC over the canonical JSON of each entry plus the
 * previous entry's signature. The secret is the user's responsibility —
 * stored outside the replay file, in env or secret manager. A replay
 * file without its secret is just data; with the secret it is evidence.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import {
	type CompletionRequest,
	ElsiumError,
	type LLMResponse,
	type StreamEvent,
} from '@elsium-ai/core'
import type { ReplayEntry } from './replay'

// ─── Signed envelope ────────────────────────────────────────────

export interface SignedReplayEntry {
	readonly entry: ReplayEntry
	readonly previousSignature: string
	readonly signature: string
}

export interface SignedReplayFile {
	readonly apiVersion: 'elsium.replay/v1'
	readonly algorithm: 'hmac-sha256'
	readonly entries: readonly SignedReplayEntry[]
}

const ZERO_SIG = '0'.repeat(64)

function stableStringify(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value)
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
	const keys = Object.keys(value as Record<string, unknown>).sort()
	const pairs = keys.map(
		(k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`,
	)
	return `{${pairs.join(',')}}`
}

function signEntry(entry: ReplayEntry, previousSignature: string, secret: string): string {
	const payload = `${previousSignature}|${stableStringify(entry)}`
	return createHmac('sha256', secret).update(payload).digest('hex')
}

// ─── Signed recorder / player ──────────────────────────────────

export interface SignedReplayRecorder {
	wrap(
		completeFn: (req: CompletionRequest) => Promise<LLMResponse>,
	): (req: CompletionRequest) => Promise<LLMResponse>
	export(): SignedReplayFile
	toJSON(): string
	clear(): void
}

export interface SignedReplayRecorderConfig {
	readonly secret: string
}

export function createSignedReplayRecorder(
	config: SignedReplayRecorderConfig,
): SignedReplayRecorder {
	if (config.secret.length < 16) {
		throw ElsiumError.validation(
			'SignedReplayRecorder: secret must be at least 16 characters for HMAC strength',
		)
	}
	const signed: SignedReplayEntry[] = []
	let lastSig: string = ZERO_SIG

	return {
		wrap(completeFn) {
			return async (request: CompletionRequest): Promise<LLMResponse> => {
				const response = await completeFn(request)
				const entry: ReplayEntry = { request, response, timestamp: Date.now() }
				const previousSignature = lastSig
				const signature = signEntry(entry, previousSignature, config.secret)
				signed.push({ entry, previousSignature, signature })
				lastSig = signature
				return response
			}
		},

		export(): SignedReplayFile {
			return {
				apiVersion: 'elsium.replay/v1',
				algorithm: 'hmac-sha256',
				entries: [...signed],
			}
		},

		toJSON(): string {
			return JSON.stringify(
				{
					apiVersion: 'elsium.replay/v1',
					algorithm: 'hmac-sha256',
					entries: signed,
				},
				null,
				2,
			)
		},

		clear(): void {
			signed.length = 0
			lastSig = ZERO_SIG
		},
	}
}

// ─── Verification ──────────────────────────────────────────────

export interface ReplayVerification {
	readonly valid: boolean
	readonly entryCount: number
	readonly invalidAtIndex?: number
	readonly reason?: string
}

export function verifyReplay(
	fileOrJson: SignedReplayFile | string,
	secret: string,
): ReplayVerification {
	let file: SignedReplayFile
	try {
		file =
			typeof fileOrJson === 'string' ? (JSON.parse(fileOrJson) as SignedReplayFile) : fileOrJson
	} catch (err) {
		return {
			valid: false,
			entryCount: 0,
			invalidAtIndex: 0,
			reason: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
		}
	}

	if (file.apiVersion !== 'elsium.replay/v1') {
		return {
			valid: false,
			entryCount: file.entries?.length ?? 0,
			reason: `Unsupported apiVersion: ${file.apiVersion}`,
		}
	}
	if (file.algorithm !== 'hmac-sha256') {
		return {
			valid: false,
			entryCount: file.entries.length,
			reason: `Unsupported algorithm: ${file.algorithm}`,
		}
	}

	let expectedPrev: string = ZERO_SIG
	for (let i = 0; i < file.entries.length; i++) {
		const e = file.entries[i]
		if (e.previousSignature !== expectedPrev) {
			return {
				valid: false,
				entryCount: file.entries.length,
				invalidAtIndex: i,
				reason: `Entry ${i}: previousSignature mismatch (chain broken)`,
			}
		}
		const expected = signEntry(e.entry, e.previousSignature, secret)
		const actualBuf = Buffer.from(e.signature, 'hex')
		const expectedBuf = Buffer.from(expected, 'hex')
		if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) {
			return {
				valid: false,
				entryCount: file.entries.length,
				invalidAtIndex: i,
				reason: `Entry ${i}: signature mismatch (entry tampered or wrong secret)`,
			}
		}
		expectedPrev = e.signature
	}

	return { valid: true, entryCount: file.entries.length }
}

// ─── Signed player (replay with integrity gate) ─────────────────

export interface SignedReplayPlayer {
	complete(request: CompletionRequest): Promise<LLMResponse>
	readonly remaining: number
	readonly verification: ReplayVerification
}

export interface SignedReplayPlayerOptions {
	readonly secret: string
	/** If true (default), refuse to play back when verification fails. */
	readonly strict?: boolean
}

export function createSignedReplayPlayer(
	fileOrJson: SignedReplayFile | string,
	options: SignedReplayPlayerOptions,
): SignedReplayPlayer {
	const verification = verifyReplay(fileOrJson, options.secret)
	const strict = options.strict !== false
	if (!verification.valid && strict) {
		throw ElsiumError.validation(
			`SignedReplayPlayer: replay verification failed — ${verification.reason}`,
		)
	}

	const file: SignedReplayFile =
		typeof fileOrJson === 'string' ? (JSON.parse(fileOrJson) as SignedReplayFile) : fileOrJson
	let index = 0

	return {
		verification,

		get remaining() {
			return file.entries.length - index
		},

		async complete(_request: CompletionRequest): Promise<LLMResponse> {
			if (index >= file.entries.length) {
				throw new Error('Replay exhausted: no more recorded responses')
			}
			const entry = file.entries[index]
			index++
			return entry.entry.response
		},
	}
}

// ─── Streaming replay ───────────────────────────────────────────

export interface StreamReplayEntry {
	readonly request: CompletionRequest
	readonly events: readonly StreamEvent[]
	readonly timestamp: number
}

export interface StreamReplayRecorder {
	wrap(
		streamFn: (req: CompletionRequest) => AsyncIterable<StreamEvent>,
	): (req: CompletionRequest) => AsyncIterable<StreamEvent>
	getEntries(): readonly StreamReplayEntry[]
	toJSON(): string
	clear(): void
}

export function createStreamReplayRecorder(): StreamReplayRecorder {
	const entries: StreamReplayEntry[] = []

	return {
		wrap(streamFn) {
			return function wrapped(request: CompletionRequest): AsyncIterable<StreamEvent> {
				const captured: StreamEvent[] = []
				const source = streamFn(request)
				return {
					async *[Symbol.asyncIterator]() {
						for await (const event of source) {
							captured.push(event)
							yield event
						}
						entries.push({ request, events: captured, timestamp: Date.now() })
					},
				}
			}
		},

		getEntries(): readonly StreamReplayEntry[] {
			return entries.map((e) => ({ ...e, events: [...e.events] }))
		},

		toJSON(): string {
			return JSON.stringify(entries, null, 2)
		},

		clear(): void {
			entries.length = 0
		},
	}
}

export interface StreamReplayPlayer {
	stream(request: CompletionRequest): AsyncIterable<StreamEvent>
	readonly remaining: number
}

export function createStreamReplayPlayer(
	entriesOrJson: readonly StreamReplayEntry[] | string,
): StreamReplayPlayer {
	const entries: StreamReplayEntry[] =
		typeof entriesOrJson === 'string'
			? (JSON.parse(entriesOrJson) as StreamReplayEntry[])
			: [...entriesOrJson]
	let index = 0

	return {
		get remaining() {
			return entries.length - index
		},

		stream(_request: CompletionRequest): AsyncIterable<StreamEvent> {
			if (index >= entries.length) {
				return {
					// biome-ignore lint/correctness/useYield: empty iterator after exhaustion
					async *[Symbol.asyncIterator]() {
						throw new Error('Stream replay exhausted: no more recorded sequences')
					},
				}
			}
			const entry = entries[index]
			index++
			return {
				async *[Symbol.asyncIterator]() {
					for (const event of entry.events) {
						yield event
					}
				},
			}
		},
	}
}
