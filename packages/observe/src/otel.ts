/**
 * OpenTelemetry compatibility layer.
 *
 * Converts ElsiumAI spans to OTel-compatible format and provides:
 * - W3C Trace Context propagation (traceparent/tracestate headers)
 * - OTel-compatible span export format
 * - OTLP JSON exporter for sending to any OTel-compatible backend
 *   (Jaeger, Grafana Tempo, Datadog, Honeycomb, etc.)
 */

import type { SpanData, SpanKind } from './span'
import type { TracerExporter } from './tracer'

// ─── OTel Span Format ───────────────────────────────────────────

export interface OTelSpan {
	traceId: string
	spanId: string
	parentSpanId?: string
	name: string
	kind: OTelSpanKind
	startTimeUnixNano: string
	endTimeUnixNano: string
	attributes: OTelAttribute[]
	events: OTelEvent[]
	status: {
		code: OTelStatusCode
		message?: string
	}
}

export type OTelSpanKind = 0 | 1 | 2 | 3 | 4 | 5
// 0 = UNSPECIFIED, 1 = INTERNAL, 2 = SERVER, 3 = CLIENT, 4 = PRODUCER, 5 = CONSUMER

export type OTelStatusCode = 0 | 1 | 2
// 0 = UNSET, 1 = OK, 2 = ERROR

export interface OTelAttribute {
	key: string
	value: OTelAttributeValue
}

export interface OTelAttributeValue {
	stringValue?: string
	intValue?: number
	doubleValue?: number
	boolValue?: boolean
	arrayValue?: { values: OTelAttributeValue[] }
}

export interface OTelEvent {
	name: string
	timeUnixNano: string
	attributes: OTelAttribute[]
}

export interface OTelResource {
	attributes: OTelAttribute[]
}

export interface OTelExportRequest {
	resourceSpans: Array<{
		resource: OTelResource
		scopeSpans: Array<{
			scope: {
				name: string
				version: string
			}
			spans: OTelSpan[]
		}>
	}>
}

// ─── Mapping ────────────────────────────────────────────────────

const SPAN_KIND_MAP: Record<SpanKind, OTelSpanKind> = {
	llm: 3, // CLIENT — calling an external LLM service
	tool: 1, // INTERNAL
	agent: 1, // INTERNAL
	workflow: 1, // INTERNAL
	custom: 0, // UNSPECIFIED
}

function toNanoString(ms: number): string {
	return String(Math.round(ms * 1_000_000))
}

function toOTelAttribute(key: string, value: unknown): OTelAttribute {
	if (typeof value === 'string') {
		return { key, value: { stringValue: value } }
	}
	if (typeof value === 'number') {
		return Number.isInteger(value)
			? { key, value: { intValue: value } }
			: { key, value: { doubleValue: value } }
	}
	if (typeof value === 'boolean') {
		return { key, value: { boolValue: value } }
	}
	return { key, value: { stringValue: JSON.stringify(value) } }
}

/**
 * Convert an ElsiumAI SpanData to OTel span format.
 */
export function toOTelSpan(span: SpanData): OTelSpan {
	const attributes: OTelAttribute[] = [toOTelAttribute('elsium.span.kind', span.kind)]

	for (const [key, value] of Object.entries(span.metadata)) {
		attributes.push(toOTelAttribute(`elsium.${key}`, value))
	}

	const events: OTelEvent[] = span.events.map((e) => ({
		name: e.name,
		timeUnixNano: toNanoString(e.timestamp),
		attributes: e.data ? Object.entries(e.data).map(([k, v]) => toOTelAttribute(k, v)) : [],
	}))

	let statusCode: OTelStatusCode = 0 // UNSET
	if (span.status === 'ok') statusCode = 1 // OK
	if (span.status === 'error') statusCode = 2 // ERROR

	return {
		traceId: normalizeId(span.traceId, 32),
		spanId: normalizeId(span.id, 16),
		parentSpanId: span.parentId ? normalizeId(span.parentId, 16) : undefined,
		name: span.name,
		kind: SPAN_KIND_MAP[span.kind] ?? 0,
		startTimeUnixNano: toNanoString(span.startTime),
		endTimeUnixNano: span.endTime ? toNanoString(span.endTime) : toNanoString(span.startTime),
		attributes,
		events,
		status: { code: statusCode },
	}
}

/**
 * Normalize an ElsiumAI ID to an OTel-compatible hex string.
 * Trace IDs must be 32 hex chars, span IDs must be 16 hex chars.
 */
function normalizeId(id: string, length: number): string {
	// Strip any prefix (e.g. "trc_", "spn_")
	const clean = id.replace(/^[a-z]+_/, '')
	// Convert to hex-like string of the right length
	const hex = Array.from(clean)
		.map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
		.join('')
	return hex.slice(0, length).padEnd(length, '0')
}

/**
 * Build a full OTel export request from a batch of spans.
 */
export function toOTelExportRequest(
	spans: SpanData[],
	options: {
		serviceName?: string
		serviceVersion?: string
	} = {},
): OTelExportRequest {
	const { serviceName = 'elsium-ai', serviceVersion = '0.1.0' } = options

	return {
		resourceSpans: [
			{
				resource: {
					attributes: [
						toOTelAttribute('service.name', serviceName),
						toOTelAttribute('service.version', serviceVersion),
						toOTelAttribute('telemetry.sdk.name', 'elsium-ai'),
						toOTelAttribute('telemetry.sdk.language', 'typescript'),
					],
				},
				scopeSpans: [
					{
						scope: {
							name: '@elsium-ai/observe',
							version: serviceVersion,
						},
						spans: spans.map(toOTelSpan),
					},
				],
			},
		],
	}
}

// ─── W3C Trace Context ──────────────────────────────────────────

export interface TraceContext {
	traceId: string
	spanId: string
	traceFlags: number
	traceState?: string
}

/**
 * Create a W3C traceparent header value from a span.
 * Format: version-traceId-spanId-traceFlags
 * Example: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
 */
export function toTraceparent(span: SpanData): string {
	const version = '00'
	const traceId = normalizeId(span.traceId, 32)
	const spanId = normalizeId(span.id, 16)
	const flags = '01' // sampled
	return `${version}-${traceId}-${spanId}-${flags}`
}

/**
 * Parse a W3C traceparent header into trace context.
 */
export function parseTraceparent(header: string): TraceContext | null {
	const parts = header.trim().split('-')
	if (parts.length < 4) return null

	const [version, traceId, spanId, flags] = parts
	if (version !== '00') return null
	if (traceId.length !== 32 || spanId.length !== 16) return null

	return {
		traceId,
		spanId,
		traceFlags: Number.parseInt(flags, 16),
	}
}

/**
 * Inject trace context into HTTP headers for propagation.
 */
export function injectTraceContext(
	span: SpanData,
	headers: Record<string, string> = {},
): Record<string, string> {
	return {
		...headers,
		traceparent: toTraceparent(span),
	}
}

/**
 * Extract trace context from incoming HTTP headers.
 */
export function extractTraceContext(
	headers: Record<string, string | undefined>,
): TraceContext | null {
	const traceparent = headers.traceparent ?? headers.Traceparent
	if (!traceparent) return null
	return parseTraceparent(traceparent)
}

// ─── OTLP Exporter ──────────────────────────────────────────────

export interface OTLPExporterConfig {
	/** OTLP endpoint URL (e.g. http://localhost:4318/v1/traces) */
	endpoint: string
	/** Optional headers (e.g. for auth) */
	headers?: Record<string, string>
	/** Service name for resource attributes */
	serviceName?: string
	/** Service version */
	serviceVersion?: string
	/** Batch size before sending */
	batchSize?: number
	/** Flush interval in ms */
	flushIntervalMs?: number
}

/**
 * Create an OTLP JSON exporter that sends spans to any OTel-compatible backend.
 * Works with Jaeger, Grafana Tempo, Datadog, Honeycomb, etc.
 */
export function createOTLPExporter(config: OTLPExporterConfig): TracerExporter {
	const {
		endpoint,
		headers = {},
		serviceName,
		serviceVersion,
		batchSize = 100,
		flushIntervalMs = 5000,
	} = config

	const buffer: SpanData[] = []
	let flushTimer: ReturnType<typeof setInterval> | null = null

	async function sendBatch(spans: SpanData[]): Promise<void> {
		if (spans.length === 0) return

		const payload = toOTelExportRequest(spans, { serviceName, serviceVersion })

		try {
			const response = await fetch(endpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...headers,
				},
				body: JSON.stringify(payload),
			})

			if (!response.ok) {
				console.error(`[elsium-ai/otel] Export failed: ${response.status} ${response.statusText}`)
			}
		} catch (err) {
			console.error('[elsium-ai/otel] Export error:', err instanceof Error ? err.message : err)
		}
	}

	function startAutoFlush() {
		if (flushTimer) return
		flushTimer = setInterval(async () => {
			if (buffer.length > 0) {
				const batch = buffer.splice(0, buffer.length)
				await sendBatch(batch)
			}
		}, flushIntervalMs)
	}

	return {
		name: 'otlp',

		async export(spans: SpanData[]): Promise<void> {
			buffer.push(...spans)

			if (buffer.length >= batchSize) {
				const batch = buffer.splice(0, batchSize)
				await sendBatch(batch)
			} else {
				startAutoFlush()
			}
		},
	}
}
