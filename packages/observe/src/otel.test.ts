import { describe, expect, it } from 'vitest'
import { parseTraceparent, toOTelExportRequest, toOTelSpan, toTraceparent } from './otel'
import type { SpanData } from './span'

// Minimal valid SpanData fixture
function makeSpanData(overrides: Partial<SpanData> = {}): SpanData {
	return {
		id: 'spn_abc123',
		traceId: 'trc_def456',
		name: 'test-span',
		kind: 'llm',
		status: 'ok',
		startTime: 1_700_000_000_000,
		endTime: 1_700_000_000_250,
		durationMs: 250,
		metadata: {},
		events: [],
		...overrides,
	}
}

describe('toOTelSpan', () => {
	it('converts a SpanData to OTel span format', () => {
		const span = makeSpanData()
		const otel = toOTelSpan(span)

		expect(otel.name).toBe('test-span')
		expect(otel.traceId).toHaveLength(32)
		expect(otel.spanId).toHaveLength(16)
		expect(typeof otel.startTimeUnixNano).toBe('string')
		expect(typeof otel.endTimeUnixNano).toBe('string')
	})

	it('maps llm kind to OTel CLIENT (3)', () => {
		const otel = toOTelSpan(makeSpanData({ kind: 'llm' }))
		expect(otel.kind).toBe(3)
	})

	it('maps tool kind to OTel INTERNAL (1)', () => {
		const otel = toOTelSpan(makeSpanData({ kind: 'tool' }))
		expect(otel.kind).toBe(1)
	})

	it('maps agent kind to OTel INTERNAL (1)', () => {
		const otel = toOTelSpan(makeSpanData({ kind: 'agent' }))
		expect(otel.kind).toBe(1)
	})

	it('maps workflow kind to OTel INTERNAL (1)', () => {
		const otel = toOTelSpan(makeSpanData({ kind: 'workflow' }))
		expect(otel.kind).toBe(1)
	})

	it('maps custom kind to OTel UNSPECIFIED (0)', () => {
		const otel = toOTelSpan(makeSpanData({ kind: 'custom' }))
		expect(otel.kind).toBe(0)
	})

	it('maps ok status to OTel OK (1)', () => {
		const otel = toOTelSpan(makeSpanData({ status: 'ok' }))
		expect(otel.status.code).toBe(1)
	})

	it('maps error status to OTel ERROR (2)', () => {
		const otel = toOTelSpan(makeSpanData({ status: 'error' }))
		expect(otel.status.code).toBe(2)
	})

	it('maps running status to OTel UNSET (0)', () => {
		const otel = toOTelSpan(makeSpanData({ status: 'running' }))
		expect(otel.status.code).toBe(0)
	})

	it('includes elsium.span.kind attribute', () => {
		const otel = toOTelSpan(makeSpanData({ kind: 'llm' }))
		const kindAttr = otel.attributes.find((a) => a.key === 'elsium.span.kind')
		expect(kindAttr).toBeDefined()
		expect(kindAttr?.value.stringValue).toBe('llm')
	})

	it('converts metadata to attributes with elsium. prefix', () => {
		const span = makeSpanData({ metadata: { model: 'gpt-4', tokens: 100 } })
		const otel = toOTelSpan(span)

		const modelAttr = otel.attributes.find((a) => a.key === 'elsium.model')
		const tokensAttr = otel.attributes.find((a) => a.key === 'elsium.tokens')

		expect(modelAttr?.value.stringValue).toBe('gpt-4')
		expect(tokensAttr?.value.intValue).toBe(100)
	})

	it('converts boolean metadata to boolValue', () => {
		const span = makeSpanData({ metadata: { cached: true } })
		const otel = toOTelSpan(span)

		const attr = otel.attributes.find((a) => a.key === 'elsium.cached')
		expect(attr?.value.boolValue).toBe(true)
	})

	it('converts float metadata to doubleValue', () => {
		const span = makeSpanData({ metadata: { cost: 0.0042 } })
		const otel = toOTelSpan(span)

		const attr = otel.attributes.find((a) => a.key === 'elsium.cost')
		expect(attr?.value.doubleValue).toBeCloseTo(0.0042)
	})

	it('serializes object metadata as JSON stringValue', () => {
		const span = makeSpanData({ metadata: { nested: { a: 1 } } })
		const otel = toOTelSpan(span)

		const attr = otel.attributes.find((a) => a.key === 'elsium.nested')
		expect(attr?.value.stringValue).toBe(JSON.stringify({ a: 1 }))
	})

	it('converts events to OTel events with nanosecond timestamps', () => {
		const span = makeSpanData({
			events: [{ name: 'cache-hit', timestamp: 1_700_000_000_100, data: { key: 'abc' } }],
		})
		const otel = toOTelSpan(span)

		expect(otel.events).toHaveLength(1)
		expect(otel.events[0].name).toBe('cache-hit')
		expect(otel.events[0].timeUnixNano).toBe(String(1_700_000_000_100 * 1_000_000))
		expect(otel.events[0].attributes).toHaveLength(1)
		expect(otel.events[0].attributes[0].key).toBe('key')
	})

	it('converts events without data to empty attributes', () => {
		const span = makeSpanData({
			events: [{ name: 'start', timestamp: 1_700_000_000_000 }],
		})
		const otel = toOTelSpan(span)

		expect(otel.events[0].attributes).toEqual([])
	})

	it('includes parentSpanId when parentId is present', () => {
		const span = makeSpanData({ parentId: 'spn_parent99' })
		const otel = toOTelSpan(span)

		expect(otel.parentSpanId).toBeDefined()
		expect(otel.parentSpanId).toHaveLength(16)
	})

	it('omits parentSpanId when no parentId', () => {
		const span = makeSpanData({ parentId: undefined })
		const otel = toOTelSpan(span)

		expect(otel.parentSpanId).toBeUndefined()
	})

	it('uses startTime for endTimeUnixNano when endTime is absent', () => {
		const span = makeSpanData({ endTime: undefined })
		const otel = toOTelSpan(span)

		expect(otel.endTimeUnixNano).toBe(otel.startTimeUnixNano)
	})

	it('converts startTime to nanoseconds string', () => {
		const span = makeSpanData({ startTime: 1000 })
		const otel = toOTelSpan(span)

		expect(otel.startTimeUnixNano).toBe(String(1000 * 1_000_000))
	})
})

describe('toOTelExportRequest', () => {
	it('builds a valid OTel export request envelope', () => {
		const spans = [makeSpanData()]
		const req = toOTelExportRequest(spans)

		expect(req.resourceSpans).toHaveLength(1)
		expect(req.resourceSpans[0].scopeSpans).toHaveLength(1)
		expect(req.resourceSpans[0].scopeSpans[0].spans).toHaveLength(1)
	})

	it('uses default service name and version', () => {
		const req = toOTelExportRequest([makeSpanData()])
		const resourceAttrs = req.resourceSpans[0].resource.attributes

		const serviceName = resourceAttrs.find((a) => a.key === 'service.name')
		const serviceVersion = resourceAttrs.find((a) => a.key === 'service.version')

		expect(serviceName?.value.stringValue).toBe('elsium-ai')
		expect(serviceVersion?.value.stringValue).toBe('0.1.0')
	})

	it('uses provided service name and version', () => {
		const req = toOTelExportRequest([makeSpanData()], {
			serviceName: 'my-service',
			serviceVersion: '2.0.0',
		})
		const resourceAttrs = req.resourceSpans[0].resource.attributes

		const serviceName = resourceAttrs.find((a) => a.key === 'service.name')
		expect(serviceName?.value.stringValue).toBe('my-service')
	})

	it('includes telemetry SDK attributes', () => {
		const req = toOTelExportRequest([makeSpanData()])
		const resourceAttrs = req.resourceSpans[0].resource.attributes

		const sdkName = resourceAttrs.find((a) => a.key === 'telemetry.sdk.name')
		const sdkLang = resourceAttrs.find((a) => a.key === 'telemetry.sdk.language')

		expect(sdkName?.value.stringValue).toBe('elsium-ai')
		expect(sdkLang?.value.stringValue).toBe('typescript')
	})

	it('includes scope with name and version', () => {
		const req = toOTelExportRequest([makeSpanData()], { serviceVersion: '1.2.3' })
		const scope = req.resourceSpans[0].scopeSpans[0].scope

		expect(scope.name).toBe('@elsium-ai/observe')
		expect(scope.version).toBe('1.2.3')
	})

	it('converts all spans in the batch', () => {
		const spans = [makeSpanData({ name: 'op-1' }), makeSpanData({ name: 'op-2' })]
		const req = toOTelExportRequest(spans)
		const otelSpans = req.resourceSpans[0].scopeSpans[0].spans

		expect(otelSpans).toHaveLength(2)
		expect(otelSpans[0].name).toBe('op-1')
		expect(otelSpans[1].name).toBe('op-2')
	})

	it('handles an empty span array', () => {
		const req = toOTelExportRequest([])
		const otelSpans = req.resourceSpans[0].scopeSpans[0].spans
		expect(otelSpans).toHaveLength(0)
	})
})

describe('toTraceparent + parseTraceparent roundtrip', () => {
	it('produces a valid W3C traceparent header', () => {
		const span = makeSpanData()
		const header = toTraceparent(span)

		// Format: 00-<32 hex>-<16 hex>-01
		expect(header).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)
	})

	it('roundtrips through parseTraceparent', () => {
		const span = makeSpanData()
		const header = toTraceparent(span)
		const ctx = parseTraceparent(header)

		expect(ctx).not.toBeNull()
		expect(ctx?.traceId).toHaveLength(32)
		expect(ctx?.spanId).toHaveLength(16)
		expect(ctx?.traceFlags).toBe(1) // 0x01 = sampled
	})

	it('parsed traceId matches toOTelSpan traceId', () => {
		const span = makeSpanData()
		const header = toTraceparent(span)
		const ctx = parseTraceparent(header)
		const otel = toOTelSpan(span)

		expect(ctx?.traceId).toBe(otel.traceId)
	})

	it('parsed spanId matches toOTelSpan spanId', () => {
		const span = makeSpanData()
		const header = toTraceparent(span)
		const ctx = parseTraceparent(header)
		const otel = toOTelSpan(span)

		expect(ctx?.spanId).toBe(otel.spanId)
	})
})

describe('parseTraceparent', () => {
	it('returns null for invalid format (too few parts)', () => {
		expect(parseTraceparent('00-abc-def')).toBeNull()
	})

	it('returns null for wrong version', () => {
		const validTraceId = '4bf92f3577b34da6a3ce929d0e0e4736'
		const validSpanId = '00f067aa0ba902b7'
		expect(parseTraceparent(`01-${validTraceId}-${validSpanId}-01`)).toBeNull()
	})

	it('returns null when traceId is wrong length', () => {
		expect(parseTraceparent('00-tooshort-00f067aa0ba902b7-01')).toBeNull()
	})

	it('returns null when spanId is wrong length', () => {
		const validTraceId = '4bf92f3577b34da6a3ce929d0e0e4736'
		expect(parseTraceparent(`00-${validTraceId}-tooshort-01`)).toBeNull()
	})

	it('parses a valid traceparent correctly', () => {
		const header = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
		const ctx = parseTraceparent(header)

		expect(ctx).not.toBeNull()
		expect(ctx?.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
		expect(ctx?.spanId).toBe('00f067aa0ba902b7')
		expect(ctx?.traceFlags).toBe(1)
	})

	it('handles traceFlags of 0x00 (not sampled)', () => {
		const header = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00'
		const ctx = parseTraceparent(header)

		expect(ctx?.traceFlags).toBe(0)
	})

	it('trims whitespace before parsing', () => {
		const header = '  00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01  '
		const ctx = parseTraceparent(header)
		expect(ctx).not.toBeNull()
	})
})
