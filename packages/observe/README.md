# @elsium-ai/observe

Observability, tracing, cost intelligence, metrics, audit trails, provenance tracking, and OpenTelemetry compatibility for [ElsiumAI](https://github.com/elsium-ai/elsium-ai).

[![npm](https://img.shields.io/npm/v/@elsium-ai/observe.svg)](https://www.npmjs.com/package/@elsium-ai/observe)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE)

## Install

```bash
npm install @elsium-ai/observe @elsium-ai/core
```

## What's Inside

| Category | Exports | Description |
|---|---|---|
| **Spans** | `createSpan`, `Span`, `SpanData`, `SpanEvent`, `SpanKind`, `SpanStatus`, `SpanHandler` | Low-level span creation with nested context propagation |
| **Cost Engine** | `createCostEngine`, `registerModelTier`, `CostEngine`, `CostEngineConfig`, `BudgetConfig`, `LoopDetectionConfig`, `CostAlert`, `CostDimension`, `CostIntelligenceReport`, `ModelSuggestion`, `ModelTierEntry` | Budget enforcement, cost projections, loop detection, and model optimization suggestions |
| **Tracer** | `observe`, `Tracer`, `TracerConfig`, `TracerOutput`, `TracerExporter`, `CostReport` | High-level tracing with sampling, console output, and custom exporters |
| **Metrics** | `createMetrics`, `MetricsCollector`, `MetricEntry` | Counters, gauges, and histograms for application-level metrics |
| **Audit Trail** | `createAuditTrail`, `auditMiddleware`, `AuditEventType`, `AuditEvent`, `AuditStorageAdapter`, `AuditQueryFilter`, `AuditIntegrityResult`, `AuditTrailConfig`, `AuditTrail` | SHA-256 hash-chained audit events with tamper detection and middleware |
| **Provenance** | `createProvenanceTracker`, `ProvenanceRecord`, `ProvenanceTracker` | Full lineage tracking per output: prompt, model, config, input, output |
| **OpenTelemetry** | `toOTelSpan`, `toOTelExportRequest`, `toTraceparent`, `parseTraceparent`, `injectTraceContext`, `extractTraceContext`, `createOTLPExporter`, `OTelSpan`, `OTelSpanKind`, `OTelStatusCode`, `OTelAttribute`, `OTelAttributeValue`, `OTelEvent`, `OTelResource`, `OTelExportRequest`, `TraceContext`, `OTLPExporterConfig` | W3C Trace Context propagation, OTel span conversion, and OTLP JSON export |

---

## Spans

Low-level building blocks for distributed tracing. Each span records a named operation with timing, metadata, events, and parent-child relationships.

### `SpanKind`

```ts
type SpanKind = 'llm' | 'tool' | 'agent' | 'workflow' | 'custom'
```

### `SpanStatus`

```ts
type SpanStatus = 'running' | 'ok' | 'error'
```

### `SpanEvent`

```ts
interface SpanEvent {
  name: string
  timestamp: number
  data?: Record<string, unknown>
}
```

### `SpanData`

The serializable representation of a span, returned by `span.toJSON()`.

```ts
interface SpanData {
  id: string
  traceId: string
  parentId?: string
  name: string
  kind: SpanKind
  status: SpanStatus
  startTime: number
  endTime?: number
  durationMs?: number
  metadata: Record<string, unknown>
  events: SpanEvent[]
}
```

### `Span`

The live span interface used during operation execution.

```ts
interface Span {
  readonly id: string
  readonly traceId: string
  readonly name: string
  readonly kind: SpanKind

  addEvent(name: string, data?: Record<string, unknown>): void
  setMetadata(key: string, value: unknown): void
  end(result?: { status?: SpanStatus; metadata?: Record<string, unknown> }): void
  child(name: string, kind?: SpanKind): Span
  toJSON(): SpanData
}
```

### `SpanHandler`

Callback invoked when a span ends.

```ts
type SpanHandler = (span: SpanData) => void
```

### `createSpan()`

Creates a new span for tracing an operation.

```ts
function createSpan(
  name: string,
  options?: {
    traceId?: string
    parentId?: string
    kind?: SpanKind
    onEnd?: SpanHandler
  },
): Span
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `name` | `string` | -- | Human-readable name for the operation |
| `options.traceId` | `string` | auto-generated | Trace ID to group related spans |
| `options.parentId` | `string` | `undefined` | Parent span ID for nesting |
| `options.kind` | `SpanKind` | `'custom'` | Category of work being performed |
| `options.onEnd` | `SpanHandler` | `undefined` | Callback fired when `span.end()` is called |

**Returns:** `Span`

```ts
import { createSpan } from '@elsium-ai/observe'

const span = createSpan('generate-summary', { kind: 'llm' })
span.setMetadata('model', 'gpt-4o')
span.addEvent('prompt-sent', { tokens: 120 })

// Create a child span for a sub-operation
const child = span.child('embed-context', 'tool')
child.end()

span.end({ status: 'ok', metadata: { outputTokens: 350 } })

console.log(span.toJSON())
```

---

## Cost Engine

Budget enforcement and cost intelligence for LLM usage. Tracks spend across models, agents, users, and features. Detects runaway loops and suggests cheaper model alternatives.

### `BudgetConfig`

```ts
interface BudgetConfig {
  totalBudget?: number
  dailyBudget?: number
  perUser?: number
  perFeature?: number
  perAgent?: number
}
```

### `LoopDetectionConfig`

```ts
interface LoopDetectionConfig {
  maxCallsPerMinute?: number
  maxCostPerMinute?: number
}
```

### `CostAlert`

```ts
interface CostAlert {
  type: 'threshold' | 'loop_detected' | 'budget_exceeded' | 'projection_warning'
  dimension: string
  currentValue: number
  limit: number
  message: string
  timestamp: number
}
```

### `CostDimension`

Aggregated cost data for a single dimension (model, agent, user, or feature).

```ts
interface CostDimension {
  totalCost: number
  totalTokens: number
  callCount: number
  firstCallAt: number
  lastCallAt: number
}
```

### `CostIntelligenceReport`

Full cost intelligence report with projections and recommendations.

```ts
interface CostIntelligenceReport {
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
```

### `ModelSuggestion`

A recommendation to switch to a cheaper model.

```ts
interface ModelSuggestion {
  currentModel: string
  suggestedModel: string
  estimatedSavings: number
  reason: string
}
```

### `ModelTierEntry`

Defines the pricing tier for a model.

```ts
interface ModelTierEntry {
  tier: 'low' | 'mid' | 'high'
  costPerMToken: number
}
```

### `CostEngineConfig`

```ts
interface CostEngineConfig {
  totalBudget?: number
  dailyBudget?: number
  perUser?: number
  perFeature?: number
  perAgent?: number
  loopDetection?: LoopDetectionConfig
  onAlert?: (alert: CostAlert) => void
  alertThresholds?: number[]
}
```

### `CostEngine`

```ts
interface CostEngine {
  middleware(): Middleware
  getReport(): CostIntelligenceReport
  suggestModel(currentModel: string, inputTokens: number): ModelSuggestion | null
  trackCall(
    response: LLMResponse,
    dimensions?: { agent?: string; user?: string; feature?: string },
  ): void
  reset(): void
}
```

### `createCostEngine()`

Creates a cost engine with budget enforcement, alerting, and cost intelligence.

```ts
function createCostEngine(config?: CostEngineConfig): CostEngine
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `config.totalBudget` | `number` | `undefined` | Maximum total spend before calls are rejected |
| `config.dailyBudget` | `number` | `undefined` | Maximum daily spend rate before alerts fire |
| `config.perUser` | `number` | `undefined` | Per-user budget limit |
| `config.perFeature` | `number` | `undefined` | Per-feature budget limit |
| `config.perAgent` | `number` | `undefined` | Per-agent budget limit |
| `config.loopDetection` | `LoopDetectionConfig` | `undefined` | Thresholds for detecting runaway loops |
| `config.onAlert` | `(alert: CostAlert) => void` | `undefined` | Callback for every alert |
| `config.alertThresholds` | `number[]` | `undefined` | Budget percentage thresholds that trigger alerts (e.g. `[0.5, 0.8, 0.95]`) |

**Returns:** `CostEngine`

```ts
import { createCostEngine } from '@elsium-ai/observe'

const engine = createCostEngine({
  totalBudget: 50.0,
  dailyBudget: 5.0,
  perAgent: 10.0,
  loopDetection: { maxCallsPerMinute: 60, maxCostPerMinute: 1.0 },
  alertThresholds: [0.5, 0.8, 0.95],
  onAlert: (alert) => console.warn(alert.message),
})

// Use as middleware in an ElsiumAI gateway
// gateway.use(engine.middleware())

// Or track calls manually
// engine.trackCall(response, { agent: 'summarizer', user: 'user-123' })

// Get a full intelligence report
const report = engine.getReport()
console.log('Projected monthly spend:', report.projectedMonthlySpend)
console.log('Recommendations:', report.recommendations)

// Get model optimization suggestions
const suggestion = engine.suggestModel('claude-opus-4-6', 200)
if (suggestion) {
  console.log(`Switch to ${suggestion.suggestedModel} for ${suggestion.estimatedSavings.toFixed(0)}% savings`)
}
```

### `registerModelTier()`

Registers a custom model with its pricing tier so the cost engine can track it.

```ts
function registerModelTier(model: string, entry: ModelTierEntry): void
```

| Parameter | Type | Description |
|---|---|---|
| `model` | `string` | The model identifier |
| `entry` | `ModelTierEntry` | The tier classification and cost per million tokens |

```ts
import { registerModelTier } from '@elsium-ai/observe'

registerModelTier('my-custom-model', { tier: 'mid', costPerMToken: 1.5 })
```

The cost engine ships with built-in tiers for common models including GPT-4o, GPT-4.1, GPT-5, Claude Sonnet 4.6, Claude Opus 4.6, Claude Haiku 4.5, Gemini 2.0 Flash, Gemini 2.5 Pro, o1, o3, o4-mini, and more.

---

## Tracer

High-level tracing API that wraps spans with sampling, console output, cost tracking, and pluggable exporters.

### `TracerOutput`

```ts
type TracerOutput = 'console' | 'json-file' | TracerExporter
```

### `TracerExporter`

Interface for custom span exporters.

```ts
interface TracerExporter {
  name: string
  export(spans: SpanData[]): void | Promise<void>
}
```

### `TracerConfig`

```ts
interface TracerConfig {
  output?: TracerOutput[]
  costTracking?: boolean
  samplingRate?: number
  maxSpans?: number
}
```

### `CostReport`

```ts
interface CostReport {
  totalCost: number
  totalTokens: number
  totalInputTokens: number
  totalOutputTokens: number
  callCount: number
  byModel: Record<
    string,
    {
      cost: number
      tokens: number
      calls: number
    }
  >
}
```

### `Tracer`

```ts
interface Tracer {
  startSpan(name: string, kind?: SpanKind): Span
  getSpans(): SpanData[]
  getCostReport(): CostReport
  trackLLMCall(data: {
    model: string
    inputTokens: number
    outputTokens: number
    cost: number
    latencyMs: number
  }): void
  reset(): void
  flush(): Promise<void>
}
```

### `observe()`

Creates a tracer instance for recording spans and LLM call costs.

```ts
function observe(config?: TracerConfig): Tracer
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `config.output` | `TracerOutput[]` | `['console']` | Where to send completed spans |
| `config.costTracking` | `boolean` | `true` | Whether `trackLLMCall` records data |
| `config.samplingRate` | `number` | `1.0` | Fraction of spans to sample (0.0 to 1.0) |
| `config.maxSpans` | `number` | `10000` | Maximum spans held in memory before oldest are evicted |

**Returns:** `Tracer`

```ts
import { observe } from '@elsium-ai/observe'

const tracer = observe({
  output: ['console'],
  samplingRate: 1.0,
  costTracking: true,
})

// Start a span
const span = tracer.startSpan('chat-completion', 'llm')
span.setMetadata('model', 'gpt-4o')
span.end()

// Track an LLM call for cost reporting
tracer.trackLLMCall({
  model: 'gpt-4o',
  inputTokens: 500,
  outputTokens: 200,
  cost: 0.0035,
  latencyMs: 1200,
})

// Get cost report
const report = tracer.getCostReport()
console.log('Total cost:', report.totalCost)

// Flush spans to all exporters
await tracer.flush()
```

You can provide a custom exporter:

```ts
import { observe } from '@elsium-ai/observe'
import type { TracerExporter } from '@elsium-ai/observe'

const myExporter: TracerExporter = {
  name: 'my-backend',
  async export(spans) {
    await fetch('https://my-telemetry.example.com/spans', {
      method: 'POST',
      body: JSON.stringify(spans),
    })
  },
}

const tracer = observe({ output: [myExporter] })
```

---

## Metrics

General-purpose metrics collection with counters, gauges, and histograms.

### `MetricEntry`

```ts
interface MetricEntry {
  name: string
  type: 'counter' | 'gauge' | 'histogram'
  value: number
  tags: Record<string, string>
  timestamp: number
}
```

### `MetricsCollector`

```ts
interface MetricsCollector {
  increment(name: string, value?: number, tags?: Record<string, string>): void
  gauge(name: string, value: number, tags?: Record<string, string>): void
  histogram(name: string, value: number, tags?: Record<string, string>): void
  getMetrics(): MetricEntry[]
  reset(): void
}
```

### `createMetrics()`

Creates a metrics collector for counters, gauges, and histograms.

```ts
function createMetrics(options?: { maxEntries?: number }): MetricsCollector
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `options.maxEntries` | `number` | `50000` | Maximum metric entries held in memory |

**Returns:** `MetricsCollector`

```ts
import { createMetrics } from '@elsium-ai/observe'

const metrics = createMetrics()

// Increment a counter (default increment is 1)
metrics.increment('llm.calls', 1, { model: 'gpt-4o' })

// Set a gauge to a current value
metrics.gauge('queue.depth', 42, { queue: 'embeddings' })

// Record a histogram observation
metrics.histogram('llm.latency_ms', 1200, { model: 'gpt-4o' })

// Retrieve all recorded entries
const entries = metrics.getMetrics()
console.log(`Recorded ${entries.length} metric entries`)

// Reset all state
metrics.reset()
```

---

## Audit Trail

Tamper-evident audit logging with SHA-256 hash-chaining. Every event is linked to the previous one via its hash, enabling integrity verification of the full event history.

### `AuditEventType`

```ts
type AuditEventType =
  | 'llm_call'
  | 'tool_execution'
  | 'security_violation'
  | 'budget_alert'
  | 'policy_violation'
  | 'auth_event'
  | 'approval_request'
  | 'approval_decision'
  | 'config_change'
  | 'provider_failover'
  | 'circuit_breaker_state_change'
```

### `AuditEvent`

```ts
interface AuditEvent {
  id: string
  sequenceId: number
  type: AuditEventType
  timestamp: number
  actor?: string
  traceId?: string
  data: Record<string, unknown>
  hash: string
  previousHash: string
}
```

### `AuditStorageAdapter`

Interface for custom audit storage backends (database, file system, etc.).

```ts
interface AuditStorageAdapter {
  append(event: AuditEvent): void | Promise<void>
  query(filter: AuditQueryFilter): AuditEvent[] | Promise<AuditEvent[]>
  count(): number | Promise<number>
  verifyIntegrity(): AuditIntegrityResult | Promise<AuditIntegrityResult>
  getLastHash?(): string | Promise<string>
}
```

### `AuditQueryFilter`

```ts
interface AuditQueryFilter {
  type?: AuditEventType | AuditEventType[]
  actor?: string
  traceId?: string
  fromTimestamp?: number
  toTimestamp?: number
  limit?: number
  offset?: number
}
```

### `AuditIntegrityResult`

```ts
interface AuditIntegrityResult {
  valid: boolean
  totalEvents: number
  brokenAt?: number
  chainComplete?: boolean
}
```

### `AuditBatchConfig`

```ts
interface AuditBatchConfig {
  size?: number
  intervalMs?: number
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `size` | `number` | `100` | Flush the buffer when it reaches this many events. |
| `intervalMs` | `number` | `50` | Flush the buffer on this interval (ms), regardless of size. |

### `AuditTrailConfig`

```ts
interface AuditTrailConfig {
  storage?: AuditStorageAdapter | 'memory'
  hashChain?: boolean
  maxEvents?: number
  batch?: AuditBatchConfig
  onError?: (error: unknown) => void
}
```

### `AuditTrail`

```ts
interface AuditTrail {
  log(
    type: AuditEventType,
    data: Record<string, unknown>,
    options?: { actor?: string; traceId?: string },
  ): void
  ready(): Promise<void>
  query(filter: AuditQueryFilter): Promise<AuditEvent[]>
  verifyIntegrity(): Promise<AuditIntegrityResult>
  flush(): Promise<void>
  dispose(): void
  readonly count: number
  readonly pending: number
}
```

| Member | Description |
|---|---|
| `log()` | Append an event. In batched mode, this buffers the event without hashing — zero CPU on the hot path. |
| `ready()` | Resolves once async initialization (e.g. `getLastHash`) has completed. |
| `query()` | Query events by type, actor, traceId, or timestamp range. Auto-flushes pending events in batched mode. |
| `verifyIntegrity()` | Verify the hash chain has not been tampered with. Auto-flushes pending events in batched mode. |
| `flush()` | Drain all pending events — computes hashes and writes to storage. No-op when not in batched mode. |
| `dispose()` | Stop the flush timer and drain remaining events. Call this on shutdown. |
| `count` | Total events (stored + pending). |
| `pending` | Number of buffered events not yet flushed (0 when not in batched mode). |

### `createAuditTrail()`

Creates a hash-chained audit trail for tamper-evident event logging.

```ts
function createAuditTrail(config?: AuditTrailConfig): AuditTrail
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `config.storage` | `AuditStorageAdapter \| 'memory'` | `'memory'` | Storage backend for audit events |
| `config.hashChain` | `boolean` | `true` | Enable SHA-256 hash chaining for tamper detection |
| `config.maxEvents` | `number` | `10000` | Maximum events retained (ring buffer — O(1) eviction) |
| `config.batch` | `AuditBatchConfig` | `undefined` | Enable batched mode for high-volume scenarios |
| `config.onError` | `(error: unknown) => void` | `undefined` | Error handler for async storage failures |

**Returns:** `AuditTrail`

```ts
import { createAuditTrail } from '@elsium-ai/observe'

const audit = createAuditTrail({ hashChain: true })

// Log events
audit.log('llm_call', {
  model: 'gpt-4o',
  inputTokens: 500,
  outputTokens: 200,
  cost: 0.0035,
}, { actor: 'user-123', traceId: 'trc_abc' })

audit.log('tool_execution', {
  tool: 'web-search',
  query: 'latest news',
  resultCount: 10,
})

// Query events
const llmEvents = await audit.query({ type: 'llm_call', limit: 50 })
console.log(`Found ${llmEvents.length} LLM call events`)

// Verify the hash chain has not been tampered with
const integrity = await audit.verifyIntegrity()
console.log('Audit chain valid:', integrity.valid)
console.log('Total events:', integrity.totalEvents)
```

#### Batched mode (high-volume)

In high-volume scenarios, `log()` computes a SHA-256 hash on every call — blocking the hot path. Batched mode moves hashing off the critical path: `log()` buffers raw event data, and hashing + storage writes happen asynchronously on flush.

```ts
import { createAuditTrail } from '@elsium-ai/observe'

const audit = createAuditTrail({
  batch: {
    size: 500,         // Flush after 500 events
    intervalMs: 100,   // Or every 100ms, whichever comes first
  },
  maxEvents: 100_000,
})

// log() is now near-zero cost — just pushes to an internal buffer
audit.log('llm_call', { model: 'gpt-4o', tokens: 100 })

// Force-flush before reading (query/verifyIntegrity auto-flush)
await audit.flush()

// Clean up on shutdown
process.on('SIGTERM', () => audit.dispose())
```

Hash chain integrity is fully preserved — events are hashed sequentially during flush, not during `log()`.

### `auditMiddleware()`

Creates an ElsiumAI middleware that automatically logs every LLM call (success or failure) to the given audit trail.

```ts
function auditMiddleware(auditTrail: AuditTrail): Middleware
```

| Parameter | Type | Description |
|---|---|---|
| `auditTrail` | `AuditTrail` | The audit trail instance to log events to |

**Returns:** `Middleware` (from `@elsium-ai/core`)

```ts
import { createAuditTrail, auditMiddleware } from '@elsium-ai/observe'

const audit = createAuditTrail({ hashChain: true })
const middleware = auditMiddleware(audit)

// Use with an ElsiumAI gateway
// gateway.use(middleware)
```

The middleware automatically records `llm_call` events containing `provider`, `model`, `inputTokens`, `outputTokens`, `totalTokens`, `cost`, `latencyMs`, and `stopReason`. On errors, it records the error message and `success: false`.

---

## Provenance

Tracks the full lineage of every AI-generated output by hashing the prompt, model, config, input, and output. Enables reproducibility audits and output-to-source tracing.

### `ProvenanceRecord`

```ts
interface ProvenanceRecord {
  id: string
  outputHash: string
  promptVersion: string
  modelVersion: string
  configHash: string
  inputHash: string
  timestamp: number
  traceId?: string
  metadata?: Record<string, unknown>
}
```

All hash fields (`outputHash`, `promptVersion`, `modelVersion`, `configHash`, `inputHash`) are SHA-256 hex digests of their respective inputs.

### `ProvenanceTracker`

```ts
interface ProvenanceTracker {
  record(data: {
    prompt: string
    model: string
    config: Record<string, unknown>
    input: string
    output: string
    traceId?: string
    metadata?: Record<string, unknown>
  }): ProvenanceRecord
  query(filter: {
    outputHash?: string
    promptVersion?: string
    modelVersion?: string
    traceId?: string
  }): ProvenanceRecord[]
  getLineage(outputHash: string): ProvenanceRecord[]
  readonly count: number
  clear(): void
}
```

### `createProvenanceTracker()`

Creates a provenance tracker for recording and querying output lineage.

```ts
function createProvenanceTracker(options?: {
  maxRecords?: number
}): ProvenanceTracker
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `options.maxRecords` | `number` | `10000` | Maximum records held in memory |

**Returns:** `ProvenanceTracker`

```ts
import { createProvenanceTracker } from '@elsium-ai/observe'

const provenance = createProvenanceTracker()

// Record a generation
const record = provenance.record({
  prompt: 'Summarize the following article...',
  model: 'gpt-4o',
  config: { temperature: 0.7, maxTokens: 500 },
  input: 'The article text here...',
  output: 'A concise summary of the article.',
  traceId: 'trc_abc',
})

console.log('Output hash:', record.outputHash)

// Query records by output hash
const matches = provenance.query({ outputHash: record.outputHash })

// Get the full lineage for a given output (all records sharing the same traceId)
const lineage = provenance.getLineage(record.outputHash)
console.log(`Lineage has ${lineage.length} steps`)

// Check count and clear
console.log('Total records:', provenance.count)
provenance.clear()
```

---

## OpenTelemetry

Compatibility layer for converting ElsiumAI spans to the OpenTelemetry format, propagating W3C Trace Context headers, and exporting via OTLP JSON to any OTel-compatible backend (Jaeger, Grafana Tempo, Datadog, Honeycomb, etc.).

### `OTelSpanKind`

```ts
type OTelSpanKind = 0 | 1 | 2 | 3 | 4 | 5
// 0 = UNSPECIFIED, 1 = INTERNAL, 2 = SERVER, 3 = CLIENT, 4 = PRODUCER, 5 = CONSUMER
```

### `OTelStatusCode`

```ts
type OTelStatusCode = 0 | 1 | 2
// 0 = UNSET, 1 = OK, 2 = ERROR
```

### `OTelAttributeValue`

```ts
interface OTelAttributeValue {
  stringValue?: string
  intValue?: number
  doubleValue?: number
  boolValue?: boolean
  arrayValue?: { values: OTelAttributeValue[] }
}
```

### `OTelAttribute`

```ts
interface OTelAttribute {
  key: string
  value: OTelAttributeValue
}
```

### `OTelEvent`

```ts
interface OTelEvent {
  name: string
  timeUnixNano: string
  attributes: OTelAttribute[]
}
```

### `OTelSpan`

The OpenTelemetry-compatible span representation.

```ts
interface OTelSpan {
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
```

### `OTelResource`

```ts
interface OTelResource {
  attributes: OTelAttribute[]
}
```

### `OTelExportRequest`

The full OTLP JSON export payload structure.

```ts
interface OTelExportRequest {
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
```

### `TraceContext`

Parsed W3C Trace Context.

```ts
interface TraceContext {
  traceId: string
  spanId: string
  traceFlags: number
  traceState?: string
}
```

### `OTLPExporterConfig`

```ts
interface OTLPExporterConfig {
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
```

### `toOTelSpan()`

Converts an ElsiumAI `SpanData` to an OpenTelemetry-compatible span.

```ts
function toOTelSpan(span: SpanData): OTelSpan
```

| Parameter | Type | Description |
|---|---|---|
| `span` | `SpanData` | The ElsiumAI span to convert |

**Returns:** `OTelSpan`

```ts
import { createSpan, toOTelSpan } from '@elsium-ai/observe'

const span = createSpan('my-operation', { kind: 'llm' })
span.end()

const otelSpan = toOTelSpan(span.toJSON())
console.log(otelSpan.traceId, otelSpan.spanId)
```

ElsiumAI span kinds are mapped as follows: `llm` to CLIENT (3), `tool`/`agent`/`workflow` to INTERNAL (1), `custom` to UNSPECIFIED (0).

### `toOTelExportRequest()`

Builds a full OTLP JSON export request from a batch of spans.

```ts
function toOTelExportRequest(
  spans: SpanData[],
  options?: {
    serviceName?: string
    serviceVersion?: string
  },
): OTelExportRequest
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `spans` | `SpanData[]` | -- | Batch of spans to export |
| `options.serviceName` | `string` | `'elsium-ai'` | Service name in resource attributes |
| `options.serviceVersion` | `string` | `'0.1.0'` | Service version in resource attributes |

**Returns:** `OTelExportRequest`

```ts
import { observe, toOTelExportRequest } from '@elsium-ai/observe'

const tracer = observe({ output: [] })
const span = tracer.startSpan('process-request', 'agent')
span.end()

const payload = toOTelExportRequest(tracer.getSpans(), {
  serviceName: 'my-ai-service',
  serviceVersion: '1.0.0',
})

// Send to any OTLP-compatible endpoint
await fetch('http://localhost:4318/v1/traces', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
})
```

### `toTraceparent()`

Creates a W3C `traceparent` header value from a span.

```ts
function toTraceparent(span: SpanData): string
```

| Parameter | Type | Description |
|---|---|---|
| `span` | `SpanData` | The span to derive the traceparent from |

**Returns:** `string` -- Format: `00-{traceId}-{spanId}-01`

```ts
import { createSpan, toTraceparent } from '@elsium-ai/observe'

const span = createSpan('outgoing-call', { kind: 'llm' })
span.end()

const header = toTraceparent(span.toJSON())
// e.g. "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
```

### `parseTraceparent()`

Parses a W3C `traceparent` header string into a `TraceContext`.

```ts
function parseTraceparent(header: string): TraceContext | null
```

| Parameter | Type | Description |
|---|---|---|
| `header` | `string` | The traceparent header value |

**Returns:** `TraceContext | null` -- Returns `null` if the header is malformed or uses an unsupported version.

```ts
import { parseTraceparent } from '@elsium-ai/observe'

const ctx = parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')
if (ctx) {
  console.log('Trace ID:', ctx.traceId)
  console.log('Span ID:', ctx.spanId)
  console.log('Sampled:', ctx.traceFlags === 1)
}
```

### `injectTraceContext()`

Injects the `traceparent` header into an outgoing HTTP headers object for distributed trace propagation.

```ts
function injectTraceContext(
  span: SpanData,
  headers?: Record<string, string>,
): Record<string, string>
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `span` | `SpanData` | -- | The span whose trace context to inject |
| `headers` | `Record<string, string>` | `{}` | Existing headers to merge with |

**Returns:** `Record<string, string>` -- A new headers object with `traceparent` set.

```ts
import { createSpan, injectTraceContext } from '@elsium-ai/observe'

const span = createSpan('api-call', { kind: 'llm' })
const headers = injectTraceContext(span.toJSON(), {
  'Content-Type': 'application/json',
  Authorization: 'Bearer token',
})
// headers now includes { traceparent: '00-...-...-01', ... }

await fetch('https://api.example.com/generate', { headers })
span.end()
```

### `extractTraceContext()`

Extracts a `TraceContext` from incoming HTTP headers. Checks both `traceparent` and `Traceparent` keys.

```ts
function extractTraceContext(
  headers: Record<string, string | undefined>,
): TraceContext | null
```

| Parameter | Type | Description |
|---|---|---|
| `headers` | `Record<string, string \| undefined>` | Incoming HTTP headers |

**Returns:** `TraceContext | null`

```ts
import { extractTraceContext, createSpan } from '@elsium-ai/observe'

// In an HTTP handler
function handleRequest(req: { headers: Record<string, string> }) {
  const parentCtx = extractTraceContext(req.headers)

  const span = createSpan('handle-request', {
    traceId: parentCtx?.traceId,
    parentId: parentCtx?.spanId,
    kind: 'agent',
  })

  // ... process request ...
  span.end()
}
```

### `createOTLPExporter()`

Creates an OTLP JSON exporter that sends spans to any OTel-compatible backend. Supports batching and automatic periodic flushing.

```ts
function createOTLPExporter(config: OTLPExporterConfig): TracerExporter
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `config.endpoint` | `string` | -- | OTLP endpoint URL (e.g. `http://localhost:4318/v1/traces`) |
| `config.headers` | `Record<string, string>` | `{}` | Optional HTTP headers (e.g. for authentication) |
| `config.serviceName` | `string` | `undefined` | Service name for resource attributes |
| `config.serviceVersion` | `string` | `undefined` | Service version for resource attributes |
| `config.batchSize` | `number` | `100` | Number of spans to buffer before sending a batch |
| `config.flushIntervalMs` | `number` | `5000` | Automatic flush interval in milliseconds |

**Returns:** `TracerExporter`

```ts
import { observe, createOTLPExporter } from '@elsium-ai/observe'

const exporter = createOTLPExporter({
  endpoint: 'http://localhost:4318/v1/traces',
  serviceName: 'my-ai-service',
  serviceVersion: '1.0.0',
  headers: { Authorization: 'Bearer my-token' },
  batchSize: 50,
  flushIntervalMs: 10000,
})

const tracer = observe({ output: [exporter] })

const span = tracer.startSpan('generate', 'llm')
span.end()

// Spans are batched and sent automatically, or flush manually:
await tracer.flush()
```

---

## Experiments Persistence

### `createFileExperimentStore`

Creates a file-based storage adapter for saving and loading experiment results to disk. Experiment data is serialized as JSON files in the specified directory.

```ts
function createFileExperimentStore(dir: string): ExperimentStore
```

| Parameter | Type | Description |
|---|---|---|
| `dir` | `string` | Directory path where experiment result files will be stored |

**Returns:** `ExperimentStore`

```ts
interface ExperimentStore {
  save(experiment: ExperimentResults): Promise<void>
  load(experimentId: string): Promise<ExperimentResults | null>
  list(): Promise<string[]>
}
```

```ts
import { createExperiment, createFileExperimentStore } from 'elsium-ai/observe'

const store = createFileExperimentStore('./experiments')

const experiment = createExperiment({
  name: 'prompt-comparison',
  variants: [
    { name: 'concise', config: { system: 'Be brief.' } },
    { name: 'detailed', config: { system: 'Be thorough.' } },
  ],
})

const results = await experiment.run(evaluator)

// Persist results to disk
await store.save(results)

// Load results later
const loaded = await store.load(results.id)
```

---

## Auto-Instrumentation

### `instrumentComplete`

Wraps an LLM completion function with automatic span creation. Every call produces a span with model, token, cost, and latency metadata.

```ts
function instrumentComplete(
  complete: (request: CompletionRequest) => Promise<LLMResponse>,
  tracer: Tracer,
): (request: CompletionRequest) => Promise<LLMResponse>
```

| Parameter | Type | Description |
|---|---|---|
| `complete` | `(request: CompletionRequest) => Promise<LLMResponse>` | The LLM completion function to instrument |
| `tracer` | `Tracer` | The tracer instance to record spans to |

**Returns:** A wrapped completion function with the same signature.

```ts
import { observe, instrumentComplete } from 'elsium-ai/observe'

const tracer = observe()

const tracedComplete = instrumentComplete(
  (req) => llm.complete(req),
  tracer,
)

// Every call now creates an 'llm' span automatically
const response = await tracedComplete({ model: 'gpt-4o', messages })
```

### `instrumentAgent`

Wraps an agent's `run` method with automatic span creation. Produces an `agent` span that captures the agent name, input, output, token usage, and tool calls.

```ts
function instrumentAgent(
  agent: Agent,
  tracer: Tracer,
): Agent
```

| Parameter | Type | Description |
|---|---|---|
| `agent` | `Agent` | The agent to instrument |
| `tracer` | `Tracer` | The tracer instance to record spans to |

**Returns:** A new `Agent` with the same interface, where `run` and `chat` are automatically traced.

```ts
import { observe, instrumentAgent } from 'elsium-ai/observe'
import { defineAgent } from 'elsium-ai/agents'

const tracer = observe()

const agent = defineAgent(
  { name: 'assistant', system: 'You are helpful.' },
  { complete: (req) => llm.complete(req) },
)

const tracedAgent = instrumentAgent(agent, tracer)

// Every run/chat call now creates an 'agent' span automatically
const result = await tracedAgent.run('Hello')
```

---

## Part of ElsiumAI

This package is the observability layer of the [ElsiumAI](https://github.com/elsium-ai/elsium-ai) framework. See the [full documentation](https://github.com/elsium-ai/elsium-ai) for guides and examples.

## License

[MIT](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE)
