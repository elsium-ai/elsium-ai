import { observe } from '@elsium-ai/observe'
/**
 * Test 04: Observability
 * Verifies: observe(), tracer.startSpan(), tracer.getCostReport()
 */
import { describe, expect, it } from 'vitest'

describe('04 — Observability', () => {
	it('observe() returns a tracer with the expected API', () => {
		const tracer = observe({ output: ['console'], costTracking: true })

		expect(typeof tracer.startSpan).toBe('function')
		expect(typeof tracer.getSpans).toBe('function')
		expect(typeof tracer.getCostReport).toBe('function')
		expect(typeof tracer.trackLLMCall).toBe('function')
		expect(typeof tracer.reset).toBe('function')
		expect(typeof tracer.flush).toBe('function')
	})

	it('startSpan creates and ends spans', () => {
		const tracer = observe({ output: [], costTracking: false })

		const span = tracer.startSpan('test-operation', 'agent')

		expect(span.name).toBe('test-operation')
		expect(span.kind).toBe('agent')

		span.end()

		const spans = tracer.getSpans()
		expect(spans.length).toBeGreaterThanOrEqual(1)

		const found = spans.find((s) => s.name === 'test-operation')
		expect(found).toBeDefined()
		expect(found?.kind).toBe('agent')
	})

	it('trackLLMCall and getCostReport', () => {
		const tracer = observe({ output: [], costTracking: true })

		tracer.trackLLMCall({
			model: 'gpt-4o',
			inputTokens: 1000,
			outputTokens: 500,
			cost: 0.015,
			latencyMs: 200,
		})

		const report = tracer.getCostReport()

		expect(report.totalCost).toBe(0.015)
		expect(report.callCount).toBe(1)
		expect(report.totalInputTokens).toBe(1000)
		expect(report.totalOutputTokens).toBe(500)
	})

	it('tracer.reset() clears all data', () => {
		const tracer = observe({ output: [], costTracking: true })

		tracer.startSpan('x', 'tool').end()
		tracer.trackLLMCall({ model: 'm', inputTokens: 1, outputTokens: 1, cost: 0, latencyMs: 0 })

		tracer.reset()

		expect(tracer.getSpans()).toHaveLength(0)
		expect(tracer.getCostReport().callCount).toBe(0)
	})
})
