# @elsium-ai/workflows

Multi-step workflow pipelines and DAG execution for [ElsiumAI](https://github.com/elsium-ai/elsium-ai).

[![npm](https://img.shields.io/npm/v/@elsium-ai/workflows.svg)](https://www.npmjs.com/package/@elsium-ai/workflows)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE)

## Install

```bash
npm install @elsium-ai/workflows @elsium-ai/core
```

## What's Inside

- **Sequential Steps** — Chain operations with automatic data passing
- **Parallel Execution** — Run independent steps concurrently
- **Branching** — Conditional workflow paths based on runtime results
- **Retries** — Per-step retry policies with backoff

## Usage

```typescript
import { defineWorkflow, step } from '@elsium-ai/workflows'

const pipeline = defineWorkflow('analyze', [
  step('fetch', async (input) => {
    return await fetchData(input.url)
  }),
  step('process', async (data) => {
    return await processData(data)
  }),
  step('summarize', async (processed) => {
    return await llm.complete({
      messages: [{ role: 'user', content: `Summarize: ${processed}` }],
    })
  }),
])

const result = await pipeline.run({ url: 'https://example.com' })
```

## Part of ElsiumAI

This package is the workflow layer of the [ElsiumAI](https://github.com/elsium-ai/elsium-ai) framework. See the [full documentation](https://github.com/elsium-ai/elsium-ai) for guides and examples.

## License

[MIT](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE)
