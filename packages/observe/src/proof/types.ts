import type { Signature } from '@elsium-ai/core'

export type ProofEventType =
	| 'agent.input'
	| 'agent.output'
	| 'llm.call'
	| 'tool.call'
	| 'rag.retrieve'
	| 'policy.evaluated'
	| 'custom'

export interface ProofEvent {
	sequence: number
	type: ProofEventType
	timestamp: number
	data: Record<string, unknown>
	hashPrev: string
	hashSelf: string
}

export interface ReproducibilityHints {
	seeds?: Record<string, number>
	modelVersions?: Record<string, string>
	toolVersions?: Record<string, string>
}

export interface ExecutionProof {
	version: 'elsium-proof/v1'
	proofId: string
	agentId: string
	agentVersion?: string
	startedAt: string
	endedAt: string
	events: ProofEvent[]
	chainHead: string
	signature: Signature
	reproducibility?: ReproducibilityHints
}

export interface VerifyProofResult {
	valid: boolean
	signatureValid: boolean
	chainValid: boolean
	chainBrokenAt?: number
	reason?: string
}

export interface ProofInputDocRef {
	id: string
	title?: string
	score?: number
	uri?: string
}

export interface LLMCallSummary {
	model: string
	provider?: string
	requestHash: string
	responseHash: string
	inputTokens?: number
	outputTokens?: number
	totalTokens?: number
	latencyMs?: number
	stopReason?: string
}

export interface ToolCallSummary {
	tool: string
	inputHash: string
	outputHash: string
	isError?: boolean
	latencyMs?: number
}

export interface RagRetrieveSummary {
	store?: string
	query?: string
	docs: ProofInputDocRef[]
}

export interface PolicyDecisionSummary {
	rule: string
	result: 'allow' | 'deny'
	reason?: string
}
