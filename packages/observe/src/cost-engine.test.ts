import type { LLMResponse } from '@elsium-ai/core'
import { describe, expect, it } from 'vitest'
import { createCostEngine } from './cost-engine'

function mockResponse(overrides: Partial<LLMResponse> = {}): LLMResponse {
	return {
		id: 'msg_123',
		message: { role: 'assistant', content: 'Hello!' },
		usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
		cost: { inputCost: 0.0003, outputCost: 0.00075, totalCost: 0.00105, currency: 'USD' },
		model: 'claude-sonnet-4-6',
		provider: 'anthropic',
		stopReason: 'end_turn',
		latencyMs: 200,
		traceId: 'trc_test',
		...overrides,
	}
}

describe('createCostEngine', () => {
	it('should track costs', () => {
		const engine = createCostEngine()
		engine.trackCall(mockResponse())

		const report = engine.getReport()
		expect(report.totalSpend).toBeCloseTo(0.00105)
		expect(report.totalTokens).toBe(150)
		expect(report.totalCalls).toBe(1)
	})

	it('should track by model', () => {
		const engine = createCostEngine()
		engine.trackCall(mockResponse({ model: 'claude-sonnet-4-6' }))
		engine.trackCall(mockResponse({ model: 'gpt-4o' }))

		const report = engine.getReport()
		expect(Object.keys(report.byModel)).toHaveLength(2)
		expect(report.byModel['claude-sonnet-4-6'].callCount).toBe(1)
		expect(report.byModel['gpt-4o'].callCount).toBe(1)
	})

	it('should track by agent and user dimensions', () => {
		const engine = createCostEngine()
		engine.trackCall(mockResponse(), { agent: 'research-bot', user: 'user-1' })
		engine.trackCall(mockResponse(), { agent: 'research-bot', user: 'user-2' })
		engine.trackCall(mockResponse(), { agent: 'support-bot', user: 'user-1' })

		const report = engine.getReport()
		expect(report.byAgent['research-bot'].callCount).toBe(2)
		expect(report.byAgent['support-bot'].callCount).toBe(1)
		expect(report.byUser['user-1'].callCount).toBe(2)
		expect(report.byUser['user-2'].callCount).toBe(1)
	})

	it('should enforce total budget', () => {
		const engine = createCostEngine({ totalBudget: 0.001 })

		expect(() => {
			engine.trackCall(
				mockResponse({
					cost: { inputCost: 0.5, outputCost: 0.6, totalCost: 1.1, currency: 'USD' },
				}),
			)
		}).toThrow()
	})

	it('should enforce per-agent budget', () => {
		const engine = createCostEngine({ perAgent: 0.001 })

		expect(() => {
			engine.trackCall(
				mockResponse({
					cost: { inputCost: 0.5, outputCost: 0.6, totalCost: 1.1, currency: 'USD' },
				}),
				{ agent: 'expensive-bot' },
			)
		}).toThrow()
	})

	it('should detect loops', () => {
		const alerts: Array<{ type: string }> = []
		const engine = createCostEngine({
			loopDetection: { maxCallsPerMinute: 5 },
			onAlert: (alert) => alerts.push(alert),
		})

		for (let i = 0; i < 7; i++) {
			engine.trackCall(mockResponse())
		}

		expect(alerts.some((a) => a.type === 'loop_detected')).toBe(true)
	})

	it('should emit threshold alerts', () => {
		const alerts: Array<{ type: string; message: string }> = []
		const engine = createCostEngine({
			totalBudget: 1.0,
			alertThresholds: [0.5, 0.8],
			onAlert: (alert) => alerts.push(alert),
		})

		// Spend enough to trigger 50% threshold
		engine.trackCall(
			mockResponse({ cost: { inputCost: 0.3, outputCost: 0.3, totalCost: 0.6, currency: 'USD' } }),
		)

		expect(alerts.some((a) => a.type === 'threshold' && a.message.includes('50%'))).toBe(true)
	})

	it('should suggest cheaper models', () => {
		const engine = createCostEngine()
		const suggestion = engine.suggestModel('claude-opus-4-6', 200)

		expect(suggestion).not.toBeNull()
		expect(suggestion?.estimatedSavings).toBeGreaterThan(0)
	})

	it('should not suggest for already cheap models', () => {
		const engine = createCostEngine()
		const suggestion = engine.suggestModel('claude-haiku-4-5-20251001', 100)

		expect(suggestion).toBeNull()
	})

	it('should generate projected spend', () => {
		const engine = createCostEngine()
		engine.trackCall(mockResponse())

		const report = engine.getReport()
		expect(report.projectedDailySpend).toBeGreaterThan(0)
		expect(report.projectedMonthlySpend).toBeGreaterThan(0)
	})

	it('should reset all data', () => {
		const engine = createCostEngine()
		engine.trackCall(mockResponse(), { agent: 'bot', user: 'u1' })

		engine.reset()

		const report = engine.getReport()
		expect(report.totalSpend).toBe(0)
		expect(report.totalCalls).toBe(0)
		expect(Object.keys(report.byModel)).toHaveLength(0)
	})

	it('should work as middleware', async () => {
		const engine = createCostEngine()
		const mw = engine.middleware()

		const ctx = {
			request: { messages: [{ role: 'user' as const, content: 'Hi' }] },
			provider: 'anthropic',
			model: 'claude-sonnet-4-6',
			traceId: 'trc_1',
			startTime: performance.now(),
			metadata: { agentName: 'test-agent' },
		}

		const response = mockResponse()
		await mw(ctx, async () => response)

		const report = engine.getReport()
		expect(report.totalCalls).toBe(1)
		expect(report.byAgent['test-agent']).toBeDefined()
	})
})
