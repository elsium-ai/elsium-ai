/**
 * OpenTelemetry compatibility layer.
 *
 * Converts ElsiumAI spans to OTel-compatible format and provides:
 * - W3C Trace Context propagation (traceparent/tracestate headers)
 * - OTel-compatible span export format
 * - OTLP JSON exporter for sending to any OTel-compatible backend
 *   (Jaeger, Grafana Tempo, Datadog, Honeycomb, etc.)
 */

import { createLogger } from '@elsium-ai/core'
import {
	type EmissionPolicy,
	type GenAIConventionRegistry,
	type SemconvStabilityFlag,
	createEmissionPolicy,
	getDefaultRegistry,
} from './gen-ai-conventions'
import type { SpanData, SpanKind } from './span'
import type { TracerExporter } from './tracer'

const log = createLogger()

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

function toOTelAttributeValue(value: unknown): OTelAttributeValue {
	if (typeof value === 'string') return { stringValue: value }
	if (typeof value === 'number') {
		return Number.isInteger(value) ? { intValue: value } : { doubleValue: value }
	}
	if (typeof value === 'boolean') return { boolValue: value }
	if (Array.isArray(value)) {
		return { arrayValue: { values: value.map((v) => toOTelAttributeValue(v)) } }
	}
	return { stringValue: JSON.stringify(value) }
}

function toOTelAttribute(key: string, value: unknown): OTelAttribute {
	return { key, value: toOTelAttributeValue(value) }
}

export interface ToOTelSpanOptions {
	emissionPolicy?: EmissionPolicy
	registry?: GenAIConventionRegistry
}

function buildLegacyAttributes(span: SpanData): OTelAttribute[] {
	const attributes: OTelAttribute[] = [toOTelAttribute('elsium.span.kind', span.kind)]
	for (const [key, value] of Object.entries(span.metadata)) {
		attributes.push(toOTelAttribute(`elsium.${key}`, value))
	}
	return attributes
}

function buildGenAIAttributes(
	span: SpanData,
	registry: GenAIConventionRegistry,
): OTelAttribute[] | null {
	const mapper = registry.getMapper(span.kind)
	if (!mapper) return null
	const genAI = mapper.map(span)
	if (!genAI) return null
	return Object.entries(genAI)
		.filter(([, v]) => v !== undefined)
		.map(([k, v]) => toOTelAttribute(k, v))
}

/**
 * Convert an ElsiumAI SpanData to OTel span format.
 *
 * Emission policy:
 * - Default: emits legacy `elsium.*` attributes.
 * - With `OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental` or an
 *   explicit `EmissionPolicy` opting into GenAI: emits `gen_ai.*` attributes
 *   for span kinds covered by a registered mapper (llm, tool, agent by
 *   default). Spans without a GenAI mapping (workflow, custom) gracefully
 *   fall back to legacy `elsium.*` so no data is lost.
 */
export function toOTelSpan(span: SpanData, options: ToOTelSpanOptions = {}): OTelSpan {
	const policy = options.emissionPolicy ?? createEmissionPolicy()
	const registry = options.registry ?? getDefaultRegistry()

	let attributes: OTelAttribute[]
	if (policy.shouldEmitGenAI()) {
		const genAIAttrs = buildGenAIAttributes(span, registry)
		attributes = genAIAttrs ?? buildLegacyAttributes(span)
	} else {
		attributes = buildLegacyAttributes(span)
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
		emissionPolicy?: EmissionPolicy
		registry?: GenAIConventionRegistry
	} = {},
): OTelExportRequest {
	const { serviceName = 'elsium-ai', serviceVersion = '0.1.0' } = options
	const spanOptions: ToOTelSpanOptions = {
		emissionPolicy: options.emissionPolicy,
		registry: options.registry,
	}

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
						spans: spans.map((s) => toOTelSpan(s, spanOptions)),
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
	/**
	 * Semconv stability config. By default reads OTEL_SEMCONV_STABILITY_OPT_IN
	 * from the environment. Pass `optIn: ['gen_ai_latest_experimental']` to
	 * force GenAI emission regardless of env.
	 */
	semconv?: { optIn?: readonly SemconvStabilityFlag[] }
	/**
	 * Override the GenAI convention registry. Use to ship custom mappers or
	 * pin a different spec version. Defaults to `getDefaultRegistry()`.
	 */
	conventionRegistry?: GenAIConventionRegistry
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
		semconv,
		conventionRegistry,
	} = config

	const emissionPolicy = createEmissionPolicy({ optIn: semconv?.optIn })

	const buffer: SpanData[] = []
	let flushTimer: ReturnType<typeof setInterval> | null = null

	async function sendBatch(spans: SpanData[]): Promise<void> {
		if (spans.length === 0) return

		const payload = toOTelExportRequest(spans, {
			serviceName,
			serviceVersion,
			emissionPolicy,
			registry: conventionRegistry,
		})

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
				log.error(`OTLP export failed: ${response.status} ${response.statusText}`)
			}
		} catch (err) {
			log.error('OTLP export error', { error: err instanceof Error ? err.message : String(err) })
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

		async shutdown(): Promise<void> {
			if (flushTimer) {
				clearInterval(flushTimer)
				flushTimer = null
			}
			if (buffer.length > 0) {
				const batch = buffer.splice(0, buffer.length)
				await sendBatch(batch)
			}
		},
	}
}
