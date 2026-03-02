# @elsium-ai/tools

Tool definition, execution, and formatting for [ElsiumAI](https://github.com/elsium-ai/elsium-ai).

[![npm](https://img.shields.io/npm/v/@elsium-ai/tools.svg)](https://www.npmjs.com/package/@elsium-ai/tools)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE)

## Install

```bash
npm install @elsium-ai/tools @elsium-ai/core
```

`zod` is a required peer dependency:

```bash
npm install zod
```

## What's Inside

| Category | Exports | Description |
| --- | --- | --- |
| **Define** | `defineTool`, `ToolConfig`, `ToolContext`, `Tool`, `ToolExecutionResult` | Create type-safe tools with Zod schema validation, automatic input/output parsing, timeout handling, and abort support |
| **Toolkit** | `createToolkit`, `Toolkit` | Group related tools into named collections with lookup-by-name execution and batch definition export |
| **Format** | `formatToolResult`, `formatToolResultAsText` | Convert raw execution results into the `ToolResult` wire format or plain-text strings for logging |
| **Built-in Tools** | `httpFetchTool`, `calculatorTool`, `jsonParseTool`, `currentTimeTool` | Ready-to-use tools for HTTP requests, math evaluation, JSON extraction, and current time |

---

## Define

The core module for creating tools. Every tool is built from a `ToolConfig` passed to `defineTool`, which returns a fully-formed `Tool` object with validation, execution, and schema export capabilities.

### `ToolConfig<TInput, TOutput>`

Configuration object passed to `defineTool`.

```typescript
interface ToolConfig<TInput = unknown, TOutput = unknown> {
  name: string
  description: string
  input: z.ZodType<TInput>
  output?: z.ZodType<TOutput>
  handler: (input: TInput, context: ToolContext) => Promise<TOutput>
  timeoutMs?: number
}
```

| Field | Type | Description |
| --- | --- | --- |
| `name` | `string` | Unique identifier for the tool (used in LLM tool-call routing) |
| `description` | `string` | Human-readable description sent to the model |
| `input` | `z.ZodType<TInput>` | Zod schema used to validate and parse incoming input |
| `output` | `z.ZodType<TOutput>` (optional) | Zod schema used to validate handler output; omit to skip output validation |
| `handler` | `(input: TInput, context: ToolContext) => Promise<TOutput>` | Async function that performs the tool's work |
| `timeoutMs` | `number` (optional) | Maximum execution time in milliseconds. Defaults to `30000` |

### `ToolContext`

Contextual metadata passed to every handler invocation.

```typescript
interface ToolContext {
  toolCallId: string
  traceId?: string
  signal?: AbortSignal
}
```

| Field | Type | Description |
| --- | --- | --- |
| `toolCallId` | `string` | Unique identifier for this specific tool call |
| `traceId` | `string` (optional) | Distributed-tracing identifier for observability |
| `signal` | `AbortSignal` (optional) | Abort signal for cancellation; auto-generated from `timeoutMs` if not provided |

### `Tool<TInput, TOutput>`

The object returned by `defineTool`. Exposes read-only metadata, an `execute` method, and a `toDefinition` method for LLM integration.

```typescript
interface Tool<TInput = unknown, TOutput = unknown> {
  readonly name: string
  readonly description: string
  readonly inputSchema: z.ZodType<TInput>
  readonly outputSchema?: z.ZodType<TOutput>
  readonly rawSchema?: Record<string, unknown>
  readonly timeoutMs: number

  execute(
    input: unknown,
    context?: Partial<ToolContext>,
  ): Promise<ToolExecutionResult<TOutput>>

  toDefinition(): ToolDefinition
}
```

| Member | Description |
| --- | --- |
| `name` | The tool name from the config |
| `description` | The tool description from the config |
| `inputSchema` | The Zod schema used for input validation |
| `outputSchema` | The Zod schema used for output validation (if provided) |
| `rawSchema` | Optional pre-computed JSON Schema object |
| `timeoutMs` | Effective timeout in milliseconds |
| `execute(input, context?)` | Validate input, run the handler, validate output, and return a `ToolExecutionResult` |
| `toDefinition()` | Convert the tool to a `ToolDefinition` (JSON Schema) for sending to an LLM |

### `ToolExecutionResult<T>`

The structured result returned by `Tool.execute`.

```typescript
interface ToolExecutionResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
  toolCallId: string
  durationMs: number
}
```

| Field | Type | Description |
| --- | --- | --- |
| `success` | `boolean` | `true` if the handler completed without errors and output validated |
| `data` | `T` (optional) | The handler return value, present when `success` is `true` |
| `error` | `string` (optional) | Error message, present when `success` is `false` |
| `toolCallId` | `string` | Identifier for the tool call that produced this result |
| `durationMs` | `number` | Wall-clock execution time in milliseconds |

### `defineTool(config)`

Create a validated, executable tool from a configuration object.

```typescript
function defineTool<TInput, TOutput>(
  config: ToolConfig<TInput, TOutput>,
): Tool<TInput, TOutput>
```

The returned `Tool` will:
1. Parse and validate all input against `config.input` before calling the handler.
2. Enforce a timeout (default 30 s) via `AbortController`.
3. Optionally validate handler output against `config.output`.
4. Return a `ToolExecutionResult` that always includes `success`, `toolCallId`, and `durationMs` -- never throws.

**Example**

```typescript
import { defineTool } from '@elsium-ai/tools'
import { z } from 'zod'

const weatherTool = defineTool({
  name: 'get_weather',
  description: 'Get current weather for a city',
  input: z.object({
    city: z.string().describe('City name'),
    units: z.enum(['celsius', 'fahrenheit']).optional(),
  }),
  output: z.object({
    temperature: z.number(),
    condition: z.string(),
  }),
  timeoutMs: 10_000,
  handler: async ({ city, units }, context) => {
    // context.signal is available for fetch cancellation
    const data = await fetchWeatherAPI(city, { signal: context.signal })
    return { temperature: data.temp, condition: data.summary }
  },
})

// Execute the tool
const result = await weatherTool.execute({ city: 'London' })
// { success: true, data: { temperature: 18, condition: 'cloudy' }, toolCallId: 'tc_...', durationMs: 240 }

// Export JSON Schema definition for an LLM
const definition = weatherTool.toDefinition()
// { name: 'get_weather', description: '...', inputSchema: { type: 'object', ... } }
```

---

## Toolkit

Group multiple tools into a named collection for organized lookup and batch execution.

### `Toolkit`

The object returned by `createToolkit`.

```typescript
interface Toolkit {
  readonly name: string
  readonly tools: ReadonlyArray<Tool>

  getTool(name: string): Tool | undefined
  execute(
    toolName: string,
    input: unknown,
    context?: Partial<ToolContext>,
  ): Promise<ToolExecutionResult>
  toDefinitions(): ToolDefinition[]
}
```

| Member | Description |
| --- | --- |
| `name` | The toolkit name |
| `tools` | Read-only array of all tools in the toolkit |
| `getTool(name)` | Look up a tool by name; returns `undefined` if not found |
| `execute(toolName, input, context?)` | Find the named tool and execute it; returns an error result if the tool does not exist |
| `toDefinitions()` | Export all tools as `ToolDefinition[]` for sending to an LLM |

### `createToolkit(name, tools)`

Create a named toolkit from an array of tools.

```typescript
function createToolkit(name: string, tools: Tool[]): Toolkit
```

| Parameter | Type | Description |
| --- | --- | --- |
| `name` | `string` | A descriptive name for the toolkit |
| `tools` | `Tool[]` | Array of tools to include |

**Returns** a `Toolkit` with O(1) tool lookup by name.

**Example**

```typescript
import { defineTool, createToolkit } from '@elsium-ai/tools'
import { z } from 'zod'

const addTool = defineTool({
  name: 'add',
  description: 'Add two numbers',
  input: z.object({ a: z.number(), b: z.number() }),
  handler: async ({ a, b }) => ({ sum: a + b }),
})

const multiplyTool = defineTool({
  name: 'multiply',
  description: 'Multiply two numbers',
  input: z.object({ a: z.number(), b: z.number() }),
  handler: async ({ a, b }) => ({ product: a * b }),
})

const mathKit = createToolkit('math', [addTool, multiplyTool])

// Look up a tool
const tool = mathKit.getTool('add')

// Execute by name
const result = await mathKit.execute('multiply', { a: 6, b: 7 })
// { success: true, data: { product: 42 }, toolCallId: 'tc_...', durationMs: 1 }

// Export all definitions for an LLM
const definitions = mathKit.toDefinitions()
```

---

## Format

Utilities for converting `ToolExecutionResult` into formats suitable for LLM message construction or plain-text logging.

### `formatToolResult(result)`

Convert a `ToolExecutionResult` into the `ToolResult` wire format expected by `@elsium-ai/core` message types.

```typescript
function formatToolResult(result: ToolExecutionResult): ToolResult
```

| Parameter | Type | Description |
| --- | --- | --- |
| `result` | `ToolExecutionResult` | The raw execution result from `Tool.execute` |

**Returns** a `ToolResult`:

```typescript
// from @elsium-ai/core
interface ToolResult {
  toolCallId: string
  content: string
  isError?: boolean
}
```

On success, `content` is the stringified `data` (or the raw string if `data` is already a string). On failure, `content` is prefixed with `"Error: "` and `isError` is `true`.

**Example**

```typescript
import { defineTool, formatToolResult } from '@elsium-ai/tools'
import { z } from 'zod'

const tool = defineTool({
  name: 'greet',
  description: 'Return a greeting',
  input: z.object({ name: z.string() }),
  handler: async ({ name }) => ({ message: `Hello, ${name}!` }),
})

const result = await tool.execute({ name: 'World' })
const toolResult = formatToolResult(result)
// {
//   toolCallId: 'tc_...',
//   content: '{\n  "message": "Hello, World!"\n}'
// }
```

### `formatToolResultAsText(result)`

Convert a `ToolExecutionResult` into a plain-text string, useful for logging or display.

```typescript
function formatToolResultAsText(result: ToolExecutionResult): string
```

| Parameter | Type | Description |
| --- | --- | --- |
| `result` | `ToolExecutionResult` | The raw execution result from `Tool.execute` |

**Returns** the stringified `data` on success, or a string prefixed with `"[Tool Error] "` on failure.

**Example**

```typescript
import { defineTool, formatToolResultAsText } from '@elsium-ai/tools'
import { z } from 'zod'

const tool = defineTool({
  name: 'divide',
  description: 'Divide two numbers',
  input: z.object({ a: z.number(), b: z.number() }),
  handler: async ({ a, b }) => {
    if (b === 0) throw new Error('Division by zero')
    return { quotient: a / b }
  },
})

const ok = await tool.execute({ a: 10, b: 3 })
console.log(formatToolResultAsText(ok))
// '{\n  "quotient": 3.3333333333333335\n}'

const err = await tool.execute({ a: 10, b: 0 })
console.log(formatToolResultAsText(err))
// '[Tool Error] Division by zero'
```

---

## Built-in Tools

Ready-to-use tool instances for common operations. Each is a `Tool` created with `defineTool` and can be used directly or added to a toolkit.

### `httpFetchTool`

Fetch content from a URL via HTTP GET. Blocks requests to private/internal network addresses (localhost, RFC 1918 ranges, link-local). Responses larger than 50 KB are truncated.

| Property | Value |
| --- | --- |
| **Name** | `http_fetch` |
| **Timeout** | 15 000 ms |

**Input schema**

```typescript
z.object({
  url: z.string().url(),        // The URL to fetch
  headers: z.record(z.string()) // Optional HTTP headers
    .optional(),
})
```

**Output schema**

```typescript
z.object({
  status: z.number(),       // HTTP status code
  body: z.string(),         // Response body (truncated at 50 KB)
  contentType: z.string(),  // Content-Type header value
})
```

**Example**

```typescript
import { httpFetchTool } from '@elsium-ai/tools'

const result = await httpFetchTool.execute({
  url: 'https://api.example.com/data',
  headers: { Authorization: 'Bearer token' },
})

if (result.success) {
  console.log(result.data.status)      // 200
  console.log(result.data.contentType) // 'application/json'
}
```

### `calculatorTool`

Evaluate a mathematical expression safely using a custom tokenizer and recursive-descent parser -- no `eval()`. Supports arithmetic operators (`+`, `-`, `*`, `/`, `**`, `%`), Math functions (`sqrt`, `abs`, `round`, `floor`, `ceil`, `sin`, `cos`, `tan`, `log`, `log2`, `log10`, `exp`, `pow`, `min`, `max`), and constants (`PI`, `E`).

| Property | Value |
| --- | --- |
| **Name** | `calculator` |
| **Timeout** | 30 000 ms (default) |

**Input schema**

```typescript
z.object({
  expression: z.string(), // The mathematical expression to evaluate
})
```

**Output schema**

```typescript
z.object({
  result: z.number(), // The computed result
})
```

**Example**

```typescript
import { calculatorTool } from '@elsium-ai/tools'

const result = await calculatorTool.execute({
  expression: 'sqrt(144) + 2 ** 3',
})

if (result.success) {
  console.log(result.data.result) // 20
}
```

### `jsonParseTool`

Parse a JSON string and optionally extract a value at a dot-separated path. Prototype-pollution keys (`__proto__`, `constructor`, `prototype`) are stripped during parsing.

| Property | Value |
| --- | --- |
| **Name** | `json_parse` |
| **Timeout** | 30 000 ms (default) |

**Input schema**

```typescript
z.object({
  json: z.string(),          // The JSON string to parse
  path: z.string().optional() // Dot-separated path (e.g. "data.items.0.name")
})
```

**Output schema**

```typescript
z.object({
  value: z.unknown(), // The extracted value (or the entire parsed object if no path)
})
```

**Example**

```typescript
import { jsonParseTool } from '@elsium-ai/tools'

const result = await jsonParseTool.execute({
  json: '{"users":[{"name":"Alice"},{"name":"Bob"}]}',
  path: 'users.1.name',
})

if (result.success) {
  console.log(result.data.value) // 'Bob'
}
```

### `currentTimeTool`

Get the current date and time. Optionally specify an IANA timezone; defaults to UTC.

| Property | Value |
| --- | --- |
| **Name** | `current_time` |
| **Timeout** | 30 000 ms (default) |

**Input schema**

```typescript
z.object({
  timezone: z.string().optional(), // IANA timezone (e.g. "America/New_York")
})
```

**Output schema**

```typescript
z.object({
  iso: z.string(),      // Locale-formatted date/time string
  unix: z.number(),     // Unix timestamp in seconds
  timezone: z.string(), // The resolved timezone
})
```

**Example**

```typescript
import { currentTimeTool } from '@elsium-ai/tools'

const result = await currentTimeTool.execute({ timezone: 'Europe/London' })

if (result.success) {
  console.log(result.data.iso)      // '3/2/2026, 10:30:00 AM'
  console.log(result.data.unix)     // 1772540400
  console.log(result.data.timezone) // 'Europe/London'
}
```

---

## Part of ElsiumAI

This package is the tools layer of the [ElsiumAI](https://github.com/elsium-ai/elsium-ai) framework. See the [full documentation](https://github.com/elsium-ai/elsium-ai) for guides and examples.

## License

[MIT](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE)
