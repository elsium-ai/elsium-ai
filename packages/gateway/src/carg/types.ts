import type { CompletionRequest, LLMResponse } from '@elsium-ai/core'

export interface Tier {
	name: string
	provider: string
	model: string
	maxDifficulty?: number
}

export interface RequestClassification {
	difficulty: number
	domain?: string
	reason?: string
}

export interface LLMClassifier {
	readonly name: string
	classify(request: CompletionRequest): Promise<RequestClassification> | RequestClassification
}

export type CascadeReason =
	| 'provider-error'
	| 'validator-failed'
	| 'low-confidence'
	| 'difficulty-cap-exceeded'

export interface ValidatorCheckResult {
	valid: boolean
	reason?: string
	detail?: Record<string, unknown>
}

export interface ConfidenceCheckResult {
	ok: boolean
	confidence: number
	reason?: string
}

export type CascadeValidator = (
	response: LLMResponse,
	request: CompletionRequest,
) => Promise<ValidatorCheckResult> | ValidatorCheckResult

export type CascadeConfidenceCheck = (
	response: LLMResponse,
	request: CompletionRequest,
) => Promise<ConfidenceCheckResult> | ConfidenceCheckResult

export interface EscalateOnFailureConfig {
	onProviderError?: boolean
	validator?: CascadeValidator
	confidence?: CascadeConfidenceCheck
	maxEscalations?: number
}

export interface CascadeAuditEvent {
	type: 'tier-attempt' | 'tier-escalation' | 'cascade-success' | 'cascade-exhausted'
	tier: string
	attemptIndex: number
	reason?: CascadeReason
	detail?: string
}

export interface CascadeRouterConfig {
	tiers: Tier[]
	classifier?: LLMClassifier
	escalateOnFailure?: boolean | EscalateOnFailureConfig
	onAudit?: (event: CascadeAuditEvent) => void
}

export interface CascadeAttempt {
	tier: string
	provider: string
	model: string
	status: 'ok' | 'failed' | 'validation-failed' | 'low-confidence' | 'skipped-by-classifier'
	error?: string
	confidence?: number
	validatorReason?: string
	cost?: number
	latencyMs?: number
}

export interface CascadeResult {
	response: LLMResponse
	tier: string
	totalCost: number
	totalLatencyMs: number
	attempts: CascadeAttempt[]
	classification?: RequestClassification
}

export class CascadeExhaustedError extends Error {
	readonly attempts: CascadeAttempt[]
	readonly classification?: RequestClassification

	constructor(attempts: CascadeAttempt[], classification?: RequestClassification) {
		const last = attempts[attempts.length - 1]
		super(
			`cascade router exhausted ${attempts.length} tier(s) without a successful response (last: ${last?.tier} → ${last?.status})`,
		)
		this.name = 'CascadeExhaustedError'
		this.attempts = attempts
		this.classification = classification
	}
}
