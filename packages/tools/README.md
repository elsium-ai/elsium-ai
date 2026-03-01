# @elsium-ai/tools

Tool definition and execution for [ElsiumAI](https://github.com/elsium-ai/elsium-ai).

[![npm](https://img.shields.io/npm/v/@elsium-ai/tools.svg)](https://www.npmjs.com/package/@elsium-ai/tools)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE)

## Install

```bash
npm install @elsium-ai/tools @elsium-ai/core
```

## What's Inside

- **Tool Definition** — Type-safe tool creation with Zod schema validation
- **Toolkit** — Group related tools into reusable collections
- **Execution** — Automatic parameter validation and error handling

## Usage

```typescript
import { defineTool, createToolkit } from '@elsium-ai/tools'
import { z } from 'zod'

const weatherTool = defineTool({
  name: 'get_weather',
  description: 'Get current weather for a location',
  parameters: z.object({
    city: z.string().describe('City name'),
  }),
  execute: async ({ city }) => {
    return { temperature: 72, condition: 'sunny', city }
  },
})

const toolkit = createToolkit([weatherTool])
```

## Part of ElsiumAI

This package is the tools layer of the [ElsiumAI](https://github.com/elsium-ai/elsium-ai) framework. See the [full documentation](https://github.com/elsium-ai/elsium-ai) for guides and examples.

## License

[MIT](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE)
