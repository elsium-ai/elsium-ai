import type { CompletionRequest, LLMResponse } from '@elsium-ai/core'
import { ElsiumError } from '@elsium-ai/core'
import { type Gateway, gateway } from '../gateway'
import {
	type CascadeAttempt,
	type CascadeAuditEvent,
	CascadeExhaustedError,
	type CascadeReason,
	type CascadeResult,
	type CascadeRouterConfig,
	type EscalateOnFailureConfig,
	type RequestClassification,
	type Tier,
} from './types'

const DEFAULT_ESCALATE: EscalateOnFailureConfig = { onProviderError: true }

function normalizeEscalate(
	value: boolean | EscalateOnFailureConfig | undefined,
): EscalateOnFailureConfig | null {
	if (value === false || value === undefined) return null
	if (value === true) return { ...DEFAULT_ESCALATE }
	return { onProviderError: true, ...value }
}

export interface CascadeRouter {
	complete(request: CompletionRequest): Promise<CascadeResult>
	readonly tiers: ReadonlyArray<Tier>
}

export interface CascadeRouterDependencies {
	makeGateway?: (tier: Tier) => Gateway
}

function defaultGatewayFactory(tier: Tier, apiKeys: Record<string, string>): Gateway {
	const apiKey = apiKeys[tier.provider]
	if (!apiKey) {
		throw new ElsiumError({
			code: 'CONFIG_ERROR',
			message: `cascade router: missing apiKey for provider "${tier.provider}"`,
			retryable: false,
		})
	}
	return gateway({ provider: tier.provider, apiKey, model: tier.model })
}

export interface CascadeRouterFactoryOptions extends CascadeRouterDependencies {
	apiKeys?: Record<string, string>
}

function buildGateways(tiers: Tier[], options: CascadeRouterFactoryOptions): Map<string, Gateway> {
	const factory =
		options.makeGateway ?? ((tier: Tier) => defaultGatewayFactory(tier, options.apiKeys ?? {}))
	const result = new Map<string, Gateway>()
	for (const tier of tiers) {
		const key = `${tier.provider}::${tier.model}`
		if (!result.has(key)) result.set(key, factory(tier))
	}
	return result
}

async function classifyRequest(
	request: CompletionRequest,
	config: CascadeRouterConfig,
): Promise<RequestClassification | undefined> {
	if (!config.classifier) return undefined
	return config.classifier.classify(request)
}

function tierAllowsDifficulty(tier: Tier, classification?: RequestClassification): boolean {
	if (!classification) return true
	if (tier.maxDifficulty === undefined) return true
	return classification.difficulty <= tier.maxDifficulty
}

interface TierExecutionContext {
	tier: Tier
	index: number
	request: CompletionRequest
	escalate: EscalateOnFailureConfig | null
	gw: Gateway
	startedAt: number
	audit?: (event: CascadeAuditEvent) => void
}

async function runValidator(
	response: LLMResponse,
	request: CompletionRequest,
	escalate: EscalateOnFailureConfig | null,
): Promise<{ failed: false } | { failed: true; reason: string }> {
	if (!escalate?.validator) return { failed: false }
	const result = await escalate.validator(response, request)
	if (result.valid) return { failed: false }
	return { failed: true, reason: result.reason ?? 'validator returned valid=false' }
}

async function runConfidence(
	response: LLMResponse,
	request: CompletionRequest,
	escalate: EscalateOnFailureConfig | null,
): Promise<
	{ failed: false; confidence?: number } | { failed: true; confidence: number; reason: string }
> {
	if (!escalate?.confidence) return { failed: false }
	const result = await escalate.confidence(response, request)
	if (result.ok) return { failed: false, confidence: result.confidence }
	return {
		failed: true,
		confidence: result.confidence,
		reason: result.reason ?? `confidence ${result.confidence.toFixed(3)} below threshold`,
	}
}

async function executeTier(ctx: TierExecutionContext): Promise<{
	attempt: CascadeAttempt
	response?: LLMResponse
	escalate?: CascadeReason
}> {
	const { tier, request, escalate, gw, startedAt, audit, index } = ctx
	audit?.({ type: 'tier-attempt', tier: tier.name, attemptIndex: index })

	let response: LLMResponse
	try {
		response = await gw.complete({ ...request, model: tier.model })
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		const attempt: CascadeAttempt = {
			tier: tier.name,
			provider: tier.provider,
			model: tier.model,
			status: 'failed',
			error: message,
			latencyMs: Date.now() - startedAt,
		}
		return { attempt, escalate: escalate?.onProviderError === false ? undefined : 'provider-error' }
	}

	const latencyMs = Date.now() - startedAt

	const validatorResult = await runValidator(response, request, escalate)
	if (validatorResult.failed) {
		return {
			attempt: {
				tier: tier.name,
				provider: tier.provider,
				model: tier.model,
				status: 'validation-failed',
				validatorReason: validatorResult.reason,
				cost: response.cost.totalCost,
				latencyMs,
			},
			response,
			escalate: 'validator-failed',
		}
	}

	const confidenceResult = await runConfidence(response, request, escalate)
	if (confidenceResult.failed) {
		return {
			attempt: {
				tier: tier.name,
				provider: tier.provider,
				model: tier.model,
				status: 'low-confidence',
				confidence: confidenceResult.confidence,
				validatorReason: confidenceResult.reason,
				cost: response.cost.totalCost,
				latencyMs,
			},
			response,
			escalate: 'low-confidence',
		}
	}

	return {
		attempt: {
			tier: tier.name,
			provider: tier.provider,
			model: tier.model,
			status: 'ok',
			confidence: 'confidence' in confidenceResult ? confidenceResult.confidence : undefined,
			cost: response.cost.totalCost,
			latencyMs,
		},
		response,
	}
}

function selectEligibleTiers(
	tiers: Tier[],
	classification: RequestClassification | undefined,
	attempts: CascadeAttempt[],
	audit?: (event: CascadeAuditEvent) => void,
): Tier[] {
	const eligible: Tier[] = []
	for (let i = 0; i < tiers.length; i++) {
		const tier = tiers[i]
		if (!tierAllowsDifficulty(tier, classification)) {
			attempts.push({
				tier: tier.name,
				provider: tier.provider,
				model: tier.model,
				status: 'skipped-by-classifier',
			})
			audit?.({
				type: 'tier-attempt',
				tier: tier.name,
				attemptIndex: i,
				reason: 'difficulty-cap-exceeded',
				detail: `difficulty=${classification?.difficulty.toFixed(2)} > maxDifficulty=${tier.maxDifficulty}`,
			})
			continue
		}
		eligible.push(tier)
	}
	return eligible
}

export function createCascadeRouter(
	config: CascadeRouterConfig,
	deps: CascadeRouterFactoryOptions = {},
): CascadeRouter {
	if (!config.tiers?.length) {
		throw new ElsiumError({
			code: 'CONFIG_ERROR',
			message: 'cascade router requires at least one tier',
			retryable: false,
		})
	}

	const tiers = [...config.tiers]
	const gateways = buildGateways(tiers, deps)
	const escalate = normalizeEscalate(config.escalateOnFailure)
	const maxEscalations = escalate?.maxEscalations ?? tiers.length - 1
	const audit = config.onAudit

	const resolveGateway = (tier: Tier): Gateway => {
		const gw = gateways.get(`${tier.provider}::${tier.model}`)
		if (!gw) {
			throw new ElsiumError({
				code: 'CONFIG_ERROR',
				message: `cascade router: no gateway for tier "${tier.name}"`,
				retryable: false,
			})
		}
		return gw
	}

	const handleEscalation = (
		tier: Tier,
		index: number,
		escalateReason: CascadeReason | undefined,
		escalationsUsed: number,
	): { proceed: boolean; newCount: number } => {
		const canEscalate = escalate !== null && escalateReason !== undefined
		if (!canEscalate) return { proceed: false, newCount: escalationsUsed }
		if (escalationsUsed >= maxEscalations) {
			audit?.({
				type: 'tier-escalation',
				tier: tier.name,
				attemptIndex: index,
				reason: escalateReason,
				detail: 'maxEscalations reached',
			})
			return { proceed: false, newCount: escalationsUsed }
		}
		audit?.({
			type: 'tier-escalation',
			tier: tier.name,
			attemptIndex: index,
			reason: escalateReason,
		})
		return { proceed: true, newCount: escalationsUsed + 1 }
	}

	return {
		tiers,
		async complete(request: CompletionRequest): Promise<CascadeResult> {
			const classification = await classifyRequest(request, config)
			const attempts: CascadeAttempt[] = []
			const eligibleTiers = selectEligibleTiers(tiers, classification, attempts, audit)

			let totalCost = 0
			let totalLatencyMs = 0
			let escalationsUsed = 0

			for (let i = 0; i < eligibleTiers.length; i++) {
				const tier = eligibleTiers[i]
				const result = await executeTier({
					tier,
					index: i,
					request,
					escalate,
					gw: resolveGateway(tier),
					startedAt: Date.now(),
					audit,
				})

				attempts.push(result.attempt)
				if (result.attempt.cost) totalCost += result.attempt.cost
				if (result.attempt.latencyMs) totalLatencyMs += result.attempt.latencyMs

				if (result.attempt.status === 'ok' && result.response) {
					audit?.({ type: 'cascade-success', tier: tier.name, attemptIndex: i })
					return {
						response: result.response,
						tier: tier.name,
						totalCost,
						totalLatencyMs,
						attempts,
						classification,
					}
				}

				const next = handleEscalation(tier, i, result.escalate, escalationsUsed)
				escalationsUsed = next.newCount
				if (!next.proceed) break
			}

			audit?.({ type: 'cascade-exhausted', tier: 'none', attemptIndex: attempts.length })
			throw new CascadeExhaustedError(attempts, classification)
		},
	}
}
