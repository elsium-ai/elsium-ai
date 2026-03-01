<p align="center">
  <a href="https://github.com/elsium-ai/elsium-ai" target="blank"><img src="assets/logo.png" width="320" alt="ElsiumAI Logo" /></a>
</p>
<h3 align="center">Reliability. Governance. Reproducible AI.</h3>
<p align="center">The TypeScript framework for AI systems you can trust in production.</p>
<p align="center">
  <a href="https://github.com/elsium-ai/elsium-ai/actions"><img src="https://github.com/elsium-ai/elsium-ai/workflows/CI/badge.svg" alt="CI"></a>
  <a href="https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/tests-569%20passing-brightgreen" alt="Tests">
  <img src="https://img.shields.io/badge/bundle-77KB%20minified-blue" alt="Bundle Size">
</p>

---

> **AI systems must fail predictably.**
> **AI systems must be auditable.**
> **AI systems must be reproducible.**
> **AI systems must be governed by policy, not hope.**
>
> Every feature in ElsiumAI exists to serve one of these principles.
> If it doesn't, it doesn't ship.

---

## The Problem

Every AI framework helps you call an LLM. None of them help you trust the result.

ElsiumAI is built on three pillars that most frameworks ignore entirely:

| Pillar | The guarantee |
|--------|--------------|
| **Reliability** | Your system stays up when providers break — circuit breakers, bulkhead isolation, request dedup, graceful shutdown |
| **Governance** | You control who does what, and you can prove it — policy engine, RBAC, approval gates, hash-chained audit trail |
| **Reproducible AI** | Tools to measure, pin, and reproduce AI outputs — seed propagation, output pinning, provenance tracking, determinism assertions |

It also does everything you'd expect — multi-provider gateway, agents, tools, RAG, workflows, MCP, streaming, cost tracking. But those are table stakes. The three pillars are what make ElsiumAI different.

---

## Quick Start

```bash
bun add @elsium-ai/core @elsium-ai/gateway @elsium-ai/agents
```

```typescript
import { gateway } from '@elsium-ai/gateway'
import { defineAgent } from '@elsium-ai/agents'
import { env } from '@elsium-ai/core'

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

---

## Reliability

Providers go down. Rate limits hit. Costs spiral. ElsiumAI treats failure as a first-class concern.

```typescript
import { createProviderMesh } from '@elsium-ai/gateway'
import { env } from '@elsium-ai/core'

const mesh = createProviderMesh({
  providers: [
    { name: 'anthropic', config: { apiKey: env('ANTHROPIC_API_KEY') } },
    { name: 'openai', config: { apiKey: env('OPENAI_API_KEY') } },
  ],
  strategy: 'fallback',
  circuitBreaker: {         // Provider failing? Circuit opens, traffic reroutes
    failureThreshold: 5,
    resetTimeoutMs: 30_000,
  },
})
```

| Feature | What it does |
|---------|-------------|
| **Circuit Breaker** | Detects failing providers, stops sending traffic, auto-recovers |
| **Bulkhead Isolation** | Bounds concurrency — one slow consumer can't starve the rest |
| **Request Dedup** | Identical in-flight calls coalesce into one API request |
| **Graceful Shutdown** | Drains in-flight operations before process exit |
| **Retry with Backoff** | Exponential backoff with jitter, respects `Retry-After` headers |

---

## Governance

Who called which model? Did they have permission? Can you prove the audit log hasn't been tampered with?

```typescript
import { createPolicySet, policyMiddleware, modelAccessPolicy, costLimitPolicy, env } from '@elsium-ai/core'
import { createAuditTrail, auditMiddleware } from '@elsium-ai/observe'
import { createRBAC } from '@elsium-ai/app'

// Policy: what's allowed
const policies = createPolicySet([
  modelAccessPolicy(['claude-sonnet-4-6', 'gpt-4o-mini']),
  costLimitPolicy(5.00),
])

// Audit: what happened (hash-chained, tamper-proof)
const audit = createAuditTrail({ hashChain: true })

// RBAC: who can do it
const rbac = createRBAC({
  roles: [{ name: 'analyst', permissions: ['model:use:gpt-4o-mini'], inherits: ['viewer'] }],
})

const llm = gateway({
  provider: 'anthropic',
  apiKey: env('ANTHROPIC_API_KEY'),
  middleware: [policyMiddleware(policies), auditMiddleware(audit)],
})
```

| Feature | What it does |
|---------|-------------|
| **Policy Engine** | Declarative rules — deny by model, cost, token count, or content pattern |
| **RBAC** | Role-based permissions with inheritance and wildcard matching |
| **Approval Gates** | Human-in-the-loop for high-stakes tool calls or expensive operations |
| **Audit Trail** | SHA-256 hash-chained events with tamper-proof integrity verification |
| **PII Detection** | Auto-redacts emails, phones, addresses, API keys before they reach the model |

---

## Reproducible AI

LLMs are non-deterministic by nature. ElsiumAI gives you the tools to constrain, measure, and track output consistency.

```typescript
import { assertDeterministic } from '@elsium-ai/testing'
import { createProvenanceTracker } from '@elsium-ai/observe'

// Verify: same input → same output
const result = await assertDeterministic(
  (seed) => llm.complete({
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Classify: spam' }] }],
    temperature: 0,
    seed,  // Propagated to provider API automatically
  }).then(r => extractText(r.message.content)),
  { runs: 5, seed: 42, tolerance: 0 },
)
// { deterministic: true, variance: 0, uniqueOutputs: 1 }

// Prove: who/what/when produced this output
const provenance = createProvenanceTracker()
provenance.record({ prompt, model, config, input, output, traceId })
```

| Feature | What it does |
|---------|-------------|
| **Seed Propagation** | Passes seed through the stack to OpenAI, Google, and Anthropic APIs |
| **Output Pinning** | Locks expected outputs — model update changes your classifier? CI catches it |
| **Determinism Assertions** | Run N times, verify all outputs match, fail in CI if they don't |
| **Provenance Tracking** | SHA-256 hashes every prompt/config/input/output — full lineage per traceId |
| **Request-Matched Fixtures** | Replay test fixtures by content hash, not sequence order |

---

## Everything Else

The three pillars are what make ElsiumAI unique. These are the fundamentals it also delivers:

- **Multi-provider gateway** — X-Ray mode, middleware, smart routing (fallback, cost-optimized, latency-racing, capability-aware)
- **Agents** — Memory, semantic guardrails, confidence scoring, state machines, multi-agent orchestration
- **RAG** — Document loading, chunking, embeddings, vector search
- **Workflows** — Retries, parallel execution, branching
- **MCP** — Bidirectional client/server bridge
- **Cost intelligence** — Budgets, projections, loop detection
- **Testing** — Mock providers, evals, LLM-as-judge, prompt versioning, regression suites

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                          @elsium-ai/app                           │
│                  HTTP server · RBAC · auth · routes               │
├────────────────────┬────────────────┬────────────────────────────┤
│  @elsium-ai/agents │ @elsium-ai/mcp │       @elsium-ai/cli       │
│  memory · approval │ client · server│      init · dev · eval     │
│  guardrails · multi│                │                            │
├──────────┬─────────┼────────┬───────┼───────────┬────────────────┤
│  gateway │  tools  │observe │  rag  │ workflows │                │
│ providers│ define  │ trace  │ load  │   steps   │                │
│   mesh   │ toolkit │ audit  │ chunk │  parallel │                │
│ security │         │ prove- │ embed │  branch   │                │
│ bulkhead │         │ nance  │vector │           │                │
├──────────┴─────────┴────────┴───────┴───────────┴────────────────┤
│                         @elsium-ai/core                           │
│    types · errors · stream · logger · config · retry · result    │
│    circuit breaker · dedup · policy engine · shutdown manager     │
└──────────────────────────────────────────────────────────────────┘
                          ·  ·  ·  ·  ·  ·
┌──────────────────────────────────────────────────────────────────┐
│                       @elsium-ai/testing                          │
│    mocks · evals · fixtures · pinning · determinism · snapshots  │
└──────────────────────────────────────────────────────────────────┘

Three Pillars — where each feature lives:

  Reliability             Governance              Determinism
  ───────────             ──────────              ───────────
  circuit breaker  [core] policy engine    [core] seed propagation [gw]
  request dedup    [core] RBAC             [app]  output pinning   [test]
  shutdown manager [core] approval gates   [agt]  determinism test [test]
  retry + backoff  [core] audit trail      [obs]  provenance       [obs]
  bulkhead         [gw]   PII detection    [gw]   req-match fixts  [test]
  provider mesh    [gw]   content classify [gw]   crypto hashing   [test]
```

## Packages

| Package | Description |
|---------|-------------|
| [`@elsium-ai/core`](./packages/core) | Types, errors, streaming, circuit breaker, dedup, policy engine, shutdown |
| [`@elsium-ai/gateway`](./packages/gateway) | Multi-provider gateway, X-Ray, provider mesh, bulkhead, PII detection |
| [`@elsium-ai/agents`](./packages/agents) | Agents, memory, guardrails, approval gates, multi-agent |
| [`@elsium-ai/tools`](./packages/tools) | Tool definitions with Zod validation |
| [`@elsium-ai/rag`](./packages/rag) | Document loading, chunking, embeddings, vector search |
| [`@elsium-ai/workflows`](./packages/workflows) | Sequential, parallel, and branching workflows |
| [`@elsium-ai/observe`](./packages/observe) | Tracing, cost intelligence, audit trail, provenance tracking |
| [`@elsium-ai/mcp`](./packages/mcp) | Bidirectional MCP client and server |
| [`@elsium-ai/app`](./packages/app) | HTTP server, CORS, auth, rate limiting, RBAC |
| [`@elsium-ai/testing`](./packages/testing) | Mocks, evals, pinning, determinism assertions, prompt versioning |
| [`@elsium-ai/cli`](./packages/cli) | Scaffolding, dev server, X-Ray inspection |

---

## Built-In Capabilities

Beyond agents, tools, RAG, and multi-provider routing, ElsiumAI ships production infrastructure out of the box:

| Category | Feature |
|----------|---------|
| **Reliability** | Circuit Breaker, Bulkhead Isolation, Request Dedup, Graceful Shutdown, Retry with Backoff |
| **Governance** | Policy Engine, RBAC, Approval Gates, Hash-Chained Audit, PII Detection |
| **Determinism** | Seed Propagation, Output Pinning, Determinism Assertions, Provenance Tracking |

---

## Performance

Measured with zero-latency mock provider to isolate framework cost. Full methodology and reproduction steps in [`benchmarks/`](./benchmarks/).

### Framework Cost (Isolated)

| Metric | P50 | P95 | Conditions |
|---|:---:|:---:|---|
| Core completion path | 2.3μs | 5.5μs | Agent, no middleware |
| Full governance stack | 6.2μs | 9.5μs | Security + audit + policy + cost + xray + logging |
| Under concurrency | 5.0μs | 6.4μs | 100 parallel requests, full stack |

### Real-World Context

| | |
|---|---|
| Typical LLM network latency | 200–800ms |
| ElsiumAI overhead at P95 | <10μs |
| Framework cost contribution | <0.01% of total request time |

### Resource Footprint

| Metric | Value |
|---|---|
| Cold start | <3ms |
| Bundle size (minified) | 77 KB |
| Memory per 10K requests | ~10 MB (full stack + tracing + audit, all in-memory, capped) |
| Per-request heap growth | ~1 KB |
| Circuit breaker throughput | >5M ops/sec |

Baselines are frozen per release and checked for regressions in CI. See [`benchmarks/results/`](./benchmarks/results/) for historical data.

---

## Principles

1. **Fail predictably** — handle failure before you see it
2. **Trust but verify** — every call auditable, every output traceable
3. **Reproducible by design** — testable AI is trustworthy AI
4. **Zero magic** — `createX(config)` everywhere, no hidden behavior
5. **Type safety end-to-end** — from config to LLM output
6. **Modular** — use what you need, tree-shake the rest

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and guidelines.

## Author

Created and maintained by **Eric Utrera** ([@ebutrera9103](https://github.com/ebutrera9103)).

## License

[MIT](./LICENSE) - Copyright (c) 2026 Eric Utrera
