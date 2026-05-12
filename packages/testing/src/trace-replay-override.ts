/**
 * Trace replay with variable substitution (O4).
 *
 * Re-executes a recorded set of LLM interactions with one or more
 * parameters overridden — typically "what if we switched this prompt
 * from gpt-4o to claude-haiku-4-5?", or "what if we lowered temperature
 * from 0.7 to 0.0?".
 *
 * Returns a side-by-side report comparing every recorded entry with
 * the fresh response under the override. The runner is provided by
 * the user — replay does not call any provider directly.
 */

import type { CompletionRequest, LLMResponse } from '@elsium-ai/core'
import type { ReplayEntry } from './replay'

// ─── Override shape ─────────────────────────────────────────────

export interface TraceOverride {
	readonly model?: string
	/** New system prompt, or a transformer over the original. */
	readonly system?: string | ((original?: string) => string)
	readonly temperature?: number
	readonly maxTokens?: number
	readonly topP?: number
	readonly topK?: number
	readonly seed?: number
	/** Replace tool list entirely (rare but useful). */
	readonly tools?: CompletionRequest['tools']
}

// ─── Per-entry comparison ──────────────────────────────────────

export interface OverrideEntryComparison {
	readonly originalRequest: CompletionRequest
	readonly overriddenRequest: CompletionRequest
	readonly originalResponse: LLMResponse
	readonly currentResponse: LLMResponse
	readonly delta: {
		readonly inputTokens: number
		readonly outputTokens: number
		readonly totalTokens: number
		readonly cost: number
		readonly latencyMs: number
		readonly contentChanged: boolean
	}
}

export interface OverrideReport {
	readonly entries: readonly OverrideEntryComparison[]
	readonly totals: {
		readonly original: {
			readonly tokens: number
			readonly cost: number
			readonly latencyMs: number
		}
		readonly current: { readonly tokens: number; readonly cost: number; readonly latencyMs: number }
		readonly delta: { readonly tokens: number; readonly cost: number; readonly latencyMs: number }
	}
}

// ─── Application ───────────────────────────────────────────────

export function applyOverride(
	request: CompletionRequest,
	override: TraceOverride,
): CompletionRequest {
	const system =
		typeof override.system === 'function' ? override.system(request.system) : override.system
	const out: CompletionRequest = {
		...request,
		// Only set fields that are explicitly overridden (preserve other request shape).
		model: override.model ?? request.model,
		system: system ?? request.system,
		temperature: override.temperature ?? request.temperature,
		maxTokens: override.maxTokens ?? request.maxTokens,
		topP: override.topP ?? request.topP,
		seed: override.seed ?? request.seed,
		tools: override.tools ?? request.tools,
	}
	// `topK` is not in the framework's CompletionRequest type; if the underlying
	// provider supports it, the user can include it via metadata.
	if (override.topK !== undefined) {
		out.metadata = { ...(request.metadata ?? {}), topK: override.topK }
	}
	return out
}

function responseTextOf(r: LLMResponse): string {
	if (typeof r.message.content === 'string') return r.message.content
	return r.message.content
		.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
		.map((p) => p.text)
		.join('')
}

export async function replayWithOverride(
	entries: readonly ReplayEntry[],
	override: TraceOverride,
	runner: (request: CompletionRequest) => Promise<LLMResponse>,
): Promise<OverrideReport> {
	const perEntry = await Promise.all(
		entries.map(async (e) => {
			const overridden = applyOverride(e.request, override)
			const current = await runner(overridden)
			const origText = responseTextOf(e.response)
			const curText = responseTextOf(current)
			return {
				originalRequest: e.request,
				overriddenRequest: overridden,
				originalResponse: e.response,
				currentResponse: current,
				delta: {
					inputTokens: current.usage.inputTokens - e.response.usage.inputTokens,
					outputTokens: current.usage.outputTokens - e.response.usage.outputTokens,
					totalTokens: current.usage.totalTokens - e.response.usage.totalTokens,
					cost: current.cost.totalCost - e.response.cost.totalCost,
					latencyMs: current.latencyMs - e.response.latencyMs,
					contentChanged: origText !== curText,
				},
			}
		}),
	)

	const totalsOriginal = entries.reduce(
		(acc, e) => ({
			tokens: acc.tokens + e.response.usage.totalTokens,
			cost: acc.cost + e.response.cost.totalCost,
			latencyMs: acc.latencyMs + e.response.latencyMs,
		}),
		{ tokens: 0, cost: 0, latencyMs: 0 },
	)
	const totalsCurrent = perEntry.reduce(
		(acc, e) => ({
			tokens: acc.tokens + e.currentResponse.usage.totalTokens,
			cost: acc.cost + e.currentResponse.cost.totalCost,
			latencyMs: acc.latencyMs + e.currentResponse.latencyMs,
		}),
		{ tokens: 0, cost: 0, latencyMs: 0 },
	)

	return {
		entries: perEntry,
		totals: {
			original: totalsOriginal,
			current: totalsCurrent,
			delta: {
				tokens: totalsCurrent.tokens - totalsOriginal.tokens,
				cost: totalsCurrent.cost - totalsOriginal.cost,
				latencyMs: totalsCurrent.latencyMs - totalsOriginal.latencyMs,
			},
		},
	}
}
