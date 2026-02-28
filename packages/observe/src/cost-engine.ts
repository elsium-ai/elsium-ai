import type {
	CostBreakdown,
	LLMResponse,
	Middleware,
	MiddlewareContext,
	MiddlewareNext,
	TokenUsage,
} from '@elsium-ai/core'
import { ElsiumError } from '@elsium-ai/core'

export interface BudgetConfig {
	totalBudget?: number
	dailyBudget?: number
	perUser?: number
	perFeature?: number
	perAgent?: number
}

export interface LoopDetectionConfig {
	maxCallsPerMinute?: number
	maxCostPerMinute?: number
}

export interface CostAlert {
	type: 'threshold' | 'loop_detected' | 'budget_exceeded' | 'projection_warning'
	dimension: string
	currentValue: number
	limit: number
	message: string
	timestamp: number
}

export interface CostDimension {
	totalCost: number
	totalTokens: number
	callCount: number
	firstCallAt: number
	lastCallAt: number
}

export interface CostIntelligenceReport {
	totalSpend: number
	totalTokens: number
	totalCalls: number
	projectedDailySpend: number
	projectedMonthlySpend: number
	byModel: Record<string, CostDimension>
	byAgent: Record<string, CostDimension>
	byUser: Record<string, CostDimension>
	byFeature: Record<string, CostDimension>
	recommendations: string[]
	alerts: CostAlert[]
}

export interface ModelSuggestion {
	currentModel: string
	suggestedModel: string
	estimatedSavings: number
	reason: string
}

export interface CostEngineConfig {
	totalBudget?: number
	dailyBudget?: number
	perUser?: number
	perFeature?: number
	perAgent?: number
	loopDetection?: LoopDetectionConfig
	onAlert?: (alert: CostAlert) => void
	alertThresholds?: number[]
}

export interface CostEngine {
	middleware(): Middleware
	getReport(): CostIntelligenceReport
	suggestModel(currentModel: string, inputTokens: number): ModelSuggestion | null
	trackCall(
		response: LLMResponse,
		dimensions?: { agent?: string; user?: string; feature?: string },
	): void
	reset(): void
}

interface CallRecord {
	timestamp: number
	cost: number
	model: string
	tokens: number
}

const MODEL_TIERS: Record<string, { tier: 'low' | 'mid' | 'high'; costPerMToken: number }> = {
	'claude-haiku-4-5-20251001': { tier: 'low', costPerMToken: 0.8 },
	'gpt-4o-mini': { tier: 'low', costPerMToken: 0.15 },
	'gemini-2.0-flash': { tier: 'low', costPerMToken: 0.1 },
	'gemini-2.0-flash-lite': { tier: 'low', costPerMToken: 0.075 },
	'claude-sonnet-4-6': { tier: 'mid', costPerMToken: 3 },
	'gpt-4o': { tier: 'mid', costPerMToken: 2.5 },
	'gemini-2.5-pro-preview-05-06': { tier: 'mid', costPerMToken: 1.25 },
	'claude-opus-4-6': { tier: 'high', costPerMToken: 15 },
	o1: { tier: 'high', costPerMToken: 15 },
}

function createDimension(): CostDimension {
	return { totalCost: 0, totalTokens: 0, callCount: 0, firstCallAt: 0, lastCallAt: 0 }
}

function updateDimension(dim: CostDimension, cost: number, tokens: number): void {
	const now = Date.now()
	dim.totalCost += cost
	dim.totalTokens += tokens
	dim.callCount++
	if (dim.firstCallAt === 0) dim.firstCallAt = now
	dim.lastCallAt = now
}

export function createCostEngine(config: CostEngineConfig = {}): CostEngine {
	const byModel: Record<string, CostDimension> = {}
	const byAgent: Record<string, CostDimension> = {}
	const byUser: Record<string, CostDimension> = {}
	const byFeature: Record<string, CostDimension> = {}

	let totalSpend = 0
	let totalTokens = 0
	let totalCalls = 0
	const startedAt = Date.now()
	const alerts: CostAlert[] = []
	const recentCalls: CallRecord[] = []
	const alertedThresholds = new Set<string>()

	function emitAlert(alert: CostAlert) {
		alerts.push(alert)
		config.onAlert?.(alert)
	}

	function checkBudgets(dimensions: { agent?: string; user?: string; feature?: string }) {
		if (config.totalBudget && totalSpend > config.totalBudget) {
			throw ElsiumError.budgetExceeded(totalSpend, config.totalBudget)
		}

		if (config.dailyBudget) {
			const elapsedMs = Date.now() - startedAt
			const elapsedDays = Math.max(elapsedMs / (24 * 60 * 60 * 1000), 1 / 24)
			const dailyRate = totalSpend / elapsedDays
			if (dailyRate > config.dailyBudget) {
				const key = `daily:${Math.floor(Date.now() / (60 * 60 * 1000))}`
				if (!alertedThresholds.has(key)) {
					alertedThresholds.add(key)
					emitAlert({
						type: 'budget_exceeded',
						dimension: 'daily',
						currentValue: dailyRate,
						limit: config.dailyBudget,
						message: `Daily spend rate $${dailyRate.toFixed(4)} exceeds budget $${config.dailyBudget}`,
						timestamp: Date.now(),
					})
				}
			}
		}

		if (config.perAgent && dimensions.agent) {
			const dim = byAgent[dimensions.agent]
			if (dim && dim.totalCost > config.perAgent) {
				throw ElsiumError.budgetExceeded(dim.totalCost, config.perAgent)
			}
		}

		if (config.perUser && dimensions.user) {
			const dim = byUser[dimensions.user]
			if (dim && dim.totalCost > config.perUser) {
				throw ElsiumError.budgetExceeded(dim.totalCost, config.perUser)
			}
		}

		if (config.perFeature && dimensions.feature) {
			const dim = byFeature[dimensions.feature]
			if (dim && dim.totalCost > config.perFeature) {
				throw ElsiumError.budgetExceeded(dim.totalCost, config.perFeature)
			}
		}

		// Check alert thresholds
		if (config.alertThresholds && config.totalBudget) {
			for (const threshold of config.alertThresholds) {
				const thresholdAmount = config.totalBudget * threshold
				if (totalSpend >= thresholdAmount) {
					const key = `threshold:${threshold}`
					if (!alertedThresholds.has(key)) {
						alertedThresholds.add(key)
						emitAlert({
							type: 'threshold',
							dimension: 'total',
							currentValue: totalSpend,
							limit: thresholdAmount,
							message: `Spend reached ${(threshold * 100).toFixed(0)}% of budget ($${totalSpend.toFixed(4)} / $${config.totalBudget})`,
							timestamp: Date.now(),
						})
					}
				}
			}
		}
	}

	function checkLoopDetection() {
		if (!config.loopDetection) return

		const now = Date.now()
		const oneMinuteAgo = now - 60_000

		// Clean old records
		while (recentCalls.length > 0 && recentCalls[0].timestamp < oneMinuteAgo) {
			recentCalls.shift()
		}

		if (
			config.loopDetection.maxCallsPerMinute &&
			recentCalls.length > config.loopDetection.maxCallsPerMinute
		) {
			emitAlert({
				type: 'loop_detected',
				dimension: 'calls_per_minute',
				currentValue: recentCalls.length,
				limit: config.loopDetection.maxCallsPerMinute,
				message: `Loop detected: ${recentCalls.length} calls in last minute (max: ${config.loopDetection.maxCallsPerMinute})`,
				timestamp: now,
			})
		}

		if (config.loopDetection.maxCostPerMinute) {
			const recentCost = recentCalls.reduce((sum, r) => sum + r.cost, 0)
			if (recentCost > config.loopDetection.maxCostPerMinute) {
				emitAlert({
					type: 'loop_detected',
					dimension: 'cost_per_minute',
					currentValue: recentCost,
					limit: config.loopDetection.maxCostPerMinute,
					message: `Cost loop detected: $${recentCost.toFixed(4)} in last minute (max: $${config.loopDetection.maxCostPerMinute})`,
					timestamp: now,
				})
			}
		}
	}

	function trackCall(
		response: LLMResponse,
		dimensions: { agent?: string; user?: string; feature?: string } = {},
	) {
		const cost = response.cost.totalCost
		const tokens = response.usage.totalTokens

		totalSpend += cost
		totalTokens += tokens
		totalCalls++

		// Track by model
		if (!byModel[response.model]) byModel[response.model] = createDimension()
		updateDimension(byModel[response.model], cost, tokens)

		// Track by dimensions
		if (dimensions.agent) {
			if (!byAgent[dimensions.agent]) byAgent[dimensions.agent] = createDimension()
			updateDimension(byAgent[dimensions.agent], cost, tokens)
		}
		if (dimensions.user) {
			if (!byUser[dimensions.user]) byUser[dimensions.user] = createDimension()
			updateDimension(byUser[dimensions.user], cost, tokens)
		}
		if (dimensions.feature) {
			if (!byFeature[dimensions.feature]) byFeature[dimensions.feature] = createDimension()
			updateDimension(byFeature[dimensions.feature], cost, tokens)
		}

		recentCalls.push({ timestamp: Date.now(), cost, model: response.model, tokens })

		checkLoopDetection()
		checkBudgets(dimensions)
	}

	return {
		middleware(): Middleware {
			return async (ctx: MiddlewareContext, next: MiddlewareNext) => {
				const agent = ctx.metadata.agentName as string | undefined
				const user = ctx.metadata.userId as string | undefined
				const feature = ctx.metadata.feature as string | undefined

				const response = await next(ctx)
				trackCall(response, { agent, user, feature })
				return response
			}
		},

		trackCall,

		getReport(): CostIntelligenceReport {
			const elapsedMs = Math.max(Date.now() - startedAt, 1)
			const elapsedHours = elapsedMs / (60 * 60 * 1000)
			const projectedDailySpend = totalCalls > 0 ? (totalSpend / elapsedHours) * 24 : 0
			const projectedMonthlySpend = projectedDailySpend * 30

			const recommendations: string[] = []

			// Check for high-tier model overuse
			for (const [model, dim] of Object.entries(byModel)) {
				const tier = MODEL_TIERS[model]
				if (tier?.tier === 'high' && dim.callCount > 10) {
					recommendations.push(
						`Consider using a mid-tier model instead of ${model} for routine tasks. ${dim.callCount} calls at $${dim.totalCost.toFixed(4)} total.`,
					)
				}
			}

			// Check projected overspend
			if (config.totalBudget && projectedMonthlySpend > config.totalBudget * 1.2) {
				recommendations.push(
					`Projected monthly spend ($${projectedMonthlySpend.toFixed(2)}) exceeds budget by ${((projectedMonthlySpend / config.totalBudget - 1) * 100).toFixed(0)}%.`,
				)
			}

			// Suggest batching if many small calls
			if (totalCalls > 50 && totalTokens / totalCalls < 100) {
				recommendations.push(
					'Average token count per call is very low. Consider batching requests to reduce overhead.',
				)
			}

			return {
				totalSpend,
				totalTokens,
				totalCalls,
				projectedDailySpend,
				projectedMonthlySpend,
				byModel: { ...byModel },
				byAgent: { ...byAgent },
				byUser: { ...byUser },
				byFeature: { ...byFeature },
				recommendations,
				alerts: [...alerts],
			}
		},

		suggestModel(currentModel: string, inputTokens: number): ModelSuggestion | null {
			const current = MODEL_TIERS[currentModel]
			if (!current || current.tier === 'low') return null

			// Find cheaper alternatives in the same or lower tier
			const cheaper = Object.entries(MODEL_TIERS)
				.filter(([, info]) => {
					if (current.tier === 'high') return info.tier === 'mid' || info.tier === 'low'
					if (current.tier === 'mid') return info.tier === 'low'
					return false
				})
				.sort((a, b) => a[1].costPerMToken - b[1].costPerMToken)

			if (cheaper.length === 0) return null

			// Simple heuristic: small input = simple task
			const isSimple = inputTokens < 500
			const [suggestedModel, suggestedInfo] = cheaper[0]

			if (!isSimple && current.tier !== 'high') return null

			const estimatedSavings =
				((current.costPerMToken - suggestedInfo.costPerMToken) / current.costPerMToken) * 100

			return {
				currentModel,
				suggestedModel,
				estimatedSavings,
				reason: isSimple
					? `Simple request (${inputTokens} tokens) could use a cheaper model`
					: `Consider ${suggestedModel} for routine tasks (${estimatedSavings.toFixed(0)}% savings)`,
			}
		},

		reset() {
			for (const key of Object.keys(byModel)) delete byModel[key]
			for (const key of Object.keys(byAgent)) delete byAgent[key]
			for (const key of Object.keys(byUser)) delete byUser[key]
			for (const key of Object.keys(byFeature)) delete byFeature[key]
			totalSpend = 0
			totalTokens = 0
			totalCalls = 0
			alerts.length = 0
			recentCalls.length = 0
			alertedThresholds.clear()
		},
	}
}
