import type { LLMResponse, MiddlewareContext } from '@elsium-ai/core'
import { describe, expect, it, vi } from 'vitest'
import { type BudgetAction, createBudgetAwareRoutingPolicy } from './budget-routing'
import { createCostEngine } from './cost-engine'

function mockResponse(overrides: Partial<LLMResponse> = {}): LLMResponse {
	return {
		id: 'msg_1',
		message: { role: 'assistant', content: 'ok' },
		usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
		cost: { inputCost: 0.001, outputCost: 0.001, totalCost: 0.002, currency: 'USD' },
		model: 'claude-sonnet-4-6',
		provider: 'anthropic',
		stopReason: 'end_turn',
		latencyMs: 50,
		traceId: 'trc_1',
		...overrides,
	}
}

function ctx(model = 'claude-opus-4-6', userText = 'short prompt'): MiddlewareContext {
	return {
		request: { messages: [{ role: 'user', content: userText }] },
		provider: 'anthropic',
		model,
		traceId: 'trc_1',
		startTime: performance.now(),
		metadata: {},
	}
}

describe('createBudgetAwareRoutingPolicy', () => {
	it('passes through unchanged when spend is below downgrade threshold', async () => {
		const engine = createCostEngine()
		const actions: BudgetAction[] = []
		const policy = createBudgetAwareRoutingPolicy({
			costEngine: engine,
			totalBudget: 100,
			downgradeThreshold: 0.7,
			rejectThreshold: 0.95,
			onAction: (a) => actions.push(a),
		})

		// totalSpend = 0 → ratio = 0
		const c = ctx('claude-opus-4-6')
		const next = vi.fn(async () => mockResponse())
		await policy(c, next)

		expect(actions).toHaveLength(1)
		expect(actions[0].type).toBe('pass-through')
		expect(c.model).toBe('claude-opus-4-6') // unchanged
		expect(next).toHaveBeenCalledTimes(1)
	})

	it('downgrades the model when ratio crosses downgradeThreshold', async () => {
		const engine = createCostEngine()
		// Drive spend to ~72% of 100$: track a $72 call
		engine.trackCall(
			mockResponse({ cost: { inputCost: 36, outputCost: 36, totalCost: 72, currency: 'USD' } }),
		)

		const actions: BudgetAction[] = []
		const policy = createBudgetAwareRoutingPolicy({
			costEngine: engine,
			totalBudget: 100,
			downgradeThreshold: 0.7,
			rejectThreshold: 0.95,
			onAction: (a) => actions.push(a),
		})

		const c = ctx('claude-opus-4-6', 'short prompt') // suggestModel finds a cheaper alt
		const next = vi.fn(async () => mockResponse())
		await policy(c, next)

		const downgrade = actions.find((a) => a.type === 'downgrade')
		expect(downgrade).toBeDefined()
		if (downgrade && downgrade.type === 'downgrade') {
			expect(downgrade.from).toBe('claude-opus-4-6')
			expect(downgrade.to).not.toBe('claude-opus-4-6')
			expect(downgrade.spentRatio).toBeGreaterThanOrEqual(0.7)
		}
		expect(c.model).not.toBe('claude-opus-4-6')
		expect(c.request.model).toBe(c.model) // ctx.request.model also rewritten
	})

	it('rejects the call when ratio crosses rejectThreshold', async () => {
		const engine = createCostEngine()
		// Drive spend to ~96% of 10$
		engine.trackCall(
			mockResponse({ cost: { inputCost: 5, outputCost: 4.6, totalCost: 9.6, currency: 'USD' } }),
		)

		const actions: BudgetAction[] = []
		const policy = createBudgetAwareRoutingPolicy({
			costEngine: engine,
			totalBudget: 10,
			downgradeThreshold: 0.7,
			rejectThreshold: 0.95,
			onAction: (a) => actions.push(a),
		})

		const c = ctx()
		const next = vi.fn(async () => mockResponse())

		await expect(policy(c, next)).rejects.toThrow(/budget/i)
		expect(next).not.toHaveBeenCalled()
		expect(actions[0].type).toBe('reject')
	})

	it('passes through (no downgrade) when no cheaper alternative exists', async () => {
		const engine = createCostEngine()
		engine.trackCall(
			mockResponse({ cost: { inputCost: 36, outputCost: 36, totalCost: 72, currency: 'USD' } }),
		)

		const actions: BudgetAction[] = []
		const policy = createBudgetAwareRoutingPolicy({
			costEngine: engine,
			totalBudget: 100,
			onAction: (a) => actions.push(a),
		})

		// Low-tier model: suggestModel returns null → policy passes through
		const c = ctx('claude-haiku-4-5-20251001')
		const next = vi.fn(async () => mockResponse())
		await policy(c, next)

		expect(actions[0].type).toBe('pass-through')
		expect(c.model).toBe('claude-haiku-4-5-20251001')
	})

	it('uses the configured thresholds, not defaults, when supplied', async () => {
		const engine = createCostEngine()
		engine.trackCall(
			mockResponse({ cost: { inputCost: 20, outputCost: 30, totalCost: 50, currency: 'USD' } }),
		)

		const actions: BudgetAction[] = []
		const policy = createBudgetAwareRoutingPolicy({
			costEngine: engine,
			totalBudget: 100,
			downgradeThreshold: 0.4, // tighter
			rejectThreshold: 0.55, // tighter
			onAction: (a) => actions.push(a),
		})

		// 50% spend ≥ downgrade 40% but < reject 55% → expect downgrade
		const c = ctx('claude-opus-4-6')
		await policy(c, async () => mockResponse())
		expect(actions[0].type).toBe('downgrade')
	})

	it('validates config — negative budget throws', () => {
		const engine = createCostEngine()
		expect(() => createBudgetAwareRoutingPolicy({ costEngine: engine, totalBudget: -1 })).toThrow(
			/positive/i,
		)
	})

	it('validates config — out-of-range thresholds throw', () => {
		const engine = createCostEngine()
		expect(() =>
			createBudgetAwareRoutingPolicy({
				costEngine: engine,
				totalBudget: 100,
				downgradeThreshold: 1.5,
			}),
		).toThrow(/downgradeThreshold/i)

		expect(() =>
			createBudgetAwareRoutingPolicy({
				costEngine: engine,
				totalBudget: 100,
				rejectThreshold: -0.1,
			}),
		).toThrow(/rejectThreshold/i)
	})

	it('validates config — rejectThreshold < downgradeThreshold throws', () => {
		const engine = createCostEngine()
		expect(() =>
			createBudgetAwareRoutingPolicy({
				costEngine: engine,
				totalBudget: 100,
				downgradeThreshold: 0.8,
				rejectThreshold: 0.5,
			}),
		).toThrow(/rejectThreshold must be >=/)
	})

	it('composes correctly with the cost engine middleware (downgrade tracked under new model)', async () => {
		const engine = createCostEngine()
		// 75% spend → downgrade triggers
		engine.trackCall(
			mockResponse({ cost: { inputCost: 37.5, outputCost: 37.5, totalCost: 75, currency: 'USD' } }),
		)

		const budgetPolicy = createBudgetAwareRoutingPolicy({
			costEngine: engine,
			totalBudget: 100,
		})
		const tracking = engine.middleware()

		const c = ctx('claude-opus-4-6', 'short prompt')

		// Compose by hand: budgetPolicy → tracking → terminal
		const downstream = async (ctxIn: MiddlewareContext): Promise<LLMResponse> => {
			return tracking(ctxIn, async () => mockResponse({ model: ctxIn.model }))
		}

		const before = engine.getReport().byModel
		await budgetPolicy(c, downstream)
		const after = engine.getReport().byModel

		// The terminal call should have been tracked under the downgraded model, not the original
		expect(after[c.model]).toBeDefined()
		expect(before[c.model]).toBeUndefined()
	})
})
