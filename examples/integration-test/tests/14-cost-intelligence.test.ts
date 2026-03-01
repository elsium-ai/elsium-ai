import { createCostEngine } from '@elsium-ai/observe'
/**
 * Test 14: Cost Intelligence
 * Verifies: createCostEngine, trackCall, getReport, suggestModel
 */
import { describe, expect, it } from 'vitest'
import { fakeLLMResponse } from '../lib/helpers'

describe('14 — Cost Intelligence', () => {
	it('createCostEngine returns the expected interface', () => {
		const engine = createCostEngine()

		expect(typeof engine.middleware).toBe('function')
		expect(typeof engine.getReport).toBe('function')
		expect(typeof engine.suggestModel).toBe('function')
		expect(typeof engine.trackCall).toBe('function')
		expect(typeof engine.reset).toBe('function')
	})

	it('trackCall records costs and getReport reflects them', () => {
		const engine = createCostEngine()

		engine.trackCall(
			fakeLLMResponse({
				model: 'gpt-4o',
				cost: { inputCost: 0.01, outputCost: 0.005, totalCost: 0.015, currency: 'USD' },
			}),
			{ agent: 'chat-agent', user: 'user-1', feature: 'chat' },
		)

		engine.trackCall(
			fakeLLMResponse({
				model: 'gpt-4o',
				cost: { inputCost: 0.02, outputCost: 0.01, totalCost: 0.03, currency: 'USD' },
			}),
			{ agent: 'chat-agent', user: 'user-2', feature: 'search' },
		)

		const report = engine.getReport()

		expect(report.totalSpend).toBeCloseTo(0.045)
		expect(report.totalCalls).toBe(2)
		expect(report.byModel['gpt-4o']).toBeDefined()
		expect(report.byModel['gpt-4o'].callCount).toBe(2)
		expect(report.byAgent['chat-agent']).toBeDefined()
		expect(report.byUser['user-1']).toBeDefined()
		expect(report.byUser['user-2']).toBeDefined()
		expect(report.byFeature.chat).toBeDefined()
		expect(report.byFeature.search).toBeDefined()
	})

	it('suggestModel recommends cheaper alternatives for high-tier models', () => {
		const engine = createCostEngine()

		const suggestion = engine.suggestModel('claude-opus-4-6', 100)

		expect(suggestion).not.toBeNull()
		expect(suggestion?.currentModel).toBe('claude-opus-4-6')
		expect(suggestion?.estimatedSavings).toBeGreaterThan(0)
	})

	it('suggestModel returns null for low-tier models', () => {
		const engine = createCostEngine()

		const suggestion = engine.suggestModel('gpt-4o-mini', 100)
		expect(suggestion).toBeNull()
	})

	it('reset() clears all tracked data', () => {
		const engine = createCostEngine()

		engine.trackCall(fakeLLMResponse())
		expect(engine.getReport().totalCalls).toBe(1)

		engine.reset()
		expect(engine.getReport().totalCalls).toBe(0)
		expect(engine.getReport().totalSpend).toBe(0)
	})

	it('onAlert callback fires on budget threshold', () => {
		const alerts: unknown[] = []

		const engine = createCostEngine({
			totalBudget: 1.0,
			alertThresholds: [0.5],
			onAlert: (alert) => alerts.push(alert),
		})

		// Track enough to exceed 50% of budget
		engine.trackCall(
			fakeLLMResponse({
				cost: { inputCost: 0.3, outputCost: 0.3, totalCost: 0.6, currency: 'USD' },
			}),
		)

		expect(alerts.length).toBeGreaterThan(0)
	})

	it('engine.middleware() returns a function', () => {
		const engine = createCostEngine({ totalBudget: 100 })
		const mw = engine.middleware()

		expect(typeof mw).toBe('function')
	})
})
