import { describe, expect, it, vi } from 'vitest'
import { createMetrics, createSpan, observe } from './index'
import {
	createOTLPExporter,
	extractTraceContext,
	injectTraceContext,
	parseTraceparent,
	toOTelExportRequest,
	toOTelSpan,
	toTraceparent,
} from './otel'
import type { SpanData } from './span'

// ─── Span ────────────────────────────────────────────────────────

describe('createSpan', () => {
	it('creates a span with defaults', () => {
		const span = createSpan('test-operation')
		expect(span.name).toBe('test-operation')
		expect(span.kind).toBe('custom')
		expect(span.id).toMatch(/^spn_/)
		expect(span.traceId).toMatch(/^trc_/)
	})

	it('records events', () => {
		const span = createSpan('operation')
		span.addEvent('started', { step: 1 })
		span.addEvent('completed')
		span.end()

		const data = span.toJSON()
		expect(data.events).toHaveLength(2)
		expect(data.events[0].name).toBe('started')
		expect(data.events[0].data).toEqual({ step: 1 })
	})

	it('sets metadata', () => {
		const span = createSpan('operation')
		span.setMetadata('model', 'claude-sonnet')
		span.setMetadata('tokens', 100)
		span.end()

		const data = span.toJSON()
		expect(data.metadata.model).toBe('claude-sonnet')
		expect(data.metadata.tokens).toBe(100)
	})

	it('measures duration on end', () => {
		const span = createSpan('operation')
		span.end()

		const data = span.toJSON()
		expect(data.status).toBe('ok')
		expect(data.durationMs).toBeDefined()
		expect(data.durationMs).toBeGreaterThanOrEqual(0)
	})

	it('records error status', () => {
		const span = createSpan('operation')
		span.end({ status: 'error', metadata: { error: 'boom' } })

		const data = span.toJSON()
		expect(data.status).toBe('error')
		expect(data.metadata.error).toBe('boom')
	})

	it('ignores duplicate end calls', () => {
		const handler = vi.fn()
		const span = createSpan('operation', { onEnd: handler })
		span.end()
		span.end()

		expect(handler).toHaveBeenCalledOnce()
	})

	it('creates child spans', () => {
		const parent = createSpan('parent', { kind: 'agent' })
		const child = parent.child('child-step', 'tool')

		expect(child.traceId).toBe(parent.traceId)
		expect(child.kind).toBe('tool')

		const childData = child.toJSON()
		expect(childData.parentId).toBe(parent.id)
	})

	it('calls onEnd handler', () => {
		const handler = vi.fn()
		const span = createSpan('operation', { onEnd: handler })
		span.end()

		expect(handler).toHaveBeenCalledOnce()
		const data = handler.mock.calls[0][0]
		expect(data.name).toBe('operation')
		expect(data.status).toBe('ok')
	})
})

// ─── Tracer ──────────────────────────────────────────────────────

describe('observe', () => {
	it('creates tracer with defaults', () => {
		const tracer = observe({ output: [] })
		expect(tracer.getSpans()).toHaveLength(0)
	})

	it('collects spans', () => {
		const tracer = observe({ output: [] })

		const span1 = tracer.startSpan('op1', 'llm')
		span1.end()

		const span2 = tracer.startSpan('op2', 'tool')
		span2.end()

		expect(tracer.getSpans()).toHaveLength(2)
		expect(tracer.getSpans()[0].name).toBe('op1')
		expect(tracer.getSpans()[1].name).toBe('op2')
	})

	it('tracks LLM costs', () => {
		const tracer = observe({ output: [], costTracking: true })

		tracer.trackLLMCall({
			model: 'claude-sonnet-4-6',
			inputTokens: 1000,
			outputTokens: 500,
			cost: 0.0105,
			latencyMs: 200,
		})

		tracer.trackLLMCall({
			model: 'claude-sonnet-4-6',
			inputTokens: 2000,
			outputTokens: 800,
			cost: 0.018,
			latencyMs: 350,
		})

		tracer.trackLLMCall({
			model: 'gpt-4o',
			inputTokens: 500,
			outputTokens: 200,
			cost: 0.0032,
			latencyMs: 150,
		})

		const report = tracer.getCostReport()

		expect(report.callCount).toBe(3)
		expect(report.totalCost).toBeCloseTo(0.0317, 4)
		expect(report.totalInputTokens).toBe(3500)
		expect(report.totalOutputTokens).toBe(1500)
		expect(report.totalTokens).toBe(5000)

		expect(report.byModel['claude-sonnet-4-6'].calls).toBe(2)
		expect(report.byModel['gpt-4o'].calls).toBe(1)
	})

	it('respects sampling rate', () => {
		const tracer = observe({ output: [], samplingRate: 0 })

		const span = tracer.startSpan('sampled-out')
		span.end()

		// With 0% sampling, spans should not be collected
		expect(tracer.getSpans()).toHaveLength(0)
	})

	it('resets all data', () => {
		const tracer = observe({ output: [] })

		tracer.startSpan('op').end()
		tracer.trackLLMCall({
			model: 'test',
			inputTokens: 10,
			outputTokens: 5,
			cost: 0.001,
			latencyMs: 10,
		})

		tracer.reset()

		expect(tracer.getSpans()).toHaveLength(0)
		expect(tracer.getCostReport().callCount).toBe(0)
	})

	it('enforces maxSpans limit', () => {
		const tracer = observe({ output: [], maxSpans: 3 })

		for (let i = 0; i < 5; i++) {
			tracer.startSpan(`op-${i}`).end()
		}

		const spans = tracer.getSpans()
		expect(spans).toHaveLength(3)
		expect(spans[0].name).toBe('op-2')
		expect(spans[2].name).toBe('op-4')
	})

	it('calls custom exporter on flush', async () => {
		const exportFn = vi.fn()
		const tracer = observe({
			output: [{ name: 'test', export: exportFn }],
		})

		tracer.startSpan('op1').end()
		tracer.startSpan('op2').end()

		await tracer.flush()

		expect(exportFn).toHaveBeenCalledOnce()
		expect(exportFn.mock.calls[0][0]).toHaveLength(2)
	})

	it('logs to console when configured', () => {
		const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
		const tracer = observe({ output: ['console'] })

		tracer.startSpan('my-op', 'llm').end()

		expect(spy).toHaveBeenCalledOnce()
		const logged = JSON.parse(spy.mock.calls[0][0] as string)
		expect(logged.span).toBe('my-op')
		expect(logged.kind).toBe('llm')

		spy.mockRestore()
	})
})

// ─── Metrics ─────────────────────────────────────────────────────

describe('createMetrics', () => {
	it('increments counters', () => {
		const metrics = createMetrics()

		metrics.increment('requests', 1, { endpoint: '/chat' })
		metrics.increment('requests', 1, { endpoint: '/chat' })

		const all = metrics.getMetrics()
		expect(all).toHaveLength(2)
		expect(all[1].value).toBe(2)
	})

	it('sets gauges', () => {
		const metrics = createMetrics()

		metrics.gauge('memory_mb', 256)
		metrics.gauge('memory_mb', 300)

		const all = metrics.getMetrics()
		expect(all).toHaveLength(2)
		expect(all[1].value).toBe(300)
	})

	it('records histograms', () => {
		const metrics = createMetrics()

		metrics.histogram('latency_ms', 50, { model: 'sonnet' })
		metrics.histogram('latency_ms', 120, { model: 'sonnet' })
		metrics.histogram('latency_ms', 80, { model: 'sonnet' })

		const all = metrics.getMetrics()
		expect(all).toHaveLength(3)
		expect(all.every((m) => m.type === 'histogram')).toBe(true)
	})

	it('resets all metrics', () => {
		const metrics = createMetrics()

		metrics.increment('a')
		metrics.gauge('b', 1)
		metrics.histogram('c', 10)

		metrics.reset()
		expect(metrics.getMetrics()).toHaveLength(0)
	})
})

// ─── OpenTelemetry Compatibility ────────────────────────────────

describe('OTel - toOTelSpan', () => {
	const mockSpan: SpanData = {
		id: 'spn_abc123',
		traceId: 'trc_def456789012',
		parentId: 'spn_parent1',
		name: 'llm.complete',
		kind: 'llm',
		status: 'ok',
		startTime: 1000,
		endTime: 1500,
		durationMs: 500,
		metadata: { model: 'claude-sonnet', tokens: 150 },
		events: [
			{ name: 'request_sent', timestamp: 1050 },
			{ name: 'response_received', timestamp: 1480, data: { status: 200 } },
		],
	}

	it('converts span to OTel format', () => {
		const otel = toOTelSpan(mockSpan)

		expect(otel.name).toBe('llm.complete')
		expect(otel.kind).toBe(3) // CLIENT for llm
		expect(otel.status.code).toBe(1) // OK
		expect(otel.traceId).toHaveLength(32)
		expect(otel.spanId).toHaveLength(16)
		expect(otel.parentSpanId).toHaveLength(16)
	})

	it('maps span kinds correctly', () => {
		const kinds = ['llm', 'tool', 'agent', 'workflow', 'custom'] as const
		const expected = [3, 1, 1, 1, 0]

		for (let i = 0; i < kinds.length; i++) {
			const otel = toOTelSpan({ ...mockSpan, kind: kinds[i] })
			expect(otel.kind).toBe(expected[i])
		}
	})

	it('maps status codes correctly', () => {
		expect(toOTelSpan({ ...mockSpan, status: 'ok' }).status.code).toBe(1)
		expect(toOTelSpan({ ...mockSpan, status: 'error' }).status.code).toBe(2)
		expect(toOTelSpan({ ...mockSpan, status: 'running' }).status.code).toBe(0)
	})

	it('converts metadata to OTel attributes', () => {
		const otel = toOTelSpan(mockSpan)

		const modelAttr = otel.attributes.find((a) => a.key === 'elsium.model')
		expect(modelAttr?.value.stringValue).toBe('claude-sonnet')

		const tokensAttr = otel.attributes.find((a) => a.key === 'elsium.tokens')
		expect(tokensAttr?.value.intValue).toBe(150)
	})

	it('converts events to OTel events', () => {
		const otel = toOTelSpan(mockSpan)

		expect(otel.events).toHaveLength(2)
		expect(otel.events[0].name).toBe('request_sent')
		expect(otel.events[1].name).toBe('response_received')
		expect(otel.events[1].attributes).toHaveLength(1)
	})

	it('handles spans without parentId', () => {
		const rootSpan = { ...mockSpan, parentId: undefined }
		const otel = toOTelSpan(rootSpan)
		expect(otel.parentSpanId).toBeUndefined()
	})

	it('handles spans without endTime', () => {
		const runningSpan = { ...mockSpan, endTime: undefined }
		const otel = toOTelSpan(runningSpan)
		expect(otel.endTimeUnixNano).toBe(otel.startTimeUnixNano)
	})
})

describe('OTel - toOTelExportRequest', () => {
	it('builds a valid OTLP export request', () => {
		const span: SpanData = {
			id: 'spn_test',
			traceId: 'trc_test',
			name: 'test.op',
			kind: 'custom',
			status: 'ok',
			startTime: 1000,
			endTime: 2000,
			metadata: {},
			events: [],
		}

		const request = toOTelExportRequest([span], {
			serviceName: 'my-service',
			serviceVersion: '1.0.0',
		})

		expect(request.resourceSpans).toHaveLength(1)
		expect(request.resourceSpans[0].resource.attributes).toHaveLength(4)

		const serviceAttr = request.resourceSpans[0].resource.attributes.find(
			(a) => a.key === 'service.name',
		)
		expect(serviceAttr?.value.stringValue).toBe('my-service')

		expect(request.resourceSpans[0].scopeSpans[0].spans).toHaveLength(1)
		expect(request.resourceSpans[0].scopeSpans[0].scope.name).toBe('@elsium-ai/observe')
	})

	it('uses defaults when options not provided', () => {
		const request = toOTelExportRequest([])
		const serviceAttr = request.resourceSpans[0].resource.attributes.find(
			(a) => a.key === 'service.name',
		)
		expect(serviceAttr?.value.stringValue).toBe('elsium-ai')
	})
})

describe('OTel - W3C Trace Context', () => {
	const span: SpanData = {
		id: 'spn_abc123',
		traceId: 'trc_def456789012345',
		name: 'test',
		kind: 'custom',
		status: 'ok',
		startTime: 0,
		metadata: {},
		events: [],
	}

	it('generates valid traceparent header', () => {
		const traceparent = toTraceparent(span)
		const parts = traceparent.split('-')

		expect(parts).toHaveLength(4)
		expect(parts[0]).toBe('00') // version
		expect(parts[1]).toHaveLength(32) // trace-id
		expect(parts[2]).toHaveLength(16) // parent-id
		expect(parts[3]).toBe('01') // flags (sampled)
	})

	it('parses valid traceparent', () => {
		const ctx = parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')

		expect(ctx).not.toBeNull()
		expect(ctx?.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
		expect(ctx?.spanId).toBe('00f067aa0ba902b7')
		expect(ctx?.traceFlags).toBe(1)
	})

	it('returns null for invalid traceparent', () => {
		expect(parseTraceparent('invalid')).toBeNull()
		expect(parseTraceparent('01-abc-def-00')).toBeNull() // wrong version
		expect(parseTraceparent('00-short-short-01')).toBeNull() // wrong lengths
	})

	it('injects trace context into headers', () => {
		const headers = injectTraceContext(span, { 'Content-Type': 'application/json' })

		expect(headers['Content-Type']).toBe('application/json')
		expect(headers.traceparent).toBeDefined()
		expect(headers.traceparent.startsWith('00-')).toBe(true)
	})

	it('extracts trace context from headers', () => {
		const ctx = extractTraceContext({
			traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
		})

		expect(ctx).not.toBeNull()
		expect(ctx?.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
	})

	it('extracts with capitalized header name', () => {
		const ctx = extractTraceContext({
			Traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
		})
		expect(ctx).not.toBeNull()
	})

	it('returns null when no traceparent header', () => {
		expect(extractTraceContext({})).toBeNull()
		expect(extractTraceContext({ other: 'header' })).toBeNull()
	})
})

describe('OTel - OTLP Exporter', () => {
	it('creates an exporter with name', () => {
		const exporter = createOTLPExporter({
			endpoint: 'http://localhost:4318/v1/traces',
		})
		expect(exporter.name).toBe('otlp')
	})

	it('exports spans via fetch', async () => {
		const fetchSpy = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValue(new Response(null, { status: 200 }))

		const exporter = createOTLPExporter({
			endpoint: 'http://localhost:4318/v1/traces',
			serviceName: 'test-service',
			batchSize: 1,
		})

		const span: SpanData = {
			id: 'spn_exp',
			traceId: 'trc_exp',
			name: 'exported.op',
			kind: 'llm',
			status: 'ok',
			startTime: 1000,
			endTime: 2000,
			metadata: {},
			events: [],
		}

		await exporter.export([span])

		expect(fetchSpy).toHaveBeenCalledOnce()
		const [url, options] = fetchSpy.mock.calls[0]
		expect(url).toBe('http://localhost:4318/v1/traces')
		expect(options.method).toBe('POST')
		expect(options.headers['Content-Type']).toBe('application/json')

		const body = JSON.parse(options.body as string)
		expect(body.resourceSpans).toHaveLength(1)
		expect(body.resourceSpans[0].scopeSpans[0].spans).toHaveLength(1)

		fetchSpy.mockRestore()
	})

	it('handles export errors gracefully', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'))
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

		const exporter = createOTLPExporter({
			endpoint: 'http://localhost:4318/v1/traces',
			batchSize: 1,
		})

		await exporter.export([
			{
				id: 'spn_err',
				traceId: 'trc_err',
				name: 'error.op',
				kind: 'custom',
				status: 'ok',
				startTime: 0,
				metadata: {},
				events: [],
			},
		])

		expect(consoleSpy).toHaveBeenCalled()

		fetchSpy.mockRestore()
		consoleSpy.mockRestore()
	})

	it('sends custom headers', async () => {
		const fetchSpy = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValue(new Response(null, { status: 200 }))

		const exporter = createOTLPExporter({
			endpoint: 'http://localhost:4318/v1/traces',
			headers: { Authorization: 'Bearer test-token' },
			batchSize: 1,
		})

		await exporter.export([
			{
				id: 'spn_auth',
				traceId: 'trc_auth',
				name: 'auth.op',
				kind: 'custom',
				status: 'ok',
				startTime: 0,
				metadata: {},
				events: [],
			},
		])

		const [, options] = fetchSpy.mock.calls[0]
		expect(options.headers.Authorization).toBe('Bearer test-token')

		fetchSpy.mockRestore()
	})

	it('buffers spans below batch size', async () => {
		const fetchSpy = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValue(new Response(null, { status: 200 }))

		const exporter = createOTLPExporter({
			endpoint: 'http://localhost:4318/v1/traces',
			batchSize: 10,
			flushIntervalMs: 60000, // won't trigger in test
		})

		await exporter.export([
			{
				id: 'spn_buf',
				traceId: 'trc_buf',
				name: 'buffered.op',
				kind: 'custom',
				status: 'ok',
				startTime: 0,
				metadata: {},
				events: [],
			},
		])

		// Should not have sent yet (below batch size)
		expect(fetchSpy).not.toHaveBeenCalled()

		fetchSpy.mockRestore()
	})
})

describe('OTel - attribute type handling', () => {
	it('handles string metadata', () => {
		const span: SpanData = {
			id: 'spn_t',
			traceId: 'trc_t',
			name: 'test',
			kind: 'custom',
			status: 'ok',
			startTime: 0,
			metadata: { key: 'value' },
			events: [],
		}
		const otel = toOTelSpan(span)
		const attr = otel.attributes.find((a) => a.key === 'elsium.key')
		expect(attr?.value.stringValue).toBe('value')
	})

	it('handles boolean metadata', () => {
		const span: SpanData = {
			id: 'spn_t',
			traceId: 'trc_t',
			name: 'test',
			kind: 'custom',
			status: 'ok',
			startTime: 0,
			metadata: { enabled: true },
			events: [],
		}
		const otel = toOTelSpan(span)
		const attr = otel.attributes.find((a) => a.key === 'elsium.enabled')
		expect(attr?.value.boolValue).toBe(true)
	})

	it('handles float metadata', () => {
		const span: SpanData = {
			id: 'spn_t',
			traceId: 'trc_t',
			name: 'test',
			kind: 'custom',
			status: 'ok',
			startTime: 0,
			metadata: { score: 0.95 },
			events: [],
		}
		const otel = toOTelSpan(span)
		const attr = otel.attributes.find((a) => a.key === 'elsium.score')
		expect(attr?.value.doubleValue).toBe(0.95)
	})

	it('handles object metadata as JSON string', () => {
		const span: SpanData = {
			id: 'spn_t',
			traceId: 'trc_t',
			name: 'test',
			kind: 'custom',
			status: 'ok',
			startTime: 0,
			metadata: { config: { a: 1 } },
			events: [],
		}
		const otel = toOTelSpan(span)
		const attr = otel.attributes.find((a) => a.key === 'elsium.config')
		expect(attr?.value.stringValue).toBe('{"a":1}')
	})
})
