# @elsium-ai/core

Core types, schemas, errors, and utilities for [ElsiumAI](https://github.com/elsium-ai/elsium-ai).

[![npm](https://img.shields.io/npm/v/@elsium-ai/core.svg)](https://www.npmjs.com/package/@elsium-ai/core)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE)

## Install

```bash
npm install @elsium-ai/core
```

## What's Inside

- **Types** — `CompletionRequest`, `LLMResponse`, `Message`, `Middleware`, and all shared interfaces
- **Circuit Breaker** — Detects failing providers, stops sending traffic, auto-recovers
- **Request Dedup** — Identical in-flight calls coalesce into one API request
- **Policy Engine** — Declarative rules to deny by model, cost, token count, or content pattern
- **Graceful Shutdown** — Drains in-flight operations before process exit
- **Retry with Backoff** — Exponential backoff with jitter
- **Logger** — Structured logging with levels and context
- **Config** — Type-safe environment variable access via `env()`

## Usage

```typescript
import {
  createCircuitBreaker,
  createPolicySet,
  modelAccessPolicy,
  costLimitPolicy,
  policyMiddleware,
  env,
} from '@elsium-ai/core'

// Circuit breaker
const cb = createCircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 30_000 })
const result = await cb.execute(() => fetchFromProvider())

// Policy engine
const policies = createPolicySet([
  modelAccessPolicy(['claude-sonnet-4-6', 'gpt-4o']),
  costLimitPolicy(5.00),
])
```

## Part of ElsiumAI

This package is the foundation layer of the [ElsiumAI](https://github.com/elsium-ai/elsium-ai) framework. See the [full documentation](https://github.com/elsium-ai/elsium-ai) for guides and examples.

## License

[MIT](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE)
