# elsium-ai/observe

Observability module providing tracing, cost tracking, metrics, audit logging, provenance tracking, experimentation, and OpenTelemetry integration.

```ts
import { createSpan, observe, createCostEngine, createMetrics } from 'elsium-ai/observe'
```

---

## Tracing

### createSpan

```ts
createSpan(name: string, opts?: SpanOptions): Span
```

Creates a trace span for tracking execution of a unit of work.

**Options:**

| Field | Type | Description |
|---|---|---|
| `kind` | `string` | Span kind (e.g., `'llm'`, `'tool'`, `'agent'`) |
| `parent` | `Span` | Parent span for nested traces |
| `attributes` | `Record<string, unknown>` | Key-value metadata |

```ts
import { createSpan } from 'elsium-ai/observe'

const span = createSpan('llm-request', {
  kind: 'llm',
  attributes: { model: 'claude-sonnet-4-20250514', provider: 'anthropic' },
})

try {
  const result = await provider.complete(request)
  span.setAttributes({ tokens: result.usage.totalTokens })
  span.end()
} catch (error) {
  span.setError(error)
  span.end()
  throw error
}
```

### observe

```ts
observe(config: ObserveConfig): Tracer
```

Creates a tracer with sampling, exporters, and cost tracking.

```ts
import { observe } from 'elsium-ai/observe'

const tracer = observe({
  serviceName: 'my-ai-app',
  samplingRate: 0.1, // sample 10% of traces
  exporters: [consoleExporter, otlpExporter],
  costTracking: true,
})

const span = tracer.startSpan('process-request')
```

---

## Cost

### createCostEngine

```ts
createCostEngine(config: CostEngineConfig): CostEngine
```

Creates a cost engine for budget enforcement, loop detection, and model cost suggestions.

```ts
import { createCostEngine } from 'elsium-ai/observe'

const costEngine = createCostEngine({
  budget: { maxTotalCost: 10.0, currency: 'USD' },
  alertThreshold: 0.8, // alert at 80% budget usage
})

costEngine.track(response.cost)
const remaining = costEngine.remaining()
const suggestion = costEngine.suggestModel({ budget: 1.0, minQuality: 'high' })
```

### registerModelTier

```ts
registerModelTier(model: string, tier: ModelTier): void
```

Registers a model's pricing tier for cost engine calculations.

```ts
import { registerModelTier } from 'elsium-ai/observe'

registerModelTier('custom-model-v1', {
  inputPer1kTokens: 0.005,
  outputPer1kTokens: 0.015,
  tier: 'premium',
})
```

---

## Metrics

### createMetrics

```ts
createMetrics(): Metrics
```

Creates a metrics collector for tracking counters, gauges, and histograms.

**Methods:**

| Method | Signature | Description |
|---|---|---|
| `increment` | `increment(name: string, value?: number, tags?: Tags): void` | Increment a counter |
| `gauge` | `gauge(name: string, value: number, tags?: Tags): void` | Set a gauge value |
| `histogram` | `histogram(name: string, value: number, tags?: Tags): void` | Record a histogram value |

```ts
import { createMetrics } from 'elsium-ai/observe'

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
import { createAuditTrail } from 'elsium-ai/observe'

const audit = createAuditTrail({
  storage: 'file',
  path: './audit/llm-audit.log',
})

await audit.record({
  action: 'completion',
  model: 'claude-sonnet-4-20250514',
  input: request.messages,
  output: response.content,
  cost: response.cost,
  userId: ctx.userId,
})
```

### auditMiddleware

```ts
auditMiddleware(trail: AuditTrail): Middleware
```

Middleware that automatically records all requests and responses to the audit trail.

```ts
import { createAuditTrail, auditMiddleware } from 'elsium-ai/observe'

const audit = createAuditTrail({ storage: 'file', path: './audit.log' })

const gw = gateway({
  middleware: [auditMiddleware(audit)],
})
```

---

## Provenance

### createProvenanceTracker

```ts
createProvenanceTracker(): ProvenanceTracker
```

Tracks data lineage through a pipeline, recording transformations applied to data.

```ts
import { createProvenanceTracker } from 'elsium-ai/observe'

const provenance = createProvenanceTracker()

provenance.record({
  input: 'raw-document',
  output: 'chunked-document',
  operation: 'chunk',
  metadata: { chunkSize: 512 },
})

provenance.record({
  input: 'chunked-document',
  output: 'embedded-document',
  operation: 'embed',
  metadata: { model: 'text-embedding-3-small' },
})

const lineage = provenance.getLineage('embedded-document')
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
import { createExperiment, createFileExperimentStore } from 'elsium-ai/observe'

const store = createFileExperimentStore('./experiments')

const experiment = createExperiment({
  name: 'prompt-comparison',
  variants: [
    { name: 'concise', systemPrompt: 'Be concise.' },
    { name: 'detailed', systemPrompt: 'Be detailed and thorough.' },
  ],
  metrics: ['latency', 'cost', 'quality'],
  store,
})

const variant = experiment.assign(userId)
const result = await runWithVariant(variant)
experiment.record(variant, result)

const analysis = experiment.analyze()
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
import { observe, instrumentComplete, instrumentAgent } from 'elsium-ai/observe'
import { defineAgent } from 'elsium-ai/agents'

const tracer = observe({ serviceName: 'my-app' })

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
| `toOTelSpan` | `toOTelSpan(span: Span): OTelSpan` | Convert an ElsiumAI span to OTel span format |
| `toOTelExportRequest` | `toOTelExportRequest(spans: Span[]): OTLPExportRequest` | Create an OTLP export request from spans |

### W3C Trace Context

| Export | Signature | Description |
|---|---|---|
| `toTraceparent` | `toTraceparent(span: Span): string` | Generate a W3C `traceparent` header value |
| `parseTraceparent` | `parseTraceparent(header: string): TraceContext` | Parse a `traceparent` header |
| `injectTraceContext` | `injectTraceContext(span: Span, headers: Headers): Headers` | Inject trace context into outgoing request headers |
| `extractTraceContext` | `extractTraceContext(headers: Headers): TraceContext \| null` | Extract trace context from incoming request headers |

### OTLP Exporter

### createOTLPExporter

```ts
createOTLPExporter(config: OTLPExporterConfig): Exporter
```

Creates an OTLP HTTP exporter with batching for sending traces to an OTel collector.

```ts
import {
  createOTLPExporter,
  observe,
  toTraceparent,
  injectTraceContext,
} from 'elsium-ai/observe'

// Set up OTLP export
const exporter = createOTLPExporter({
  endpoint: 'https://otel-collector.example.com/v1/traces',
  headers: { 'x-api-key': env('OTEL_API_KEY') },
  batchSize: 100,
  flushIntervalMs: 5000,
})

const tracer = observe({
  serviceName: 'my-ai-app',
  exporters: [exporter],
})

// W3C Trace Context propagation
const span = tracer.startSpan('outgoing-request')
const traceparent = toTraceparent(span)
// traceparent: '00-<traceId>-<spanId>-01'

const headers = new Headers()
injectTraceContext(span, headers)
// headers now contains 'traceparent' for downstream services
```
