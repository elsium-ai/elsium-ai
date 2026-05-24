import type { ExecutionProof, ProofEvent, ProofEventType } from './types'

export type ReplayStrategy = 'bit-exact' | 'structural'

export type EventDeltaKind =
	| 'missing-in-b'
	| 'extra-in-b'
	| 'type-mismatch'
	| 'hash-mismatch'
	| 'data-mismatch'

export interface EventDelta {
	index: number
	kind: EventDeltaKind
	eventA?: ProofEvent
	eventB?: ProofEvent
	detail?: string
}

export interface ReplayDiff {
	matches: boolean
	strategy: ReplayStrategy
	agentIdMatch: boolean
	agentVersionMatch: boolean
	eventCountA: number
	eventCountB: number
	chainHeadMatch: boolean
	deltas: EventDelta[]
	summary: {
		matchedEvents: number
		differingEvents: number
		extraInA: number
		extraInB: number
	}
}

const STRUCTURAL_NON_DETERMINISTIC_TYPES: ReadonlySet<ProofEventType> = new Set([
	'llm.call',
	'agent.input',
	'agent.output',
	'custom',
])

function isStructuralIgnored(type: ProofEventType): boolean {
	return STRUCTURAL_NON_DETERMINISTIC_TYPES.has(type)
}

function structuralLLMSubset(data: Record<string, unknown>): {
	model?: unknown
	provider?: unknown
} {
	return { model: data.model, provider: data.provider }
}

function compareEventBitExact(a: ProofEvent, b: ProofEvent, index: number): EventDelta | null {
	if (a.type !== b.type) {
		return {
			index,
			kind: 'type-mismatch',
			eventA: a,
			eventB: b,
			detail: `expected ${a.type}, got ${b.type}`,
		}
	}
	if (a.hashSelf !== b.hashSelf) {
		return {
			index,
			kind: 'hash-mismatch',
			eventA: a,
			eventB: b,
			detail: 'hashSelf differs',
		}
	}
	return null
}

function compareEventStructural(a: ProofEvent, b: ProofEvent, index: number): EventDelta | null {
	if (a.type !== b.type) {
		return {
			index,
			kind: 'type-mismatch',
			eventA: a,
			eventB: b,
			detail: `expected ${a.type}, got ${b.type}`,
		}
	}

	if (a.type === 'llm.call') {
		const subA = structuralLLMSubset(a.data)
		const subB = structuralLLMSubset(b.data)
		if (subA.model !== subB.model || subA.provider !== subB.provider) {
			return {
				index,
				kind: 'data-mismatch',
				eventA: a,
				eventB: b,
				detail: 'llm.call model or provider differs',
			}
		}
		return null
	}

	if (isStructuralIgnored(a.type)) return null

	if (JSON.stringify(a.data) !== JSON.stringify(b.data)) {
		return {
			index,
			kind: 'data-mismatch',
			eventA: a,
			eventB: b,
			detail: `${a.type} data differs`,
		}
	}

	return null
}

export function compareProofs(
	proofA: ExecutionProof,
	proofB: ExecutionProof,
	options: { strategy?: ReplayStrategy } = {},
): ReplayDiff {
	const strategy: ReplayStrategy = options.strategy ?? 'structural'
	const deltas: EventDelta[] = []

	const eventCountA = proofA.events.length
	const eventCountB = proofB.events.length
	const minLen = Math.min(eventCountA, eventCountB)

	for (let i = 0; i < minLen; i++) {
		const a = proofA.events[i]
		const b = proofB.events[i]
		const delta =
			strategy === 'bit-exact' ? compareEventBitExact(a, b, i) : compareEventStructural(a, b, i)
		if (delta) deltas.push(delta)
	}

	for (let i = minLen; i < eventCountA; i++) {
		deltas.push({ index: i, kind: 'missing-in-b', eventA: proofA.events[i] })
	}
	for (let i = minLen; i < eventCountB; i++) {
		deltas.push({ index: i, kind: 'extra-in-b', eventB: proofB.events[i] })
	}

	const extraInA = deltas.filter((d) => d.kind === 'missing-in-b').length
	const extraInB = deltas.filter((d) => d.kind === 'extra-in-b').length
	const differingEvents = deltas.length - extraInA - extraInB
	const matchedEvents = minLen - differingEvents
	const chainHeadMatch = proofA.chainHead === proofB.chainHead
	const matches = deltas.length === 0 && (strategy === 'structural' || chainHeadMatch)

	return {
		matches,
		strategy,
		agentIdMatch: proofA.agentId === proofB.agentId,
		agentVersionMatch: proofA.agentVersion === proofB.agentVersion,
		eventCountA,
		eventCountB,
		chainHeadMatch,
		deltas,
		summary: { matchedEvents, differingEvents, extraInA, extraInB },
	}
}
