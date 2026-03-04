import { describe, expect, it, vi } from 'vitest'
import { observe } from './tracer'

describe('observe', () => {
	it('creates a tracer with default config', () => {
		const tracer = observe()
		expect(tracer).toBeDefined()
		expect(typeof tracer.startSpan).toBe('function')
		expect(typeof tracer.getSpans).toBe('function')
		expect(typeof tracer.getCostReport).toBe('function')
		expect(typeof tracer.trackLLMCall).toBe('function')
		expect(typeof tracer.flush).toBe('function')
		expect(typeof tracer.reset).toBe('function')
	})

	describe('startSpan', () => {
		it('returns a Span with expected shape', () => {
			const tracer = observe({ output: [] })
			const span = tracer.startSpan('my-operation', 'llm')

			expect(span.id).toMatch(/^spn_/)
			expect(span.traceId).toMatch(/^trc_/)
			expect(span.name).toBe('my-operation')
			expect(span.kind).toBe('llm')
		})

		it('returns a span with default kind when not specified', () => {
			const tracer = observe({ output: [] })
			const span = tracer.startSpan('op')

			expect(span.kind).toBe('custom')
		})

		it('records span in getSpans after it ends', () => {
			const tracer = observe({ output: [] })
			const span = tracer.startSpan('recorded-op')
			span.end()

			const spans = tracer.getSpans()
			expect(spans).toHaveLength(1)
			expect(spans[0].name).toBe('recorded-op')
		})
	})

	describe('sampling', () => {
		it('returns noop span when samplingRate is 0', () => {
			const tracer = observe({ output: [], samplingRate: 0 })
			const span = tracer.startSpan('op')
			span.end()

			// Noop spans are not recorded
			expect(tracer.getSpans()).toHaveLength(0)
		})

		it('returns real span when samplingRate is 1', () => {
			const tracer = observe({ output: [], samplingRate: 1 })
			const span = tracer.startSpan('op')
			span.end()

			expect(tracer.getSpans()).toHaveLength(1)
		})

		it('noop span methods are callable without error', () => {
			const tracer = observe({ output: [], samplingRate: 0 })
			const span = tracer.startSpan('noop')

			expect(() => span.addEvent('event')).not.toThrow()
			expect(() => span.setMetadata('key', 'val')).not.toThrow()
			expect(() => span.end()).not.toThrow()

			const child = span.child('child')
			expect(child).toBeDefined()
			expect(() => child.end()).not.toThrow()
		})

		it('noop span toJSON returns valid structure', () => {
			const tracer = observe({ output: [], samplingRate: 0 })
			const span = tracer.startSpan('noop')
			const data = span.toJSON()

			expect(data.name).toBe('noop')
			expect(data.status).toBe('ok')
			expect(data.metadata).toEqual({})
			expect(data.events).toEqual([])
		})
	})

	describe('trackLLMCall', () => {
		it('tracks LLM calls', () => {
			const tracer = observe({ output: [] })

			tracer.trackLLMCall({
				model: 'claude-3-5-sonnet',
				inputTokens: 100,
				outputTokens: 50,
				cost: 0.001,
				latencyMs: 200,
			})

			const report = tracer.getCostReport()
			expect(report.callCount).toBe(1)
			expect(report.totalInputTokens).toBe(100)
			expect(report.totalOutputTokens).toBe(50)
			expect(report.totalTokens).toBe(150)
			expect(report.totalCost).toBeCloseTo(0.001)
		})

		it('getCostReport aggregates multiple calls', () => {
			const tracer = observe({ output: [] })

			tracer.trackLLMCall({
				model: 'claude-3-5-sonnet',
				inputTokens: 100,
				outputTokens: 50,
				cost: 0.001,
				latencyMs: 200,
			})
			tracer.trackLLMCall({
				model: 'claude-3-5-sonnet',
				inputTokens: 200,
				outputTokens: 80,
				cost: 0.002,
				latencyMs: 300,
			})

			const report = tracer.getCostReport()
			expect(report.callCount).toBe(2)
			expect(report.totalInputTokens).toBe(300)
			expect(report.totalOutputTokens).toBe(130)
			expect(report.totalCost).toBeCloseTo(0.003)
		})

		it('getCostReport groups by model', () => {
			const tracer = observe({ output: [] })

			tracer.trackLLMCall({
				model: 'gpt-4',
				inputTokens: 10,
				outputTokens: 5,
				cost: 0.01,
				latencyMs: 100,
			})
			tracer.trackLLMCall({
				model: 'claude-3',
				inputTokens: 20,
				outputTokens: 10,
				cost: 0.02,
				latencyMs: 150,
			})
			tracer.trackLLMCall({
				model: 'gpt-4',
				inputTokens: 30,
				outputTokens: 15,
				cost: 0.03,
				latencyMs: 200,
			})

			const report = tracer.getCostReport()
			expect(report.byModel['gpt-4'].calls).toBe(2)
			expect(report.byModel['gpt-4'].tokens).toBe(60) // (10+5) + (30+15)
			expect(report.byModel['claude-3'].calls).toBe(1)
		})

		it('does not track when costTracking is false', () => {
			const tracer = observe({ output: [], costTracking: false })

			tracer.trackLLMCall({
				model: 'gpt-4',
				inputTokens: 100,
				outputTokens: 50,
				cost: 0.001,
				latencyMs: 200,
			})

			const report = tracer.getCostReport()
			expect(report.callCount).toBe(0)
		})

		it('getCostReport returns zero totals when no calls tracked', () => {
			const tracer = observe({ output: [] })
			const report = tracer.getCostReport()

			expect(report.callCount).toBe(0)
			expect(report.totalCost).toBe(0)
			expect(report.totalTokens).toBe(0)
			expect(report.totalInputTokens).toBe(0)
			expect(report.totalOutputTokens).toBe(0)
			expect(report.byModel).toEqual({})
		})
	})

	describe('flush', () => {
		it('calls all custom exporters with current spans', async () => {
			const exportFn = vi.fn()
			const exporter = { name: 'test', export: exportFn }

			const tracer = observe({ output: [exporter] })
			const span = tracer.startSpan('op')
			span.end()

			await tracer.flush()

			expect(exportFn).toHaveBeenCalledOnce()
			const passedSpans = exportFn.mock.calls[0][0]
			expect(passedSpans).toHaveLength(1)
			expect(passedSpans[0].name).toBe('op')
		})

		it('passes a copy of spans to exporters', async () => {
			const capturedSpans: unknown[] = []
			const exporter = {
				name: 'capture',
				export: (spans: unknown[]) => {
					capturedSpans.push(...spans)
				},
			}

			const tracer = observe({ output: [exporter] })
			const span = tracer.startSpan('op')
			span.end()

			await tracer.flush()

			expect(capturedSpans).toHaveLength(1)
		})

		it('calls multiple exporters', async () => {
			const exportA = vi.fn()
			const exportB = vi.fn()

			const tracer = observe({
				output: [
					{ name: 'a', export: exportA },
					{ name: 'b', export: exportB },
				],
			})

			const span = tracer.startSpan('op')
			span.end()

			await tracer.flush()

			expect(exportA).toHaveBeenCalledOnce()
			expect(exportB).toHaveBeenCalledOnce()
		})
	})

	describe('getSpans', () => {
		it('returns all recorded spans', () => {
			const tracer = observe({ output: [] })

			const s1 = tracer.startSpan('op-1', 'llm')
			const s2 = tracer.startSpan('op-2', 'tool')
			s1.end()
			s2.end()

			const spans = tracer.getSpans()
			expect(spans).toHaveLength(2)
			const names = spans.map((s) => s.name)
			expect(names).toContain('op-1')
			expect(names).toContain('op-2')
		})

		it('returns a copy — mutations do not affect internal state', () => {
			const tracer = observe({ output: [] })
			const span = tracer.startSpan('op')
			span.end()

			const spans = tracer.getSpans()
			spans.pop()

			expect(tracer.getSpans()).toHaveLength(1)
		})

		it('returns empty array initially', () => {
			const tracer = observe({ output: [] })
			expect(tracer.getSpans()).toEqual([])
		})
	})

	describe('reset', () => {
		it('clears all spans and LLM call records', () => {
			const tracer = observe({ output: [] })

			const span = tracer.startSpan('op')
			span.end()

			tracer.trackLLMCall({
				model: 'gpt-4',
				inputTokens: 10,
				outputTokens: 5,
				cost: 0.01,
				latencyMs: 100,
			})

			tracer.reset()

			expect(tracer.getSpans()).toHaveLength(0)
			expect(tracer.getCostReport().callCount).toBe(0)
		})
	})

	describe('maxSpans', () => {
		it('evicts oldest span when maxSpans is exceeded', () => {
			const tracer = observe({ output: [], maxSpans: 2 })

			const s1 = tracer.startSpan('op-1')
			s1.end()
			const s2 = tracer.startSpan('op-2')
			s2.end()
			const s3 = tracer.startSpan('op-3')
			s3.end()

			const spans = tracer.getSpans()
			expect(spans).toHaveLength(2)
			const names = spans.map((s) => s.name)
			expect(names).not.toContain('op-1')
			expect(names).toContain('op-2')
			expect(names).toContain('op-3')
		})
	})
})
