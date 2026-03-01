# Why ElsiumAI

Every framework helps you call an LLM. None of them help you trust the result.

ElsiumAI is built on three pillars that most frameworks ignore entirely:

| Pillar | The guarantee |
|--------|--------------|
| **Reliability** | Your system stays up when providers break — circuit breakers, bulkhead isolation, request dedup, graceful shutdown |
| **Governance** | You control who does what, and you can prove it — policy engine, RBAC, approval gates, hash-chained audit trail |
| **Reproducible AI** | Tools to measure, pin, and reproduce AI outputs — seed propagation, output pinning, provenance tracking, determinism assertions |

It also does everything you'd expect — multi-provider gateway, agents, tools, RAG, workflows, MCP, streaming, cost tracking. But those are table stakes. The three pillars are what make ElsiumAI different.

---

## Who Should Use ElsiumAI

ElsiumAI is for teams building AI systems that must be **auditable**, **reliable**, and **reproducible** in production.

- **Enterprise engineering teams** shipping AI features where downtime, compliance gaps, or silent model regressions are not acceptable
- **Regulated industries** (finance, healthcare, legal) where you need to prove what happened, who authorized it, and that outputs haven't been tampered with
- **Production-grade AI products** where "it works on my machine" isn't good enough — you need deterministic test suites, CI-integrated output pinning, and provider failover

If you're building a weekend hack with a single API key, you probably don't need this. If you're building something that other people depend on, read on.

---

## What You Get

### Reliability — your system stays up

Providers go down. Rate limits hit. Costs spiral. ElsiumAI treats failure as a first-class concern.

| Feature | What it does |
|---------|-------------|
| **Circuit Breaker** | Detects failing providers, stops sending traffic, auto-recovers |
| **Bulkhead Isolation** | Bounds concurrency — one slow consumer can't starve the rest |
| **Request Dedup** | Identical in-flight calls coalesce into one API request |
| **Graceful Shutdown** | Drains in-flight operations before process exit |
| **Retry with Backoff** | Exponential backoff with jitter, respects `Retry-After` headers |
| **Provider Mesh** | Multi-provider routing: fallback, latency-racing, cost-optimized, capability-aware |

```typescript
const mesh = createProviderMesh({
  providers: [
    { name: 'anthropic', config: { apiKey: env('ANTHROPIC_API_KEY') }, priority: 1 },
    { name: 'openai', config: { apiKey: env('OPENAI_API_KEY') }, priority: 2 },
  ],
  strategy: 'fallback',
  circuitBreaker: { failureThreshold: 5, resetTimeoutMs: 30_000 },
})
```

Anthropic goes down at 3 AM? Traffic reroutes to OpenAI. No pages. No code changes. No downtime.

### Governance — you can prove what happened

| Feature | What it does |
|---------|-------------|
| **Policy Engine** | Declarative rules — deny by model, cost, token count, or content pattern |
| **RBAC** | Role-based permissions with inheritance and wildcard matching |
| **Approval Gates** | Human-in-the-loop for high-stakes tool calls or expensive operations |
| **Audit Trail** | SHA-256 hash-chained events with tamper-proof integrity verification |
| **PII Detection** | Auto-redacts emails, phones, addresses, API keys before they reach the model |

```typescript
const policies = createPolicySet([
  modelAccessPolicy(['claude-sonnet-4-6', 'gpt-4o-mini']),
  costLimitPolicy(5.00),
])

const audit = createAuditTrail({ hashChain: true })

const rbac = createRBAC({
  roles: [{ name: 'analyst', permissions: ['model:use:gpt-4o-mini'], inherits: ['viewer'] }],
})
```

When an auditor asks "who ran this query, which model handled it, and can you prove the log hasn't been modified?" — you have the answer.

### Reproducible AI — you can reproduce results

LLMs are non-deterministic by nature. ElsiumAI gives you the tools to constrain, measure, and track output consistency.

| Feature | What it does |
|---------|-------------|
| **Seed Propagation** | Passes seed through the stack to OpenAI, Google, and Anthropic APIs |
| **Output Pinning** | Locks expected outputs — model update changes your classifier? CI catches it |
| **Determinism Assertions** | Run N times, verify all outputs match, fail in CI if they don't |
| **Provenance Tracking** | SHA-256 hashes every prompt/config/input/output — full lineage per traceId |
| **Request-Matched Fixtures** | Replay test fixtures by content hash, not sequence order |

```typescript
const result = await assertDeterministic(
  (seed) => llm.complete({
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Classify: spam' }] }],
    temperature: 0,
    seed,
  }).then(r => extractText(r.message.content)),
  { runs: 5, seed: 42, tolerance: 0 },
)
// { deterministic: true, variance: 0, uniqueOutputs: 1 }
```

Model provider ships a silent update and your classifier starts returning different results? Your CI pipeline catches it before production does.

---

## What Else It Does

The three pillars are what make ElsiumAI unique. It also delivers everything you'd expect from a modern AI framework:

| Category | Features |
|----------|----------|
| **Multi-provider gateway** | Anthropic, OpenAI, Google — X-Ray mode, middleware, smart routing |
| **Agents** | Memory, semantic guardrails, confidence scoring, state machines, multi-agent orchestration |
| **RAG** | Document loading, chunking, embeddings, vector search |
| **Workflows** | Sequential, parallel, and branching execution with retries |
| **MCP** | Bidirectional client/server bridge |
| **Cost intelligence** | Budgets, projections, loop detection |
| **Testing** | Mock providers, evals, LLM-as-judge, prompt versioning, regression suites |
| **Observability** | Tracing, spans, metrics, OpenTelemetry integration |

---

## Use Cases

### Fintech & Compliance
Policy engine enforces model allowlists and cost budgets. Hash-chained audit trail provides tamper-proof logs for regulatory review. RBAC ensures only authorized roles access sensitive models.

### Healthcare
PII detection auto-redacts patient data before it reaches any model. Approval gates require human sign-off on high-stakes operations. Provenance tracking maintains full lineage for every AI decision.

### Enterprise SaaS
Provider mesh with circuit breakers keeps your AI features online during provider outages. Cost intelligence with loop detection prevents runaway spend. RBAC maps to your existing org structure.

### AI-Powered Products
Determinism assertions and output pinning integrate into CI/CD — model regressions are caught before they ship. Request-matched fixtures make test suites fast and order-independent.

### Internal Tools
Cost budgets prevent a single runaway query from blowing your monthly spend. Loop detection catches infinite agent cycles. X-Ray mode gives full visibility into what's happening under the hood.

---

## When NOT to Use ElsiumAI

Being honest about scope builds trust. ElsiumAI is not the right choice if:

- **You're building a quick prototype** — if you just need a wrapper around one API and don't care about failover, governance, or reproducibility, a lighter library will get you there faster
- **You need a Python framework** — ElsiumAI is TypeScript-only, built on Bun
- **You don't need the three pillars** — if governance, reliability, and reproducibility aren't concerns for your use case, the overhead isn't worth it

---

## Performance

ElsiumAI is designed to add negligible overhead to your LLM calls. Measured with a zero-latency mock provider to isolate framework cost.

| Metric | P50 | P95 |
|--------|:---:|:---:|
| Core completion path | 2.3μs | 5.5μs |
| Full governance stack | 6.2μs | 9.5μs |
| Under concurrency (100 parallel) | 5.0μs | 6.4μs |

| | |
|---|---|
| Typical LLM network latency | 200–800ms |
| ElsiumAI overhead at P95 | <10μs |
| Framework cost contribution | <0.01% of total request time |
| Cold start | <3ms |
| Bundle size (minified) | 77 KB |

Full methodology and reproduction steps in [`../benchmarks/`](../benchmarks/).

---

## Comparison with Alternatives

How ElsiumAI compares on the three pillars:

| Feature | ElsiumAI | LangChain | Vercel AI SDK | LlamaIndex |
|---------|:--------:|:---------:|:-------------:|:----------:|
| **Reliability** | | | | |
| Circuit breaker | Yes | No | No | No |
| Bulkhead isolation | Yes | No | No | No |
| Request dedup | Yes | No | No | No |
| Provider mesh (multi-strategy) | Yes | Partial | No | No |
| Graceful shutdown | Yes | No | No | No |
| **Governance** | | | | |
| Policy engine | Yes | No | No | No |
| RBAC with role inheritance | Yes | No | No | No |
| Approval gates | Yes | No | No | No |
| Hash-chained audit trail | Yes | No | No | No |
| PII detection & redaction | Yes | No | No | No |
| **Reproducible AI** | | | | |
| Seed propagation | Yes | No | No | No |
| Output pinning | Yes | No | No | No |
| Determinism assertions | Yes | No | No | No |
| Provenance tracking | Yes | No | No | No |
| Request-matched fixtures | Yes | No | No | No |
| **Table Stakes** | | | | |
| Multi-provider support | Yes | Yes | Yes | Yes |
| Agents | Yes | Yes | Yes | Yes |
| RAG | Yes | Yes | No | Yes |
| Streaming | Yes | Yes | Yes | Yes |
| Tool use | Yes | Yes | Yes | Yes |
| TypeScript-native | Yes | Partial | Yes | No |

No framework is bad — they solve different problems. If you need the three pillars, ElsiumAI is the only framework that ships them as built-in, tested, production-ready features.

---

## Get Started

```bash
bun add @elsium-ai/core @elsium-ai/gateway @elsium-ai/agents
```

```typescript
import { gateway } from '@elsium-ai/gateway'
import { defineAgent } from '@elsium-ai/agents'

const llm = gateway({
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  apiKey: env('ANTHROPIC_API_KEY'),
})

const agent = defineAgent(
  { name: 'assistant', system: 'You are a helpful assistant.' },
  { complete: (req) => llm.complete(req) },
)

const result = await agent.run('What is TypeScript?')
```

Next steps:

- [Getting Started](./getting-started.md) — full setup guide with CLI scaffolding
- [Fundamentals](./fundamentals.md) — comprehensive guide to every feature with examples
