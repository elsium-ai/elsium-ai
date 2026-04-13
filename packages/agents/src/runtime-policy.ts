import { ElsiumError } from '@elsium-ai/core'
import type { PolicyContext, PolicyResult, PolicySet } from '@elsium-ai/core'

export interface RuntimePolicyConfig {
	policies: PolicySet
	actor?: string
	role?: string
	allowedTools?: string[]
	deniedTools?: string[]
}

export interface ToolPolicyContext extends PolicyContext {
	toolName?: string
	toolArguments?: Record<string, unknown>
	iteration?: number
	totalTokensUsed?: number
	totalCostUsed?: number
}

export interface RuntimePolicyEnforcer {
	evaluateToolCall(ctx: ToolPolicyContext): void
	evaluateRequest(ctx: PolicyContext): void
	isToolAllowed(toolName: string): boolean
}

export function createRuntimePolicyEnforcer(config: RuntimePolicyConfig): RuntimePolicyEnforcer {
	const allowedTools = config.allowedTools ? new Set(config.allowedTools) : null
	const deniedTools = config.deniedTools ? new Set(config.deniedTools) : null

	function isToolAllowed(toolName: string): boolean {
		if (deniedTools?.has(toolName)) return false
		if (allowedTools && !allowedTools.has(toolName)) return false
		return true
	}

	function evaluate(ctx: PolicyContext): void {
		const enrichedCtx: PolicyContext = {
			...ctx,
			actor: ctx.actor ?? config.actor,
			role: ctx.role ?? config.role,
		}

		const denials = config.policies.evaluate(enrichedCtx)
		if (denials.length > 0) {
			throw ElsiumError.validation(
				`Runtime policy denied: ${denials.map((d) => `[${d.policyName}] ${d.reason}`).join('; ')}`,
			)
		}
	}

	return {
		evaluateToolCall(ctx: ToolPolicyContext): void {
			if (ctx.toolName && !isToolAllowed(ctx.toolName)) {
				throw ElsiumError.validation(
					`Tool "${ctx.toolName}" is not allowed for role "${config.role ?? 'unknown'}"`,
				)
			}
			evaluate(ctx)
		},

		evaluateRequest(ctx: PolicyContext): void {
			evaluate(ctx)
		},

		isToolAllowed,
	}
}

export function toolAccessPolicy(allowedTools: string[]) {
	const allowed = new Set(allowedTools)
	return {
		name: 'tool-access',
		description: 'Restricts access to specific tools',
		rules: [
			(ctx: ToolPolicyContext): PolicyResult => {
				if (!ctx.toolName) {
					return {
						decision: 'allow' as const,
						reason: 'No tool specified',
						policyName: 'tool-access',
					}
				}
				const isAllowed = allowed.has(ctx.toolName)
				return {
					decision: isAllowed ? ('allow' as const) : ('deny' as const),
					reason: isAllowed ? 'Tool is allowed' : `Tool "${ctx.toolName}" is not in allowed list`,
					policyName: 'tool-access',
				}
			},
		],
	}
}

export function iterationLimitPolicy(maxIterations: number) {
	return {
		name: 'iteration-limit',
		description: `Limits agent to ${maxIterations} iterations`,
		rules: [
			(ctx: ToolPolicyContext): PolicyResult => {
				if (ctx.iteration === undefined) {
					return {
						decision: 'allow' as const,
						reason: 'No iteration count',
						policyName: 'iteration-limit',
					}
				}
				const allowed = ctx.iteration <= maxIterations
				return {
					decision: allowed ? ('allow' as const) : ('deny' as const),
					reason: allowed
						? 'Within iteration limit'
						: `Iteration ${ctx.iteration} exceeds limit ${maxIterations}`,
					policyName: 'iteration-limit',
				}
			},
		],
	}
}
