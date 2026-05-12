import type { Middleware, MiddlewareContext, MiddlewareNext } from '@elsium-ai/core'
import { ElsiumError } from '@elsium-ai/core'
import type { CostEngine } from './cost-engine'

export type BudgetAction =
	| { type: 'pass-through'; spentRatio: number }
	| { type: 'downgrade'; from: string; to: string; spentRatio: number; reason: string }
	| { type: 'reject'; model: string; spentRatio: number; reason: string }

export interface BudgetAwareRoutingConfig {
	/** Cost engine to read current spend from (must be the same one tracking calls). */
	costEngine: CostEngine
	/** Total budget in $. Used as the denominator for spentRatio. */
	totalBudget: number
	/** Ratio at which we attempt automatic downgrade. Default 0.7. */
	downgradeThreshold?: number
	/** Ratio at which we reject the call. Default 0.95. */
	rejectThreshold?: number
	/** Notification callback for every action taken (or pass-through). */
	onAction?: (action: BudgetAction) => void
}

function clampRatio(numerator: number, denominator: number): number {
	if (denominator <= 0) return 0
	const r = numerator / denominator
	if (!Number.isFinite(r) || r < 0) return 0
	return r
}

function estimateInputTokens(ctx: MiddlewareContext): number {
	let chars = 0
	for (const m of ctx.request.messages) {
		if (typeof m.content === 'string') chars += m.content.length
	}
	if (ctx.request.system) chars += ctx.request.system.length
	return Math.ceil(chars / 4)
}

/**
 * Prescriptive budget enforcement: automatic model downgrade at the soft
 * threshold, rejection at the hard threshold.
 *
 * Composes with the cost engine middleware. Order matters — install the
 * budget-aware policy BEFORE the cost engine so the policy sees current
 * spend and can reroute the call before cost tracking commits.
 *
 * @example
 *   const engine = createCostEngine({ totalBudget: 100 })
 *   const gw = gateway({
 *     middleware: [
 *       createBudgetAwareRoutingPolicy({
 *         costEngine: engine,
 *         totalBudget: 100,
 *         downgradeThreshold: 0.7,
 *         rejectThreshold: 0.95,
 *       }),
 *       engine.middleware(),
 *     ],
 *   })
 */
export function createBudgetAwareRoutingPolicy(config: BudgetAwareRoutingConfig): Middleware {
	const downgradeAt = config.downgradeThreshold ?? 0.7
	const rejectAt = config.rejectThreshold ?? 0.95

	if (!Number.isFinite(config.totalBudget) || config.totalBudget <= 0) {
		throw ElsiumError.validation(
			'BudgetAwareRoutingPolicy: totalBudget must be positive and finite',
		)
	}
	if (downgradeAt < 0 || downgradeAt > 1) {
		throw ElsiumError.validation('BudgetAwareRoutingPolicy: downgradeThreshold must be in [0, 1]')
	}
	if (rejectAt < 0 || rejectAt > 1) {
		throw ElsiumError.validation('BudgetAwareRoutingPolicy: rejectThreshold must be in [0, 1]')
	}
	if (rejectAt < downgradeAt) {
		throw ElsiumError.validation(
			'BudgetAwareRoutingPolicy: rejectThreshold must be >= downgradeThreshold',
		)
	}

	const onAction = config.onAction ?? (() => {})

	return async (ctx: MiddlewareContext, next: MiddlewareNext) => {
		const report = config.costEngine.getReport()
		const spentRatio = clampRatio(report.totalSpend, config.totalBudget)

		if (spentRatio >= rejectAt) {
			const reason = `Spend ratio ${(spentRatio * 100).toFixed(1)}% >= reject threshold ${(rejectAt * 100).toFixed(0)}%`
			onAction({ type: 'reject', model: ctx.model, spentRatio, reason })
			throw ElsiumError.budgetExceeded(report.totalSpend, config.totalBudget)
		}

		if (spentRatio >= downgradeAt) {
			const inputTokens = estimateInputTokens(ctx)
			const suggestion = config.costEngine.suggestModel(ctx.model, inputTokens)
			if (suggestion && suggestion.suggestedModel !== ctx.model) {
				const from = ctx.model
				ctx.model = suggestion.suggestedModel
				ctx.request.model = suggestion.suggestedModel
				onAction({
					type: 'downgrade',
					from,
					to: suggestion.suggestedModel,
					spentRatio,
					reason: suggestion.reason,
				})
				return next(ctx)
			}
		}

		onAction({ type: 'pass-through', spentRatio })
		return next(ctx)
	}
}
