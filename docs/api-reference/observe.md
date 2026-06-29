# elsium-ai/observe

Observability module providing tracing, cost tracking, metrics, audit logging, provenance tracking, experimentation, and OpenTelemetry integration.

```ts
import { createSpan, observe, createCostEngine, createMetrics } from '@elsium-ai/observe'
```

---

## Tracing

### createSpan

```ts
createSpan(name: string, options?: { traceId?: string; parentId?: string; kind?: SpanKind; onEnd?: SpanHandler }): Span
```

Creates a trace span for tracking execution of a unit of work.

**Options:**

| Field | Type | Description |
|---|---|---|
| `kind` | `SpanKind` | Span kind: `'llm'` \| `'tool'` \| `'agent'` \| `'workflow'` \| `'custom'` |
| `parentId` | `string` | Parent span id for nested traces |
| `traceId` | `string` | Trace id to attach this span to |
| `onEnd` | `SpanHandler` | Callback invoked with span data when the span ends |

```ts
import { createSpan } from '@elsium-ai/observe'

const span = createSpan('llm-request', { kind: 'llm' })
span.setMetadata('model', 'claude-sonnet-4-20250514')
span.setMetadata('provider', 'anthropic')

try {
  const result = await provider.complete(request)
  span.end({ status: 'ok', metadata: { tokens: result.usage.totalTokens } })
} catch (error) {
  span.end({ status: 'error', metadata: { error: String(error) } })
  throw error
}
```

### observe

```ts
observe(config?: TracerConfig): Tracer
```

Creates a tracer with sampling, exporters, and cost tracking.

```ts
import { observe } from '@elsium-ai/observe'

const tracer = observe({
  samplingRate: 0.1, // sample 10% of traces
  output: [consoleExporter, otlpExporter],
  costTracking: true,
})

const span = tracer.startSpan('process-request')
```

---

## Cost

### Cost attribution dimensions

The cost engine tracks spend across six pluggable dimensions:

| Dimension | Source | Read from |
|---|---|---|
| `byModel` | the LLM response | `response.model` (automatic) |
| `byAgent` | metadata | `ctx.metadata.agentName` |
| `byUser` | metadata | `ctx.metadata.userId` |
| `byFeature` | metadata | `ctx.metadata.feature` |
| `byTenant` | **first-class** on `MiddlewareContext` | `ctx.tenant.tenantId` |
| `byWorkflow` | **first-class** on `MiddlewareContext` | `ctx.workflow.id` |

Tenant and workflow are not read from `ctx.metadata` — they are typed fields on `MiddlewareContext` so propagation is structural and type-checked. Set them before `next(ctx)`:

```ts
const middleware: Middleware = async (ctx, next) => {
  ctx.tenant = { tenantId: 'acme', tier: 'enterprise' }
  ctx.workflow = { id: 'wf_invoice_2026Q1', name: 'invoice-processing' }
  return next(ctx)
}
```

Per-dimension budget caps follow the same naming on `CostEngineConfig`:

```ts
const engine = createCostEngine({
  perTenant: 100,    // throws BudgetExceeded if any tenant exceeds $100
  perWorkflow: 25,   // throws BudgetExceeded if any workflow exceeds $25
  perAgent: 10,
  perUser: 5,
})
```

### createCostEngine

```ts
createCostEngine(config: CostEngineConfig): CostEngine
```

Creates a cost engine for budget enforcement, loop detection, and model cost suggestions.

```ts
import { createCostEngine } from '@elsium-ai/observe'

const costEngine = createCostEngine({
  totalBudget: 10.0,
  alertThresholds: [0.8], // alert at 80% budget usage
})

costEngine.trackCall(response)
const report = costEngine.getReport()
const suggestion = costEngine.suggestModel(response.model, 500)
```

### createBudgetAwareRoutingPolicy

```ts
createBudgetAwareRoutingPolicy(config: BudgetAwareRoutingConfig): Middleware
```

Prescriptive budget enforcement. Wraps the cost engine, monitors spend ratio against `totalBudget`, and **acts** automatically:

- **Pass-through** below `downgradeThreshold` (default `0.7`).
- **Downgrade**: at `[downgradeThreshold, rejectThreshold)`, calls `costEngine.suggestModel(ctx.model, estimatedInputTokens)` and rewrites `ctx.model` + `ctx.request.model` to the cheaper alternative. If no cheaper model exists, passes through.
- **Reject** at or above `rejectThreshold` (default `0.95`) — throws `ElsiumError.budgetExceeded`.

```ts
import { createCostEngine, createBudgetAwareRoutingPolicy, gateway } from 'elsium-ai'

const engine = createCostEngine({ totalBudget: 100 })

const gw = gateway({
  provider: 'anthropic',
  apiKey: env('ANTHROPIC_API_KEY'),
  middleware: [
    createBudgetAwareRoutingPolicy({
      costEngine: engine,
      totalBudget: 100,
      downgradeThreshold: 0.7,
      rejectThreshold: 0.95,
      onAction: (a) => console.log('[budget]', a),
    }),
    engine.middleware(), // order matters: routing policy goes first
  ],
})
```

**Order matters.** Install the routing policy **before** the cost engine middleware so the policy reads current spend and reroutes the call before the new spend is committed.

### registerModelTier

```ts
registerModelTier(model: string, entry: ModelTierEntry): void
```

Registers a model's pricing tier for cost engine calculations.

```ts
import { registerModelTier } from '@elsium-ai/observe'

registerModelTier('custom-model-v1', {
  tier: 'high',
  costPerMToken: 12,
})
```

### createLocalCostStore

```ts
createLocalCostStore(options?: LocalCostStoreOptions): CostStore
```

In-memory reference adapter for the `CostStore` port — the async-first contract for cost attribution across processes and instances. This package ships **only** the in-memory adapter. For multi-instance deployments with shared budget, implement `CostStore` against your own backend (SQLite, Postgres, Redis, DynamoDB, …); no DB drivers are bundled.

`reserve` / `commit` / `release` let callers pre-reserve a budget before the LLM call commits, so concurrent requests racing against the same tenant cap don't double-spend.

**Options:**

| Field | Type | Description |
|---|---|---|
| `reservationTtlMs` | `number` | TTL for reservations never committed or released. Default `60000`. |
| `now` | `() => number` | Clock injection for deterministic tests. Defaults to `Date.now`. |

**`CostStore` methods:**

| Method | Signature | Description |
|---|---|---|
| `record` | `record(rec: CostRecord): Promise<void>` | Persist a committed cost record |
| `aggregate` | `aggregate(by: CostDimensionKey, filter?: Partial<CostAttribution>, window?: TimeWindow): Promise<readonly CostBucket[]>` | Aggregate spend grouped by a dimension, optionally filtered and time-windowed |
| `reserve` | `reserve(attribution: CostAttribution, estimatedCost: number): Promise<ReservationToken>` | Pre-reserve budget before a call commits |
| `commit` | `commit(token: ReservationToken, actualCost: number): Promise<void>` | Convert a reservation into a committed record at the actual cost |
| `release` | `release(token: ReservationToken): Promise<void>` | Discard a reservation without recording cost |

`CostDimensionKey` is one of `'model' | 'agent' | 'user' | 'feature' | 'tenant' | 'workflow' | 'workflowStep' | 'traceId'`.

```ts
import { createLocalCostStore } from '@elsium-ai/observe'

const store = createLocalCostStore({ reservationTtlMs: 30_000 })

// Reserve before the call, commit the real cost after.
const token = await store.reserve({ model: 'claude-sonnet-4-20250514', tenant: 'acme' }, 0.02)
const response = await gw.complete(request)
await store.commit(token, response.cost)

// Aggregate spend per tenant over the last hour.
const buckets = await store.aggregate('tenant', undefined, {
  fromMs: Date.now() - 3_600_000,
  toMs: Date.now(),
})
// buckets: [{ key: 'acme', cost, tokens, calls, firstAt, lastAt }, ...]
```

### detectDrift

```ts
detectDrift(config: DriftDetectionConfig): Promise<DriftReport>
```

Compares output distributions between two snapshots of the same canonical input set — typically "yesterday's model version" vs "today's". Reports exact-match rate, length-distribution shift, tool-call divergence, and (optionally, via a pluggable provider) semantic-similarity drift. Designed to run in production against sampled real traffic, not only in CI.

Semantic similarity is bring-your-own via the `SimilarityProvider` port (cosine over your embeddings, an LLM-as-judge, anything). No embedding library is bundled; if no provider is supplied, semantic metrics are omitted and the composite score is re-normalized.

**Config (`DriftDetectionConfig`):**

| Field | Type | Description |
|---|---|---|
| `baseline` | `readonly DriftSample[]` | Reference samples |
| `current` | `readonly DriftSample[]` | New samples to compare against the baseline |
| `similarity` | `SimilarityProvider?` | Optional `{ similarity(a, b): Promise<number> }` returning `[0, 1]` |
| `weights` | `DriftWeights?` | Weights for the composite `overallDrift` score (auto-normalized to sum to 1). Defaults: `exactMismatch 0.4`, `length 0.2`, `toolCalls 0.2`, `semantic 0.2` |

A `DriftSample` is `{ input: string; output: string; tokens?: number; toolCalls?: readonly string[] }`. Samples are paired by `input` (usually a hash of the prompt); unpaired inputs are reported in `mismatchedInputs`.

**Result (`DriftReport`):**

| Field | Type | Description |
|---|---|---|
| `comparedCount` | `number` | Number of paired inputs compared |
| `mismatchedInputs` | `readonly string[]` | Inputs present in only one snapshot |
| `exactMatchRate` | `number` | Fraction of pairs with identical output `[0, 1]` |
| `meanLengthDelta` | `number` | Mean signed output-length change |
| `meanAbsoluteLengthDelta` | `number` | Mean absolute output-length change |
| `toolCallDivergence` | `number` | Mean Jaccard distance of tool-call sets `[0, 1]` |
| `meanSimilarity` | `number?` | Mean semantic similarity (only if a provider was supplied) |
| `overallDrift` | `number` | Composite weighted drift score `[0, 1]`, higher = more drift |
| `perInput` | `readonly PerInputComparison[]` | Per-input breakdown |

```ts
import { detectDrift } from '@elsium-ai/observe'

const report = await detectDrift({
  baseline: [{ input: 'q1', output: 'Paris', toolCalls: ['search'] }],
  current: [{ input: 'q1', output: 'Paris, France', toolCalls: ['search'] }],
  // Optional: bring your own semantic similarity.
  similarity: { similarity: async (a, b) => cosine(await embed(a), await embed(b)) },
})

if (report.overallDrift > 0.3) {
  console.warn('Model drift detected', report.mismatchedInputs)
}
```

---

## Metrics

### createMetrics

```ts
createMetrics(): MetricsCollector
```

Creates a metrics collector for tracking counters, gauges, and histograms.

**Methods:**

| Method | Signature | Description |
|---|---|---|
| `increment` | `increment(name: string, value?: number, tags?: Record<string, string>): void` | Increment a counter |
| `gauge` | `gauge(name: string, value: number, tags?: Record<string, string>): void` | Set a gauge value |
| `histogram` | `histogram(name: string, value: number, tags?: Record<string, string>): void` | Record a histogram value |

```ts
import { createMetrics } from '@elsium-ai/observe'

const metrics = createMetrics()

metrics.increment('requests.total', 1, { provider: 'anthropic' })
metrics.gauge('active_connections', 42)
metrics.histogram('request.latency_ms', 156, { model: 'claude-sonnet-4-20250514' })
```

---

## Audit

### createAuditTrail

```ts
createAuditTrail(config: AuditTrailConfig): AuditTrail
```

Creates a SHA-256 hash-chained audit log for tamper-evident recording of LLM interactions.

```ts
import { createAuditTrail } from '@elsium-ai/observe'

const audit = createAuditTrail({
  storage: 'memory',
  hashChain: true,
})

audit.log(
  'llm_call',
  {
    model: 'claude-sonnet-4-20250514',
    input: request.messages,
    output: response.content,
    cost: response.cost,
  },
  { actor: ctx.userId, traceId: ctx.traceId },
)
```

### auditMiddleware

```ts
auditMiddleware(trail: AuditTrail): Middleware
```

Middleware that automatically records all requests and responses to the audit trail.

```ts
import { createAuditTrail, auditMiddleware } from '@elsium-ai/observe'

const audit = createAuditTrail({ storage: 'memory' })

const gw = gateway({
  middleware: [auditMiddleware(audit)],
})
```

### Audit Sinks

Sinks forward audit events to external destinations. A `SinkManager` batches events in memory and fans them out to one or more sinks with retry, backpressure, and optional dead-lettering. Every sink implements the `AuditSink` interface:

```ts
interface AuditSink {
  name: string
  filter?: (event: AuditEvent) => boolean
  send(events: AuditEvent[]): Promise<void>
  shutdown?(): Promise<void>
}
```

#### createSinkManager

```ts
createSinkManager(config: SinkManagerConfig): SinkManager
```

Buffers events, dispatches them in batches, and delivers each batch to every configured sink with exponential-backoff retry and jitter. Failed deliveries (after retries) are routed to an optional `deadLetterSink`. The internal flush timer is `unref`'d so it won't keep the process alive.

**Config (`SinkManagerConfig`):**

| Field | Type | Description |
|---|---|---|
| `sinks` | `AuditSink[]` | Destination sinks (events fan out to all) |
| `batch.size` | `number` | Flush when buffered events reach this count. Default `50` |
| `batch.intervalMs` | `number` | Periodic flush interval. Default `5000` |
| `retry.maxRetries` | `number` | Max retry attempts per sink. Default `3` |
| `retry.baseDelayMs` | `number` | Base backoff delay. Default `1000` |
| `retry.maxDelayMs` | `number` | Backoff cap. Default `30000` |
| `maxBufferSize` | `number` | Max buffered events; oldest dropped when full. Default `10000` |
| `deadLetterSink` | `AuditSink?` | Receives batches that fail all retries |
| `onError` | `(sinkName: string, error: unknown) => void` | Invoked on delivery failure |

**`SinkManager` methods:** `dispatch(event)` (enqueue, non-blocking), `flush(): Promise<void>` (drain buffer and await in-flight), `shutdown(): Promise<void>` (stop timer, flush, then call each sink's `shutdown`).

```ts
import {
  createSinkManager,
  createWebhookSink,
  createDatadogSink,
  createJsonlSink,
} from '@elsium-ai/observe'

const manager = createSinkManager({
  sinks: [createWebhookSink({ url: 'https://siem.example.com/ingest' }), createDatadogSink({ apiKey: env('DD_API_KEY') })],
  deadLetterSink: createJsonlSink({ path: './audit-dlq.jsonl' }),
  batch: { size: 100, intervalMs: 2000 },
  onError: (sink, err) => console.error('[audit-sink]', sink, err),
})

manager.dispatch(event)
await manager.shutdown() // on process exit
```

#### createWebhookSink

```ts
createWebhookSink(config: WebhookSinkConfig): AuditSink
```

POSTs (or PUTs) batches as `{ events }` JSON to an HTTP endpoint, with an abortable timeout.

| Field | Type | Description |
|---|---|---|
| `url` | `string` | Target endpoint (required) |
| `headers` | `Record<string, string>` | Extra request headers |
| `method` | `'POST' \| 'PUT'` | HTTP method. Default `'POST'` |
| `timeoutMs` | `number` | Request timeout. Default `10000` |

#### createSplunkSink

```ts
createSplunkSink(config: SplunkSinkConfig): AuditSink
```

Sends events to Splunk HTTP Event Collector (HEC), one newline-delimited JSON event per record.

| Field | Type | Description |
|---|---|---|
| `url` | `string` | HEC endpoint (required) |
| `token` | `string` | HEC token, sent as `Authorization: Splunk <token>` (required) |
| `index` | `string?` | Target Splunk index |
| `source` | `string?` | Event source. Default `'elsium-ai'` |
| `sourcetype` | `string?` | Event sourcetype. Default `'elsium:audit'` |
| `timeoutMs` | `number` | Request timeout. Default `10000` |

#### createDatadogSink

```ts
createDatadogSink(config: DatadogSinkConfig): AuditSink
```

Ships events to the Datadog Log Intake API. Security-violation events are tagged `status: 'error'`; others `info`. The endpoint is derived from `site`.

| Field | Type | Description |
|---|---|---|
| `apiKey` | `string` | Datadog API key, sent as `DD-API-KEY` (required) |
| `site` | `string?` | Datadog site. Default `'datadoghq.com'` |
| `service` | `string?` | Log service. Default `'elsium-ai'` |
| `source` | `string?` | Log source (`ddsource`). Default `'elsium-ai-audit'` |
| `tags` | `Record<string, string>?` | Tags applied to every log (`ddtags`) |
| `timeoutMs` | `number` | Request timeout. Default `10000` |

#### createJsonlSink

```ts
createJsonlSink(config: JsonlSinkConfig): AuditSink
```

Appends events as newline-delimited JSON to a local file, creating parent directories as needed. Writes are serialized through a write lock; `fsync` is called after each batch by default for durability. Implements `shutdown` to flush and close the handle.

| Field | Type | Description |
|---|---|---|
| `path` | `string` | Output file path (required) |
| `fsync` | `boolean` | Fsync after each write. Default `true` |

---

## Provenance

### createProvenanceTracker

```ts
createProvenanceTracker(): ProvenanceTracker
```

Tracks data lineage through a pipeline, recording transformations applied to data.

```ts
import { createProvenanceTracker } from '@elsium-ai/observe'

const provenance = createProvenanceTracker()

provenance.record({
  prompt: 'chunk',
  model: 'text-splitter',
  config: { chunkSize: 512 },
  input: 'raw-document',
  output: 'chunked-document',
  traceId: 'trc_pipeline_1',
})

const embedded = provenance.record({
  prompt: 'embed',
  model: 'text-embedding-3-small',
  config: {},
  input: 'chunked-document',
  output: 'embedded-document',
  traceId: 'trc_pipeline_1',
})

const lineage = provenance.getLineage(embedded.outputHash)
```

---

## Experiments

### createExperiment

```ts
createExperiment(config: ExperimentConfig): Experiment
```

Creates an A/B testing and evaluation framework for comparing models, prompts, or configurations.

### createFileExperimentStore

```ts
createFileExperimentStore(dir: string): ExperimentStore
```

Creates a file-based experiment store for persisting experiment results.

```ts
import { createExperiment, createFileExperimentStore } from '@elsium-ai/observe'

const store = createFileExperimentStore('./experiments')

const experiment = createExperiment({
  name: 'prompt-comparison',
  variants: [
    { name: 'concise', weight: 1, config: { systemPrompt: 'Be concise.' } },
    { name: 'detailed', weight: 1, config: { systemPrompt: 'Be detailed and thorough.' } },
  ],
  store,
})

const variant = experiment.assign(userId)
const result = await runWithVariant(variant)
experiment.record(variant.name, result)

const analysis = experiment.results()
```

---

## Instrumentation

### instrumentComplete

```ts
instrumentComplete(complete: CompleteFn, tracer: Tracer): CompleteFn
```

Wraps an LLM complete function with automatic span creation, recording model, tokens, cost, and errors.

### instrumentAgent

```ts
instrumentAgent(agent: Agent, tracer: Tracer): Agent
```

Wraps an agent with automatic tracing, creating spans for each run and tool invocation.

```ts
import { observe, instrumentComplete, instrumentAgent } from '@elsium-ai/observe'
import { defineAgent } from '@elsium-ai/agents'

const tracer = observe()

// Instrument gateway completions
const tracedComplete = instrumentComplete(gw.complete.bind(gw), tracer)
const response = await tracedComplete(request) // automatically traced

// Instrument an agent
const agent = defineAgent({ name: 'assistant', /* ... */ })
const tracedAgent = instrumentAgent(agent, tracer)
const result = await tracedAgent.run('Hello') // automatically traced with per-tool spans
```

---

## OpenTelemetry

Integration with the OpenTelemetry ecosystem for exporting traces to any OTel-compatible backend.

### Span Conversion

| Export | Signature | Description |
|---|---|---|
| `toOTelSpan` | `toOTelSpan(span: SpanData): OTelSpan` | Convert an ElsiumAI span to OTel span format |
| `toOTelExportRequest` | `toOTelExportRequest(spans: SpanData[]): OTelExportRequest` | Create an OTLP export request from spans |

### W3C Trace Context

| Export | Signature | Description |
|---|---|---|
| `toTraceparent` | `toTraceparent(span: SpanData): string` | Generate a W3C `traceparent` header value |
| `parseTraceparent` | `parseTraceparent(header: string): TraceContext \| null` | Parse a `traceparent` header |
| `injectTraceContext` | `injectTraceContext(span: SpanData, headers?: Record<string, string>): Record<string, string>` | Inject trace context into outgoing request headers |
| `extractTraceContext` | `extractTraceContext(headers: Record<string, string \| undefined>): TraceContext \| null` | Extract trace context from incoming request headers |

### OTLP Exporter

### createOTLPExporter

```ts
createOTLPExporter(config: OTLPExporterConfig): TracerExporter
```

Creates an OTLP HTTP exporter with batching for sending traces to an OTel collector.

```ts
import {
  createOTLPExporter,
  observe,
  toTraceparent,
  injectTraceContext,
} from '@elsium-ai/observe'

// Set up OTLP export
const exporter = createOTLPExporter({
  endpoint: 'https://otel-collector.example.com/v1/traces',
  headers: { 'x-api-key': env('OTEL_API_KEY') },
  batchSize: 100,
  flushIntervalMs: 5000,
})

const tracer = observe({
  output: [exporter],
})

// W3C Trace Context propagation
const span = tracer.startSpan('outgoing-request')
const traceparent = toTraceparent(span)
// traceparent: '00-<traceId>-<spanId>-01'

const headers = injectTraceContext(span, {})
// headers now contains 'traceparent' for downstream services
```

---

## Compliance Reporting

Generate compliance reports against regulatory frameworks from audit trail data.

### generateComplianceReport

```ts
generateComplianceReport(
  auditTrail: AuditTrail,
  config: ComplianceReportConfig,
): Promise<ComplianceReport>
```

Generates a compliance report by evaluating audit trail events against a set of framework-specific checks.

**Supported Frameworks:**

| Framework | Description |
|---|---|
| `owasp-agentic` | OWASP Top 10 for Agentic AI Applications (6 checks) |
| `eu-ai-act` | EU AI Act requirements for high-risk systems (5 checks) |
| `colorado-ai-act` | Colorado AI Act requirements (3 checks) |
| `custom` | User-defined compliance checks |

**Config:**

| Field | Type | Description |
|---|---|---|
| `framework` | `ComplianceFramework` | Target regulatory framework |
| `systemName` | `string` | Name of the AI system |
| `systemVersion` | `string` | Version of the system |
| `reportPeriod` | `{ from: number; to: number }` | Time range for the report |
| `riskLevel` | `'minimal' \| 'limited' \| 'high' \| 'unacceptable'` (optional) | Risk classification (EU AI Act) |
| `customChecks` | `ComplianceCheck[]?` | Custom checks for `custom` framework |

```ts
import { createAuditTrail, generateComplianceReport, formatComplianceReport } from '@elsium-ai/observe'

const audit = createAuditTrail({ hashChain: true })

const report = await generateComplianceReport(audit, {
  framework: 'eu-ai-act',
  systemName: 'medical-triage-ai',
  systemVersion: '2.1.0',
  reportPeriod: {
    from: Date.now() - 30 * 24 * 60 * 60 * 1000,
    to: Date.now(),
  },
  riskLevel: 'high',
})

// report.summary.overallStatus: 'compliant' | 'non-compliant' | 'needs-review'
// report.checks: individual check results with evidence and recommendations
```

### formatComplianceReport

```ts
formatComplianceReport(report: ComplianceReport): string
```

Formats a compliance report as human-readable Markdown.

```ts
const markdown = formatComplianceReport(report)
// Outputs structured markdown with summary table, integrity status, and per-check details
```

---

## OpenTelemetry GenAI Semantic Conventions (experimental)

> ⚠️ **Spec status:** The OpenTelemetry GenAI Semantic Conventions are in **Development**, not stable. ElsiumAI tracks spec versions and ships built-in mappers for `v1.36`. Emission of `gen_ai.*` attributes is **opt-in** via `OTEL_SEMCONV_STABILITY_OPT_IN`, matching the spec's transition plan.

See the full guide at [`docs/guides/otel-genai.md`](../guides/otel-genai.md).

### Emission policy

| `OTEL_SEMCONV_STABILITY_OPT_IN` contains | Legacy `elsium.*` | Experimental `gen_ai.*` |
|---|---|---|
| (empty / unset) | ✅ emitted | ❌ not emitted |
| `gen_ai_latest_experimental` | ❌ not emitted | ✅ emitted (with legacy fallback for span kinds without a GenAI mapper) |

### createEmissionPolicy

```ts
createEmissionPolicy(config?: EmissionPolicyConfig): EmissionPolicy
```

Resolves the emission policy from `OTEL_SEMCONV_STABILITY_OPT_IN` or from an explicit opt-in array.

```ts
import { createEmissionPolicy } from '@elsium-ai/observe'

// From env (default)
const fromEnv = createEmissionPolicy()

// Explicit opt-in (overrides env)
const explicit = createEmissionPolicy({ optIn: ['gen_ai_latest_experimental'] })

explicit.shouldEmitGenAI() // true
explicit.shouldEmitLegacy() // false
```

### parseSemconvOptIn

```ts
parseSemconvOptIn(envValue: string | undefined): ReadonlySet<SemconvStabilityFlag>
```

Parses the CSV value of `OTEL_SEMCONV_STABILITY_OPT_IN` into a flag set. Empty/missing input returns an empty set.

### Registry

| Export | Description |
|---|---|
| `createGenAIConventionRegistry(defaultVersion?)` | Create an empty registry with a chosen default spec version |
| `getDefaultRegistry()` | Singleton with built-in mappers for `llm`, `tool`, `agent` spans on spec `v1.36` |

```ts
import { createGenAIConventionRegistry, type GenAIMapper } from '@elsium-ai/observe'

const reg = createGenAIConventionRegistry('v1.37')
const customMapper: GenAIMapper<'llm'> = {
  kind: 'llm',
  specVersion: 'v1.37',
  map(span) {
    // your mapping logic
    return null
  },
}
reg.register(customMapper)
```

### OTLP exporter with GenAI emission

```ts
import { createOTLPExporter } from '@elsium-ai/observe'

const exporter = createOTLPExporter({
  endpoint: 'http://localhost:4318/v1/traces',
  semconv: { optIn: ['gen_ai_latest_experimental'] }, // force GenAI emission regardless of env
})
```

If `semconv.optIn` is omitted, the exporter reads `OTEL_SEMCONV_STABILITY_OPT_IN` from `process.env` at construction time.

### Metadata keys consumed by built-in mappers

Built-in `v1.36` mappers read these keys from `span.metadata`:

| Span kind | Required | Optional |
|---|---|---|
| `llm` | `provider` (string), `model` or `requestModel` (string) | `operationName`, `maxTokens`, `temperature`, `topP`, `topK`, `responseModel`, `responseId`, `finishReasons` (string[]) or `finishReason` (string), `inputTokens`, `outputTokens` |
| `tool` | `toolName` (string) or falls back to `span.name` | `toolCallId`, `toolType` (`function` / `retrieval` / `code_interpreter`) |
| `agent` | `agentName` (string) or falls back to `span.name` | `provider`, `model`, `inputTokens`, `outputTokens` |

Unknown metadata is preserved in the legacy fallback when a mapper cannot produce GenAI attributes (e.g. missing `provider`).

---

## Signed Proofs (Verifiable Agent Execution)

Per-run, cryptographically signed execution proofs. Each agent run is recorded as a **SHA-256 hash chain** of events (LLM calls, tool calls, RAG retrievals, policy decisions), and the chain head is signed with **Ed25519**. Anyone holding the public key can later verify — offline — that the run happened exactly as recorded and was produced by the holder of the signing key. Two proofs can be diffed to check replay reproducibility.

Builds on `@elsium-ai/core` crypto (`createEd25519Signer`, `createKeyRegistry`, `WriteOnceStore`). Proof event data stores **hashes** of inputs/outputs (`requestHash`, `responseHash`, `inputHash`, …), not raw payloads, so proofs are safe to share without leaking prompt content.

### createProofRecorder

```ts
createProofRecorder(config: ProofRecorderConfig): ProofRecorder
```

Creates a recorder bound to a signer. Open a session per agent run, record events, then `finalize()` to produce a signed `ExecutionProof`.

**Config (`ProofRecorderConfig`):**

| Field | Type | Description |
|---|---|---|
| `signer` | `Signer` | Ed25519 signer (from `createEd25519Signer`) |
| `clock` | `() => number` | Clock injection for deterministic tests. Defaults to `Date.now` |

**`ProofRecorder` methods:**

| Method | Signature | Description |
|---|---|---|
| `startSession` | `startSession(options: StartSessionOptions): ProofSession` | Begin a new proof session |
| `middleware` | `middleware(): Middleware` | Gateway middleware that auto-records an `llm.call` event when `ctx.metadata.proofSessionId` matches a live session |
| `verify` | `verify(proof: ExecutionProof, registry: KeyRegistry): VerifyProofResult` | Verify a proof against trusted keys |

**`StartSessionOptions`:**

| Field | Type | Description |
|---|---|---|
| `agentId` | `string` | Identifier of the agent under proof (required) |
| `agentVersion` | `string?` | Agent version, recorded in the proof |
| `reproducibility` | `ReproducibilityHints?` | `{ seeds?, modelVersions?, toolVersions? }` recorded for replay |
| `inputs` | `ProofSessionInputs?` | Initial inputs, recorded as the opening `agent.input` event |
| `clock` | `() => number` | Per-session clock override |

**`ProofSession` methods:** `recordLLMCall(summary)`, `recordToolCall(summary)`, `recordRagRetrieve(summary)`, `recordPolicyDecision(summary)`, `recordCustom(data)` — each appends a chained `ProofEvent` and returns it — plus `finalize(options?)`.

**`finalize(options?: FinalizeOptions)`** appends an `agent.output` event if `finalOutput` is given, signs the chain head, and returns the `ExecutionProof`. If a `WriteOnceStore` is passed via `options.store`, the proof is persisted under `options.storeKey?.(proofId)` (default `<proofId>.json`). Recording after finalize throws.

```ts
import { createProofRecorder } from '@elsium-ai/observe'
import {
  createEd25519Signer,
  createKeyRegistry,
  createInMemoryWriteOnceStore,
  generateEd25519KeyPair,
} from '@elsium-ai/core'

const keyPair = generateEd25519KeyPair()
const signer = createEd25519Signer({ privateKey: keyPair.privateKey, keyId: 'agent-key-1' })
const store = createInMemoryWriteOnceStore()

const recorder = createProofRecorder({ signer })

const session = recorder.startSession({
  agentId: 'support-agent',
  agentVersion: '1.4.0',
  inputs: { messages: [{ role: 'user', content: 'reset my password' }] },
  reproducibility: { modelVersions: { primary: 'claude-sonnet-4-20250514' } },
})

session.recordToolCall({ tool: 'lookup_account', inputHash: 'a1b2…', outputHash: 'c3d4…' })
session.recordPolicyDecision({ rule: 'pii-redaction', result: 'allow' })

const proof = await session.finalize({ finalOutput: 'Password reset link sent.', store })
// proof.chainHead is signed; proof.signature carries keyId + Ed25519 value
```

### verifyProof

```ts
verifyProof(proof: ExecutionProof, registry: KeyRegistry): VerifyProofResult
```

Verifies a proof offline in two stages: (1) recompute the hash chain (each `hashPrev`/`hashSelf` and the `chainHead`), then (2) verify the Ed25519 signature over the chain head against the trusted keys in `registry`. Returns early with `chainValid: false` if the chain is broken.

**Result (`VerifyProofResult`):**

| Field | Type | Description |
|---|---|---|
| `valid` | `boolean` | True only if both chain and signature are valid |
| `signatureValid` | `boolean` | Ed25519 signature verified against a trusted key |
| `chainValid` | `boolean` | Hash chain is intact end-to-end |
| `chainBrokenAt` | `number?` | Index of the first broken event, if any |
| `reason` | `string?` | Human-readable failure reason |

```ts
import { verifyProof } from '@elsium-ai/observe'
import { createKeyRegistry } from '@elsium-ai/core'

const registry = createKeyRegistry()
registry.add('agent-key-1', keyPair.publicKey)

const result = verifyProof(proof, registry)
if (!result.valid) {
  console.error('Proof rejected:', result.reason, 'broken at', result.chainBrokenAt)
}
```

### compareProofs

```ts
compareProofs(proofA: ExecutionProof, proofB: ExecutionProof, options?: { strategy?: ReplayStrategy }): ReplayDiff
```

Diffs two proofs event-by-event to assess replay reproducibility. Two strategies:

- **`'structural'`** (default): ignores non-deterministic event types (`llm.call` data beyond `model`/`provider`, `agent.input`, `agent.output`, `custom`) and compares deterministic events (tool calls, policy decisions, RAG) by data. `matches` is true when no deltas are found.
- **`'bit-exact'`**: compares event `type` and `hashSelf`; additionally requires `chainHeadMatch` for `matches`.

**Result (`ReplayDiff`):**

| Field | Type | Description |
|---|---|---|
| `matches` | `boolean` | Proofs are equivalent under the chosen strategy |
| `strategy` | `ReplayStrategy` | Strategy used |
| `agentIdMatch` | `boolean` | `agentId` values match |
| `agentVersionMatch` | `boolean` | `agentVersion` values match |
| `eventCountA` / `eventCountB` | `number` | Event counts per proof |
| `chainHeadMatch` | `boolean` | Chain heads are identical |
| `deltas` | `EventDelta[]` | Per-event differences (`missing-in-b`, `extra-in-b`, `type-mismatch`, `hash-mismatch`, `data-mismatch`) |
| `summary` | `{ matchedEvents; differingEvents; extraInA; extraInB }` | Roll-up counts |

```ts
import { compareProofs } from '@elsium-ai/observe'

const diff = compareProofs(recordedProof, replayedProof, { strategy: 'structural' })
if (!diff.matches) {
  console.warn('Replay diverged', diff.deltas)
}
```

### ExecutionProof shape

```ts
interface ExecutionProof {
  version: 'elsium-proof/v1'
  proofId: string
  agentId: string
  agentVersion?: string
  startedAt: string  // ISO 8601
  endedAt: string    // ISO 8601
  events: ProofEvent[]
  chainHead: string  // hashSelf of the final event
  signature: Signature  // Ed25519, carries keyId
  reproducibility?: ReproducibilityHints
}
```

Each `ProofEvent` is `{ sequence, type, timestamp, data, hashPrev, hashSelf }` where `type` is one of `agent.input`, `agent.output`, `llm.call`, `tool.call`, `rag.retrieve`, `policy.evaluated`, `custom`. The constants `PROOF_VERSION` (`'elsium-proof/v1'`) and `PROOF_SESSION_METADATA_KEY` (`'proofSessionId'`, the `ctx.metadata` key the middleware reads) are also exported.

---

## Studio Exporter

### createStudioExporter

```ts
createStudioExporter(config?: StudioExporterConfig): StudioExporter
```

A `TracerExporter` that writes traces, X-Ray history, and cost reports to a local directory for consumption by Elsium Studio tooling. Spans are written per-trace as `<dir>/traces/<traceId>.json`; X-Ray entries accumulate (newest first, capped at 500) in `<dir>/xray-history.json`; cost reports are written to `<dir>/cost-report.json`. All writes are best-effort and never throw (failures are logged).

**Config (`StudioExporterConfig`):**

| Field | Type | Description |
|---|---|---|
| `dir` | `string?` | Output base directory. Default `'.elsium'` |

In addition to the `TracerExporter.export(spans)` method, `StudioExporter` adds `writeXRayEntry(entry: Record<string, unknown>)` and `writeCostReport(report: CostReport)`.

```ts
import { createStudioExporter, observe } from '@elsium-ai/observe'

const studio = createStudioExporter({ dir: '.elsium' })

const tracer = observe({ output: [studio] })
// spans are persisted under .elsium/traces/<traceId>.json

studio.writeCostReport(tracer.getCostReport())
```
