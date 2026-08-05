import {
	type FlowPolicy,
	type LabelInit,
	type TaintLabel,
	createLabel,
	emptyLabel,
	joinLabels,
} from '@elsium-ai/core'
import type { ExecutionProof, ProofEvent } from '../proof/types'
import type { PolicyProbe, SimulatedDecision } from './types'

export interface FlowProbeOptions {
	policy: FlowPolicy
	/**
	 * Assign sensitivity classes to a recorded event.
	 *
	 * Necessary because proofs store hashes, not content — by design, so a
	 * proof can be shared without leaking what it processed. Classification
	 * therefore has to come from outside: from the event's own metadata, from
	 * the tool name, or from a lookup the operator controls.
	 *
	 * Return `undefined` to keep the default for that event kind.
	 */
	classify?: (event: ProofEvent) => LabelInit | undefined
	/**
	 * Label the context starts with — an agent that already holds a credential
	 * before it reads anything.
	 */
	initial?: TaintLabel
}

interface EventShape {
	tool?: string
	provider?: string
	model?: string
	docs?: Array<{ id?: string }>
	store?: string
}

function shapeOf(event: ProofEvent): EventShape {
	return event.data as EventShape
}

/**
 * Default provenance per event kind, mirroring the live enforcement points:
 * retrieved documents and tool results are untrusted, model output is `model`.
 */
function defaultLabel(event: ProofEvent): LabelInit | undefined {
	const shape = shapeOf(event)

	switch (event.type) {
		case 'rag.retrieve':
			return {
				origin: 'untrusted',
				sources: (shape.docs ?? []).map((d) => `doc:${d.id ?? 'unknown'}`),
			}
		case 'tool.call':
			return { origin: 'untrusted', source: `tool:${shape.tool ?? 'unknown'}` }
		case 'llm.call':
			return { origin: 'model', source: `llm:${shape.provider ?? shape.model ?? 'unknown'}` }
		case 'agent.input':
			return { origin: 'untrusted', source: 'agent.input' }
		default:
			return undefined
	}
}

/** The sink an event flows to, or undefined when it is not an egress point. */
function sinkOf(event: ProofEvent): string | undefined {
	const shape = shapeOf(event)
	switch (event.type) {
		case 'tool.call':
			return `tool:${shape.tool ?? 'unknown'}`
		case 'llm.call':
			return `llm:${shape.provider ?? shape.model ?? 'unknown'}`
		default:
			return undefined
	}
}

/**
 * Replay information flow over a recorded run.
 *
 * Walks the events in order, accumulating provenance exactly as the live
 * tracker would, and checks each sink against the policy at the point it was
 * reached. Order matters: a tool is checked *before* its own output joins the
 * context, or every tool would appear to taint itself.
 */
export function flowPolicyProbe(options: FlowProbeOptions): PolicyProbe {
	const { policy, classify } = options

	return (trace: ExecutionProof): SimulatedDecision[] => {
		let label: TaintLabel = options.initial ?? emptyLabel()
		const decisions: SimulatedDecision[] = []

		for (const event of trace.events) {
			const sink = sinkOf(event)

			if (sink) {
				const decision = policy.check(sink, label)
				decisions.push({
					allowed: decision.allowed,
					traceId: trace.proofId,
					sequence: event.sequence,
					subject: sink,
					rule: decision.rule,
					reason: decision.reason,
				})
			}

			const init = classify?.(event) ?? defaultLabel(event)
			if (init) label = joinLabels(label, createLabel(init))
		}

		return decisions
	}
}
