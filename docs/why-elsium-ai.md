# Why ElsiumAI

Every framework helps you call an LLM. ElsiumAI helps you trust the result.

ElsiumAI is built on three pillars that the ecosystem hasn't prioritized yet:

| Pillar | The guarantee |
|--------|--------------|
| **Reproducible AI** | Tools to measure, pin, and reproduce AI outputs — seed propagation, output pinning, provenance tracking, determinism assertions |
| **Reliability** | Your system stays up when providers break — circuit breakers, bulkhead isolation, request dedup, graceful shutdown |
| **Governance** | You control who does what, and you can prove it — policy engine, RBAC, approval gates, hash-chained audit trail |

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

### Reproducible AI — you can reproduce results

Nobody is doing this well at the framework level. LLMs are non-deterministic by nature. ElsiumAI gives you the tools to constrain, measure, and track output consistency — and catch regressions in CI before they reach production.

| Feature | What it does | Source |
|---------|-------------|--------|
| **Seed Propagation** | Passes seed through the stack to OpenAI, Google, and Anthropic APIs | [`CompletionRequest.seed`](../packages/core/src/types.ts) |
| **Output Pinning** | Locks expected outputs — model update changes your classifier? CI catches it | [`pinOutput`](../packages/testing/src/pinning.ts) |
| **Determinism Assertions** | Run N times, verify all outputs match, fail in CI if they don't | [`assertDeterministic`](../packages/testing/src/determinism.ts) |
| **Provenance Tracking** | SHA-256 hashes every prompt/config/input/output — full lineage per traceId | [`createProvenanceTracker`](../packages/observe/src/provenance.ts) |
| **Request-Matched Fixtures** | Replay test fixtures by content hash, not sequence order | [`createFixture`](../packages/testing/src/fixtures.ts) |

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

### Reliability — your system stays up

Providers go down. Rate limits hit. Costs spiral. ElsiumAI treats failure as a first-class concern.

| Feature | What it does | Source |
|---------|-------------|--------|
| **Circuit Breaker** | Detects failing providers, stops sending traffic, auto-recovers | [`createCircuitBreaker`](../packages/core/src/circuit-breaker.ts) |
| **Bulkhead Isolation** | Bounds concurrency — one slow consumer can't starve the rest | [`createBulkhead`](../packages/gateway/src/bulkhead.ts) |
| **Request Dedup** | Identical in-flight calls coalesce into one API request | [`createDedup`](../packages/core/src/dedup.ts) |
| **Graceful Shutdown** | Drains in-flight operations before process exit | [`createShutdownManager`](../packages/core/src/shutdown.ts) |
| **Retry with Backoff** | Exponential backoff with jitter, respects `Retry-After` headers | [`retry`](../packages/core/src/utils.ts) |
| **Provider Mesh** | Multi-provider routing: fallback, latency-racing, cost-optimized, capability-aware | [`createProviderMesh`](../packages/gateway/src/router.ts) |

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

| Feature | What it does | Source |
|---------|-------------|--------|
| **Policy Engine** | Declarative rules — deny by model, cost, token count, or content pattern | [`createPolicySet`](../packages/core/src/policy.ts) |
| **RBAC** | Role-based permissions with inheritance and wildcard matching | [`createRBAC`](../packages/app/src/rbac.ts) |
| **Approval Gates** | Human-in-the-loop for high-stakes tool calls or expensive operations | [`createApprovalGate`](../packages/agents/src/approval.ts) |
| **Audit Trail** | SHA-256 hash-chained events with tamper-proof integrity verification | [`createAuditTrail`](../packages/observe/src/audit.ts) |
| **PII Detection** | Auto-redacts emails, phones, addresses, API keys before they reach the model | [`createAgentSecurity`](../packages/agents/src/security.ts) |

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
- **You need a Python framework** — ElsiumAI is TypeScript-only
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

## Where ElsiumAI Fits

The AI ecosystem has solved foundational problems. LangChain and LlamaIndex made orchestration accessible. Vercel AI SDK brought streaming-first ergonomics to the frontend. LiteLLM, Portkey, and Helicone built powerful LLM gateways for routing, observability, and cost tracking.

ElsiumAI stands on those shoulders. It solves the next problem: **what happens when you take AI to production with regulated workloads?** When you need to prove what happened, survive provider outages without code changes, and catch model regressions before they ship.

You can use ElsiumAI alongside your existing tools, or as a standalone framework — it works either way.

```
Your Application
├── Orchestration     → LangChain, LlamaIndex, Vercel AI SDK, or ElsiumAI agents
├── LLM Gateway       → LiteLLM, Portkey, or ElsiumAI gateway
└── Production Layer  → ElsiumAI (reliability, governance, reproducibility)
```

ElsiumAI is the production layer. Use it with whatever orchestration and gateway you already have, or use ElsiumAI's own — the three pillars work regardless.

## What ElsiumAI Adds

### Production Reliability

| Feature | What it does | Source |
|---------|-------------|--------|
| Circuit breaker | Detects failing providers, stops sending traffic, auto-recovers | [`createCircuitBreaker`](../packages/core/src/circuit-breaker.ts) |
| Bulkhead isolation | Bounds concurrency — one slow consumer can't starve the rest | [`createBulkhead`](../packages/gateway/src/bulkhead.ts) |
| Request dedup | Identical in-flight calls coalesce into one API request | [`createDedup`](../packages/core/src/dedup.ts) |
| Graceful shutdown | Drains in-flight operations before process exit | [`createShutdownManager`](../packages/core/src/shutdown.ts) |
| Provider mesh | Multi-provider routing: fallback, latency-racing, cost-optimized, capability-aware | [`createProviderMesh`](../packages/gateway/src/router.ts) |
| Retry with backoff | Exponential backoff with jitter, respects `Retry-After` headers | [`retry`](../packages/core/src/utils.ts) |

### Governance & Compliance

| Feature | What it does | Source |
|---------|-------------|--------|
| Policy engine | Declarative rules — deny by model, cost, token count, or content pattern | [`createPolicySet`](../packages/core/src/policy.ts) |
| RBAC | Role-based permissions with inheritance and wildcard matching | [`createRBAC`](../packages/app/src/rbac.ts) |
| Approval gates | Human-in-the-loop for high-stakes tool calls or expensive operations | [`createApprovalGate`](../packages/agents/src/approval.ts) |
| Hash-chained audit trail | SHA-256 hash-chained events with tamper-proof integrity verification | [`createAuditTrail`](../packages/observe/src/audit.ts) |
| PII detection & redaction | Auto-redacts emails, phones, addresses, API keys before they reach the model | [`createAgentSecurity`](../packages/agents/src/security.ts) |

### Reproducible AI

| Feature | What it does | Source |
|---------|-------------|--------|
| Seed propagation | Passes seed through the stack to OpenAI, Google, and Anthropic APIs | [`CompletionRequest.seed`](../packages/core/src/types.ts) |
| Output pinning | Locks expected outputs — model update changes your classifier? CI catches it | [`pinOutput`](../packages/testing/src/pinning.ts) |
| Determinism assertions | Run N times, verify all outputs match, fail in CI if they don't | [`assertDeterministic`](../packages/testing/src/determinism.ts) |
| Provenance tracking | SHA-256 hashes every prompt/config/input/output — full lineage per traceId | [`createProvenanceTracker`](../packages/observe/src/provenance.ts) |
| Request-matched fixtures | Replay test fixtures by content hash, not sequence order | [`createFixture`](../packages/testing/src/fixtures.ts) |

---

## Get Started

```bash
bun add @elsium-ai/core @elsium-ai/gateway @elsium-ai/agents
```

```typescript
import { env } from '@elsium-ai/core'
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
