import { ElsiumError } from './errors'
import type { Middleware, MiddlewareContext, MiddlewareNext } from './types'

export type PolicyDecision = 'allow' | 'deny'

export interface PolicyResult {
	decision: PolicyDecision
	reason: string
	policyName: string
}

export interface PolicyContext {
	model?: string
	provider?: string
	actor?: string
	role?: string
	tokenCount?: number
	costEstimate?: number
	requestContent?: string
	metadata?: Record<string, unknown>
}

export type PolicyRule = (ctx: PolicyContext) => PolicyResult

export interface PolicyConfig {
	name: string
	description?: string
	rules: PolicyRule[]
	mode?: 'all-must-pass' | 'any-must-pass'
}

export interface PolicySet {
	evaluate(ctx: PolicyContext): PolicyResult[]
	addPolicy(policy: PolicyConfig): void
	removePolicy(name: string): void
	readonly policies: string[]
}

export function createPolicySet(policies: PolicyConfig[]): PolicySet {
	const policyList = [...policies]

	return {
		evaluate(ctx: PolicyContext): PolicyResult[] {
			const denials: PolicyResult[] = []

			for (const policy of policyList) {
				const mode = policy.mode ?? 'all-must-pass'
				const results = policy.rules.map((rule) => rule(ctx))

				if (mode === 'all-must-pass') {
					const denied = results.filter((r) => r.decision === 'deny')
					denials.push(...denied)
				} else {
					const anyAllowed = results.some((r) => r.decision === 'allow')
					if (!anyAllowed && results.length > 0) {
						denials.push(results[0])
					}
				}
			}

			return denials
		},

		addPolicy(policy: PolicyConfig): void {
			policyList.push(policy)
		},

		removePolicy(name: string): void {
			const idx = policyList.findIndex((p) => p.name === name)
			if (idx !== -1) policyList.splice(idx, 1)
		},

		get policies(): string[] {
			return policyList.map((p) => p.name)
		},
	}
}

export function policyMiddleware(policySet: PolicySet): Middleware {
	return async (ctx: MiddlewareContext, next: MiddlewareNext) => {
		const policyCtx: PolicyContext = {
			model: ctx.model,
			provider: ctx.provider,
			metadata: ctx.metadata,
		}

		const denials = policySet.evaluate(policyCtx)
		if (denials.length > 0) {
			throw ElsiumError.validation(
				`Policy denied: ${denials.map((d) => `[${d.policyName}] ${d.reason}`).join('; ')}`,
			)
		}

		return next(ctx)
	}
}

// ─── Built-in Policy Factories ──────────────────────────────────

export function modelAccessPolicy(allowedModels: string[]): PolicyConfig {
	return {
		name: 'model-access',
		description: 'Restricts access to specific models',
		rules: [
			(ctx: PolicyContext): PolicyResult => {
				if (!ctx.model)
					return { decision: 'allow', reason: 'No model specified', policyName: 'model-access' }
				const model = ctx.model
				const allowed = allowedModels.some((m) => model === m || model.startsWith(m))
				return {
					decision: allowed ? 'allow' : 'deny',
					reason: allowed ? 'Model is allowed' : `Model "${ctx.model}" is not in allowed list`,
					policyName: 'model-access',
				}
			},
		],
	}
}

export function tokenLimitPolicy(maxTokens: number): PolicyConfig {
	return {
		name: 'token-limit',
		description: `Limits requests to ${maxTokens} tokens`,
		rules: [
			(ctx: PolicyContext): PolicyResult => {
				if (ctx.tokenCount === undefined) {
					return {
						decision: 'allow',
						reason: 'No token count available',
						policyName: 'token-limit',
					}
				}
				const allowed = ctx.tokenCount <= maxTokens
				return {
					decision: allowed ? 'allow' : 'deny',
					reason: allowed
						? 'Within token limit'
						: `Token count ${ctx.tokenCount} exceeds limit ${maxTokens}`,
					policyName: 'token-limit',
				}
			},
		],
	}
}

export function costLimitPolicy(maxCost: number): PolicyConfig {
	return {
		name: 'cost-limit',
		description: `Limits requests to $${maxCost}`,
		rules: [
			(ctx: PolicyContext): PolicyResult => {
				if (ctx.costEstimate === undefined) {
					return {
						decision: 'allow',
						reason: 'No cost estimate available',
						policyName: 'cost-limit',
					}
				}
				const allowed = ctx.costEstimate <= maxCost
				return {
					decision: allowed ? 'allow' : 'deny',
					reason: allowed
						? 'Within cost limit'
						: `Cost $${ctx.costEstimate} exceeds limit $${maxCost}`,
					policyName: 'cost-limit',
				}
			},
		],
	}
}

export function contentPolicy(blockedPatterns: RegExp[]): PolicyConfig {
	return {
		name: 'content-policy',
		description: 'Blocks requests matching content patterns',
		rules: [
			(ctx: PolicyContext): PolicyResult => {
				if (!ctx.requestContent) {
					return { decision: 'allow', reason: 'No content to check', policyName: 'content-policy' }
				}
				for (const pattern of blockedPatterns) {
					if (pattern.test(ctx.requestContent)) {
						return {
							decision: 'deny',
							reason: `Content matches blocked pattern: ${pattern.source}`,
							policyName: 'content-policy',
						}
					}
				}
				return { decision: 'allow', reason: 'Content is clean', policyName: 'content-policy' }
			},
		],
	}
}
