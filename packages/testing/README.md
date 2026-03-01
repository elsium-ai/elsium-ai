# @elsium-ai/testing

Testing utilities, mock providers, fixtures, and eval framework for [ElsiumAI](https://github.com/elsium-ai/elsium-ai).

[![npm](https://img.shields.io/npm/v/@elsium-ai/testing.svg)](https://www.npmjs.com/package/@elsium-ai/testing)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE)

## Install

```bash
npm install @elsium-ai/testing --save-dev
```

## What's Inside

- **Mock Providers** — Zero-latency providers for unit testing
- **Evals** — LLM-as-judge evaluation framework
- **Output Pinning** — Lock expected outputs, catch regressions when models update
- **Determinism Assertions** — Run N times, verify all outputs match
- **Prompt Versioning** — Track and compare prompt versions
- **Request-Matched Fixtures** — Replay fixtures by content hash, not sequence order
- **Regression Suites** — Automated regression detection in CI

## Usage

```typescript
import { assertDeterministic, createMockProvider, pinOutput } from '@elsium-ai/testing'

// Determinism check
const result = await assertDeterministic(
  (seed) => llm.complete({
    messages: [{ role: 'user', content: 'Classify: spam' }],
    temperature: 0,
    seed,
  }).then(r => r.message.content),
  { runs: 5, seed: 42, tolerance: 0 },
)
// { deterministic: true, variance: 0, uniqueOutputs: 1 }

// Mock provider for tests
const mock = createMockProvider({
  responses: [{ content: 'Mocked response' }],
})
```

## Part of ElsiumAI

This package is the testing layer of the [ElsiumAI](https://github.com/elsium-ai/elsium-ai) framework. See the [full documentation](https://github.com/elsium-ai/elsium-ai) for guides and examples.

## License

[MIT](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE)
