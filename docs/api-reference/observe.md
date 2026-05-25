# elsium-ai/observe

Observability module providing tracing, cost tracking, metrics, audit logging, provenance tracking, experimentation, and OpenTelemetry integration.

```ts
import { createSpan, observe, createCostEngine, createMetrics } from '@elsium-ai/observe'
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
import { createSpan } from '@elsium-ai/observe'

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
import { observe } from '@elsium-ai/observe'

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
  budget: { maxTotalCost: 10.0, currency: 'USD' },
  alertThreshold: 0.8, // alert at 80% budget usage
})

costEngine.track(response.cost)
const remaining = costEngine.remaining()
const suggestion = costEngine.suggestModel({ budget: 1.0, minQuality: 'high' })
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
registerModelTier(model: string, tier: ModelTier): void
```

Registers a model's pricing tier for cost engine calculations.

```ts
import { registerModelTier } from '@elsium-ai/observe'

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
import { createAuditTrail, auditMiddleware } from '@elsium-ai/observe'

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
import { createProvenanceTracker } from '@elsium-ai/observe'

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
import { createExperiment, createFileExperimentStore } from '@elsium-ai/observe'

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
import { observe, instrumentComplete, instrumentAgent } from '@elsium-ai/observe'
import { defineAgent } from '@elsium-ai/agents'

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
} from '@elsium-ai/observe'

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
| `riskLevel` | `string?` | Risk classification (EU AI Act) |
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
