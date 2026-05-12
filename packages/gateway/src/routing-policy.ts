/**
 * Declarative RoutingPolicy (R3).
 *
 * Data-driven routing layer above the provider mesh. Maps a request's
 * shape (model, provider, tenant, capabilities, estimated cost/latency,
 * arbitrary context) to a RoutingTarget (strategy + provider + model).
 *
 * Reuses the G3 ConditionExpression and evaluateCondition from
 * @elsium-ai/core so the same 8-operator semantics drive both
 * authorization decisions and routing decisions. No duplication.
 *
 * Composes with createProviderMesh: the user resolves the target via
 * the policy, then routes the request through the mesh accordingly.
 * Keeping the policy decoupled from the mesh executor avoids tying
 * users to a specific provider abstraction.
 */

import { type ConditionExpression, ElsiumError, evaluateCondition } from '@elsium-ai/core'
import type { RoutingStrategy } from './router'

// ─── Data model ─────────────────────────────────────────────────

export interface RoutingPolicy {
	readonly apiVersion: 'elsium.routing/v1'
	readonly kind: 'RoutingPolicy'
	readonly metadata: {
		readonly name: string
		readonly description?: string
	}
	readonly rules: readonly RoutingRule[]
	readonly default: RoutingTarget
}

export interface RoutingRule {
	readonly name: string
	readonly when?: ConditionExpression
	readonly slo?: ServiceLevelObjective
	readonly target: RoutingTarget
	/** Higher priority rules evaluate first. Default 0. */
	readonly priority?: number
}

export interface ServiceLevelObjective {
	/** Hard latency cap. If estimated > this, the rule is not eligible. */
	readonly maxLatencyMs?: number
	/** Hard cost cap. If estimated > this, the rule is not eligible. */
	readonly maxCost?: number
	/** All listed capabilities must be present in the candidate provider/model. */
	readonly requireCapabilities?: readonly string[]
}

export interface RoutingTarget {
	readonly strategy?: RoutingStrategy
	readonly provider?: string
	readonly model?: string
}

export interface RoutingContext {
	readonly tenant?: string
	readonly model?: string
	readonly provider?: string
	readonly estimatedCost?: number
	readonly estimatedLatencyMs?: number
	readonly capabilities?: readonly string[]
	readonly metadata?: Readonly<Record<string, string | number | boolean>>
}

export interface RoutingResolution {
	readonly target: RoutingTarget
	readonly matchedRule?: string
	readonly reason: string
}

// ─── Decision logic ─────────────────────────────────────────────

function ctxToConditionRecord(
	ctx: RoutingContext,
): Readonly<Record<string, string | number | boolean>> {
	const base: Record<string, string | number | boolean> = {}
	if (ctx.tenant) base.tenant = ctx.tenant
	if (ctx.model) base.model = ctx.model
	if (ctx.provider) base.provider = ctx.provider
	if (ctx.estimatedCost !== undefined) base.estimatedCost = ctx.estimatedCost
	if (ctx.estimatedLatencyMs !== undefined) base.estimatedLatencyMs = ctx.estimatedLatencyMs
	if (ctx.metadata) {
		for (const [k, v] of Object.entries(ctx.metadata)) base[k] = v
	}
	return base
}

function latencyExceeds(slo: ServiceLevelObjective, ctx: RoutingContext): boolean {
	return (
		slo.maxLatencyMs !== undefined &&
		ctx.estimatedLatencyMs !== undefined &&
		ctx.estimatedLatencyMs > slo.maxLatencyMs
	)
}

function costExceeds(slo: ServiceLevelObjective, ctx: RoutingContext): boolean {
	return (
		slo.maxCost !== undefined && ctx.estimatedCost !== undefined && ctx.estimatedCost > slo.maxCost
	)
}

function capabilitiesSatisfied(slo: ServiceLevelObjective, ctx: RoutingContext): boolean {
	if (!slo.requireCapabilities || slo.requireCapabilities.length === 0) return true
	if (!ctx.capabilities) return false
	return slo.requireCapabilities.every((required) => ctx.capabilities?.includes(required))
}

function sloEligible(slo: ServiceLevelObjective | undefined, ctx: RoutingContext): boolean {
	if (!slo) return true
	if (latencyExceeds(slo, ctx)) return false
	if (costExceeds(slo, ctx)) return false
	if (!capabilitiesSatisfied(slo, ctx)) return false
	return true
}

// ─── Engine ─────────────────────────────────────────────────────

export interface DeclarativeRouter {
	resolve(ctx: RoutingContext): RoutingResolution
	loadPolicy(policy: RoutingPolicy): void
	exportPolicy(): RoutingPolicy
	verify(policy?: RoutingPolicy): readonly { rule: string; issue: string }[]
}

function validatePolicy(policy: RoutingPolicy): readonly { rule: string; issue: string }[] {
	const issues: { rule: string; issue: string }[] = []
	const names = new Set<string>()
	for (const rule of policy.rules) {
		if (names.has(rule.name)) {
			issues.push({ rule: rule.name, issue: `Duplicate rule name "${rule.name}"` })
		}
		names.add(rule.name)
		const target = rule.target
		if (
			target.strategy === undefined &&
			target.provider === undefined &&
			target.model === undefined
		) {
			issues.push({ rule: rule.name, issue: 'Rule target is empty (no strategy/provider/model)' })
		}
		if (rule.when?.op === 'matches') {
			try {
				new RegExp(rule.when.regex)
			} catch (err) {
				issues.push({
					rule: rule.name,
					issue: `Invalid regex in when.matches: ${err instanceof Error ? err.message : String(err)}`,
				})
			}
		}
	}
	return issues
}

export function createDeclarativeRouter(initial: RoutingPolicy): DeclarativeRouter {
	let policy = initial

	function validate(p: RoutingPolicy): void {
		const issues = validatePolicy(p)
		if (issues.length > 0) {
			throw ElsiumError.validation(
				`RoutingPolicy has ${issues.length} issue(s): ${issues
					.map((i) => `[${i.rule}] ${i.issue}`)
					.join('; ')}`,
			)
		}
	}

	validate(initial)

	return {
		resolve(ctx: RoutingContext): RoutingResolution {
			const conditionCtx = ctxToConditionRecord(ctx)
			const sorted = [...policy.rules].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
			for (const rule of sorted) {
				if (rule.when && !evaluateCondition(rule.when, conditionCtx)) continue
				if (!sloEligible(rule.slo, ctx)) continue
				return {
					target: rule.target,
					matchedRule: rule.name,
					reason: `Matched rule "${rule.name}"`,
				}
			}
			return {
				target: policy.default,
				reason: 'No rule matched; using default target',
			}
		},

		loadPolicy(next: RoutingPolicy): void {
			validate(next)
			policy = next
		},

		exportPolicy(): RoutingPolicy {
			return {
				...policy,
				rules: [...policy.rules],
			}
		},

		verify(p?: RoutingPolicy): readonly { rule: string; issue: string }[] {
			return validatePolicy(p ?? policy)
		},
	}
}
