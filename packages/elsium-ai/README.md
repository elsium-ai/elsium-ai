<p align="center">
  <a href="https://github.com/elsium-ai/elsium-ai" target="blank"><img src="https://raw.githubusercontent.com/elsium-ai/elsium-ai/main/assets/logo.png" width="320" alt="ElsiumAI Logo" /></a>
</p>
<h3 align="center">Reliability. Governance. Reproducible AI.</h3>
<p align="center">The TypeScript framework for AI systems you can trust in production.</p>
<p align="center">
  <a href="https://github.com/elsium-ai/elsium-ai/actions"><img src="https://github.com/elsium-ai/elsium-ai/workflows/CI/badge.svg" alt="CI"></a>
  <a href="https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  <a href="https://www.npmjs.com/package/elsium-ai"><img src="https://img.shields.io/npm/v/elsium-ai.svg" alt="npm"></a>
</p>

---

> **AI systems must fail predictably.**
> **AI systems must be auditable.**
> **AI systems must be reproducible.**
> **AI systems must be governed by policy, not hope.**

---

## Install

```bash
npm install elsium-ai
# or
bun add elsium-ai
```

This umbrella package re-exports all ElsiumAI modules. You can also install individual packages for smaller bundles.

## Quick Start

```typescript
import { gateway } from 'elsium-ai'
import { defineAgent } from 'elsium-ai'
import { env } from 'elsium-ai'

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

## Three Pillars

| Pillar | The guarantee |
|--------|--------------|
| **Reliability** | Your system stays up when providers break — circuit breakers, bulkhead isolation, request dedup, graceful shutdown |
| **Governance** | You control who does what, and you can prove it — policy engine, RBAC, approval gates, hash-chained audit trail |
| **Reproducible AI** | Tools to measure, pin, and reproduce AI outputs — seed propagation, output pinning, provenance tracking, determinism assertions |

## Packages

| Package | Description |
|---------|-------------|
| [`@elsium-ai/core`](https://www.npmjs.com/package/@elsium-ai/core) | Types, errors, streaming, circuit breaker, dedup, policy engine, shutdown |
| [`@elsium-ai/gateway`](https://www.npmjs.com/package/@elsium-ai/gateway) | Multi-provider gateway, X-Ray, provider mesh, bulkhead, PII detection |
| [`@elsium-ai/agents`](https://www.npmjs.com/package/@elsium-ai/agents) | Agents, memory, guardrails, approval gates, multi-agent |
| [`@elsium-ai/tools`](https://www.npmjs.com/package/@elsium-ai/tools) | Tool definitions with Zod validation |
| [`@elsium-ai/rag`](https://www.npmjs.com/package/@elsium-ai/rag) | Document loading, chunking, embeddings, vector search |
| [`@elsium-ai/workflows`](https://www.npmjs.com/package/@elsium-ai/workflows) | Sequential, parallel, and branching workflows |
| [`@elsium-ai/observe`](https://www.npmjs.com/package/@elsium-ai/observe) | Tracing, cost intelligence, audit trail, provenance tracking |
| [`@elsium-ai/mcp`](https://www.npmjs.com/package/@elsium-ai/mcp) | Bidirectional MCP client and server |
| [`@elsium-ai/app`](https://www.npmjs.com/package/@elsium-ai/app) | HTTP server, CORS, auth, rate limiting, RBAC |
| [`@elsium-ai/testing`](https://www.npmjs.com/package/@elsium-ai/testing) | Mocks, evals, pinning, determinism assertions, prompt versioning |
| [`@elsium-ai/cli`](https://www.npmjs.com/package/@elsium-ai/cli) | Scaffolding, dev server, X-Ray inspection |

## Performance

Measured with zero-latency mock provider to isolate framework cost.

| Metric | P50 | P95 | Conditions |
|---|:---:|:---:|---|
| Core completion path | 2.3us | 5.5us | Agent, no middleware |
| Full governance stack | 6.2us | 9.5us | Security + audit + policy + cost + xray + logging |
| Under concurrency | 5.0us | 6.4us | 100 parallel requests, full stack |

Framework cost contribution: <0.01% of total request time.

## Documentation

Full documentation, architecture diagrams, and examples at [github.com/elsium-ai/elsium-ai](https://github.com/elsium-ai/elsium-ai).

## License

[MIT](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE) - Copyright (c) 2026 Eric Utrera
