# @elsium-ai/gateway

Multi-provider LLM gateway for [ElsiumAI](https://github.com/elsium-ai/elsium-ai).

[![npm](https://img.shields.io/npm/v/@elsium-ai/gateway.svg)](https://www.npmjs.com/package/@elsium-ai/gateway)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE)

## Install

```bash
npm install @elsium-ai/gateway @elsium-ai/core
```

## What's Inside

- **Multi-provider support** — Anthropic, OpenAI, Google out of the box
- **Provider Mesh** — Fallback, cost-optimized, latency-racing, and capability-aware routing
- **Middleware** — Composable logging, cost tracking, security, and X-Ray inspection
- **Bulkhead Isolation** — Bounds concurrency so one slow consumer can't starve others
- **Security** — Prompt injection detection, jailbreak detection, PII/secret redaction
- **X-Ray Mode** — Deep request/response inspection for debugging

## Usage

```typescript
import { gateway, createProviderMesh } from '@elsium-ai/gateway'
import { env } from '@elsium-ai/core'

// Single provider
const llm = gateway({
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  apiKey: env('ANTHROPIC_API_KEY'),
})

const response = await llm.complete({
  messages: [{ role: 'user', content: 'Hello!' }],
})

// Multi-provider with fallback
const mesh = createProviderMesh({
  providers: [
    { name: 'anthropic', config: { apiKey: env('ANTHROPIC_API_KEY') } },
    { name: 'openai', config: { apiKey: env('OPENAI_API_KEY') } },
  ],
  strategy: 'fallback',
  circuitBreaker: { failureThreshold: 5, resetTimeoutMs: 30_000 },
})
```

## Part of ElsiumAI

This package is the gateway layer of the [ElsiumAI](https://github.com/elsium-ai/elsium-ai) framework. See the [full documentation](https://github.com/elsium-ai/elsium-ai) for guides and examples.

## License

[MIT](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE)
