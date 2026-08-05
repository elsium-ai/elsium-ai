import {
	type CapabilityCheckResult,
	type CapabilityToken,
	canCallLLM,
	canCallTool,
	canQueryRag,
} from '@elsium-ai/core'
import type { ExecutionProof, ProofEvent } from '../proof/types'
import type { PolicyProbe, SimulatedDecision } from './types'

export interface CapabilityProbeOptions {
	token: CapabilityToken
	/**
	 * Data classes to present on tool checks, when the token constrains them.
	 * Proofs record hashes rather than content, so classification comes from
	 * the operator — same reasoning as the flow probe.
	 */
	dataClasses?: string[]
}

interface EventShape {
	tool?: string
	provider?: string
	model?: string
	store?: string
	/** Recorded by the proof, so token budgets can be checked against real usage. */
	totalTokens?: number
	docs?: unknown[]
}

/**
 * Replay a capability token over a recorded run.
 *
 * Answers a question nobody could ask before minting one: *would this token
 * have allowed what the agent actually did?* Scope a token too tightly and the
 * agent breaks in production; too loosely and the token is decoration. Both
 * mistakes were previously only discoverable by shipping.
 *
 * Complements the flow probe rather than duplicating it. A capability check
 * asks whether the caller is permitted; a flow check asks whether the data
 * may travel. A run can pass one and fail the other, which is exactly why both
 * exist — and why simulating only one of them tells half the story.
 */
export function capabilityProbe(options: CapabilityProbeOptions): PolicyProbe {
	const { token, dataClasses } = options

	const check = (
		event: ProofEvent,
	): { subject: string; result: CapabilityCheckResult } | undefined => {
		const shape = event.data as EventShape

		switch (event.type) {
			case 'tool.call': {
				const tool = shape.tool ?? 'unknown'
				return {
					subject: `tool:${tool}`,
					result: canCallTool(token, tool, { dataClasses }),
				}
			}
			case 'llm.call': {
				const model = shape.model ?? 'unknown'
				return {
					subject: `llm:${shape.provider ?? model}`,
					// The proof recorded actual token usage, so a token whose
					// budget is too small shows up here rather than in production.
					result: canCallLLM(token, {
						model,
						provider: shape.provider,
						estimatedTokens: shape.totalTokens,
					}),
				}
			}
			case 'rag.retrieve': {
				const store = shape.store ?? 'unknown'
				return {
					subject: `rag:${store}`,
					result: canQueryRag(token, { store, resultCount: shape.docs?.length }),
				}
			}
			default:
				return undefined
		}
	}

	return (trace: ExecutionProof): SimulatedDecision[] => {
		const decisions: SimulatedDecision[] = []

		for (const event of trace.events) {
			const checked = check(event)
			if (!checked) continue

			decisions.push({
				allowed: checked.result.allowed,
				traceId: trace.proofId,
				sequence: event.sequence,
				subject: checked.subject,
				rule: checked.result.allowed ? undefined : (checked.result.reason ?? 'denied'),
				reason: checked.result.detail,
			})
		}

		return decisions
	}
}
