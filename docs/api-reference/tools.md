# elsium-ai/tools

Tool definition module for building type-safe, schema-validated tools that agents can call. Provides Zod-validated input/output contracts, execution timeouts, side-effect governance (preconditions, dry-run, approval, idempotency), capability gating, and a set of ready-to-use built-in tools.

```ts
import { defineTool, createToolkit, formatToolResult } from '@elsium-ai/tools'
```

---

## Tool Definition

| Export | Signature | Description |
|---|---|---|
| `defineTool` | `defineTool<TInput, TOutput>(config: ToolConfig): Tool` | Define a schema-validated tool |

### defineTool

Creates a `Tool` from a config. The config requires an input schema (`input` or its alias `parameters`) and either an inline `handler` or a `sandbox` config — otherwise `defineTool` throws a validation error. When an `output` schema is supplied, the handler's return value is validated before being returned. The default `timeoutMs` is `30_000`.

```ts
import { defineTool } from '@elsium-ai/tools'
import { z } from 'zod'

const getWeather = defineTool({
  name: 'get_weather',
  description: 'Get the current weather for a city',
  input: z.object({ city: z.string() }),
  output: z.object({ tempC: z.number(), conditions: z.string() }),
  timeoutMs: 10_000,
  handler: async (input, ctx) => {
    const res = await fetch(`https://api.example.com/weather?q=${input.city}`, {
      signal: ctx.signal,
    })
    return res.json()
  },
})

const result = await getWeather.execute({ city: 'Madrid' })
// => { success: true, data: { tempC: 22, conditions: 'Sunny' }, toolCallId: 'tc_...', durationMs: 142 }
```

Calling `execute` validates the raw input against the schema. Invalid input resolves to a failure result (`{ success: false, error: 'Invalid input: ...' }`) rather than throwing. A timeout or abort produces a failure result as well.

---

## Toolkit

| Export | Signature | Description |
|---|---|---|
| `createToolkit` | `createToolkit(name: string, tools: Tool[]): Toolkit` | Group tools into a named, name-indexed collection |

Bundles multiple tools so they can be looked up and executed by name, and exported as `ToolDefinition[]` for an LLM. Duplicate tool names within a toolkit throw a `CONFIG_ERROR`.

```ts
import { createToolkit, calculatorTool, currentTimeTool } from '@elsium-ai/tools'

const toolkit = createToolkit('assistant', [calculatorTool, currentTimeTool])

const tool = toolkit.getTool('calculator')          // Tool | undefined
const result = await toolkit.execute('calculator', { expression: '2 + 2 * 3' })
const definitions = toolkit.toDefinitions()          // pass to an LLM as available tools
```

Executing an unknown tool name resolves to a failure result listing the available tools rather than throwing.

---

## Built-in Tools

Ready-to-use `Tool` instances. Each can be added to a toolkit or executed directly.

| Export | Name | Input | Output |
|---|---|---|---|
| `httpFetchTool` | `http_fetch` | `{ url: string, headers?: Record<string, string> }` | `{ status: number, body: string, contentType: string }` |
| `calculatorTool` | `calculator` | `{ expression: string }` | `{ result: number }` |
| `jsonParseTool` | `json_parse` | `{ json: string, path?: string }` | `{ value: unknown }` |
| `currentTimeTool` | `current_time` | `{ timezone?: string }` | `{ iso: string, unix: number, timezone: string }` |

```ts
import { httpFetchTool, calculatorTool, jsonParseTool, currentTimeTool } from '@elsium-ai/tools'

await calculatorTool.execute({ expression: 'sqrt(144) + 2 ** 3' })
// => { success: true, data: { result: 20 }, ... }

await jsonParseTool.execute({ json: '{"data":{"items":[{"name":"a"}]}}', path: 'data.items.0.name' })
// => { success: true, data: { value: 'a' }, ... }

await currentTimeTool.execute({ timezone: 'America/New_York' })
```

`httpFetchTool` is hardened: it blocks non-HTTP(S) protocols and requests to private/internal networks (loopback, RFC 1918, link-local), strips sensitive headers (`cookie`, `authorization`, `x-api-key`, etc.), validates redirect `Location` headers before following, and truncates bodies over 50,000 characters. `calculatorTool` evaluates expressions with a safe tokenizing parser (no `eval`) supporting arithmetic, `**`, `%`, and `Math` functions/constants. `jsonParseTool` strips prototype-pollution keys (`__proto__`, `constructor`, `prototype`) while parsing.

---

## Retrieval Tool

| Export | Signature | Description |
|---|---|---|
| `createRetrievalTool` | `createRetrievalTool(config: RetrievalToolConfig): Tool` | Build a knowledge-base search tool from a retrieve function |

Wraps a `RetrieveFn` into a tool with a `{ query: string }` input. The default name is `search_knowledge` and the default `topK` is `5`. Results are rendered to a string via `formatResult` (a numbered, scored list by default).

```ts
import { createRetrievalTool } from '@elsium-ai/tools'

const searchDocs = createRetrievalTool({
  name: 'search_docs',
  topK: 3,
  retrieve: async (query, options) => {
    return vectorStore.search(query, { topK: options?.topK })
    // => RetrievalResult[]: { content, score, source?, metadata? }
  },
})
```

---

## Formatting

| Export | Signature | Description |
|---|---|---|
| `formatToolResult` | `formatToolResult(result: ToolExecutionResult): ToolResult` | Convert a result into a `@elsium-ai/core` `ToolResult` |
| `formatToolResultAsText` | `formatToolResultAsText(result: ToolExecutionResult): string` | Convert a result into a plain string |

Both serialize the result for feeding back into an LLM. Successful string data is passed through verbatim; other data is `JSON.stringify`'d. Failures become an error message (`formatToolResult` sets `isError: true`).

```ts
import { formatToolResult, formatToolResultAsText } from '@elsium-ai/tools'

const result = await calculatorTool.execute({ expression: '6 * 7' })
formatToolResult(result)       // => { toolCallId: 'tc_...', content: '{\n  "result": 42\n}' }
formatToolResultAsText(result) // => '{\n  "result": 42\n}'
```

---

## Capability Guard

| Export | Signature | Description |
|---|---|---|
| `withCapability` | `withCapability<TInput, TOutput>(tool: Tool, options: CapabilityGuardOptions): Tool` | Wrap a tool so execution is gated on a `CapabilityToken` |

Opt-in wrapper that checks a `@elsium-ai/core` `CapabilityToken` before delegating to the inner tool. If a `verifier` is provided, the token is verified first; then `canCallTool` checks the token's scope against the tool name (and optional `dataClasses`). A denied call resolves to a failure result (`error: 'capability denied: ...'`) and invokes the optional `onDeny` callback. The wrapper preserves the inner tool's metadata, `toDefinition`, and `dispose`.

```ts
import { withCapability } from '@elsium-ai/tools'

const guarded = withCapability(httpFetchTool, {
  token,                       // CapabilityToken
  verifier,                    // optional CapabilityVerifier
  dataClasses: ['public'],     // optional DataClass[]
  onDeny: (event) => log.warn('denied', event),
})

await guarded.execute({ url: 'https://example.com' })
```

---

## Tool Contracts

Side-effect governance for tools that mutate state. Declared on the `ToolConfig` and enforced by `execute` in this order: preconditions → approval → dry-run → idempotency → handler.

### sideEffectLevel

`'read' | 'write' | 'destructive'` — classifies the tool's impact. It drives default behavior for dry-run (skips the handler for non-`read` tools) and approval (`'destructive'` requires approval under the default `'auto'` policy).

### preconditions

An array of guard functions (or `{ name, check }` objects) that must all pass before the handler runs. Each returns `{ ok: boolean, reason? }`. Any failure resolves to a failure result carrying `preconditionFailures`.

```ts
defineTool({
  name: 'transfer_funds',
  description: 'Transfer money between accounts',
  input: z.object({ from: z.string(), to: z.string(), amount: z.number() }),
  sideEffectLevel: 'write',
  preconditions: [
    { name: 'positive_amount', check: (input) => ({ ok: input.amount > 0, reason: 'amount must be positive' }) },
  ],
  handler: async (input) => transfer(input),
})
```

### dryRunHandler & dry run

Passing `{ dryRun: true }` in the execution context triggers a dry run for tools whose `sideEffectLevel` is not `'read'` (or any tool with no level set). The `dryRunHandler` produces a preview; the result is returned with `dryRun: true` and the real handler is never invoked.

```ts
const result = await transferFunds.execute(input, { dryRun: true })
// => { success: true, dryRun: true, data: <preview>, ... }
```

### requireApproval

`'auto' | 'always' | 'never'` (default `'auto'`). When approval is needed, `execute` calls `context.requestApproval` (an `ApprovalHandler`) with an `ApprovalRequest`. A non-`approved` decision resolves to a failure result with `approvalDenied: true`. Under `'auto'`, only `'destructive'` tools require approval; `'always'` forces it; `'never'` disables it. If approval is required but no handler is wired, the call proceeds with a warning.

```ts
defineTool({
  name: 'delete_account',
  description: 'Permanently delete a user account',
  input: z.object({ userId: z.string() }),
  sideEffectLevel: 'destructive',
  requireApproval: 'always',
  handler: async (input) => deleteAccount(input.userId),
})

await deleteAccount.execute({ userId: 'u_1' }, {
  requestApproval: async (req) => ({ status: 'approved', decidedBy: 'admin' }),
})
```

### Idempotency

Supplying both `idempotencyKey` (derives a key from input) and `idempotencyStore` makes repeated calls return the cached output instead of re-running the handler. On a cache hit the result carries `idempotent: true`. `createInMemoryIdempotencyStore` provides a built-in store.

| Export | Signature | Description |
|---|---|---|
| `createInMemoryIdempotencyStore` | `createInMemoryIdempotencyStore(config?: InMemoryIdempotencyStoreConfig): IdempotencyStore` | In-memory idempotency store (`clock?` injectable) |

```ts
import { defineTool, createInMemoryIdempotencyStore } from '@elsium-ai/tools'

const store = createInMemoryIdempotencyStore()

const charge = defineTool({
  name: 'charge_card',
  description: 'Charge a payment card',
  input: z.object({ orderId: z.string(), amount: z.number() }),
  sideEffectLevel: 'write',
  idempotencyKey: (input) => input.orderId,
  idempotencyStore: store,
  handler: async (input) => paymentApi.charge(input),
})

await charge.execute({ orderId: 'o_1', amount: 50 }) // runs handler, persists output
await charge.execute({ orderId: 'o_1', amount: 50 }) // cache hit => { idempotent: true }
```

---

## Sandbox

Instead of an inline `handler`, a tool can run its logic in an isolated worker or subprocess via the `sandbox` config. This provides crash, memory, and capability isolation for untrusted or risky code.

```ts
defineTool({
  name: 'render_markdown',
  description: 'Render markdown to HTML in an isolated worker',
  input: z.object({ markdown: z.string() }),
  sandbox: {
    mode: 'worker',                  // 'worker' | 'process'
    handler: new URL('./render-worker.js', import.meta.url),
    capabilities: ['fs:read'],       // network, fs:read, fs:write, subprocess, ...
    timeoutMs: 5_000,
  },
})
```

> Note: under Bun, `sandbox.mode: 'worker'` has incomplete crash isolation (`process.exit()` inside the handler does not terminate the worker). Use `mode: 'process'` for full parity. Call `tool.dispose()` to tear down sandbox resources.

---

## Tool Interface

```ts
interface Tool<TInput = unknown, TOutput = unknown> {
  readonly name: string
  readonly description: string
  readonly inputSchema: z.ZodType<TInput>
  readonly outputSchema?: z.ZodType<TOutput>
  readonly timeoutMs: number
  readonly sandbox?: SandboxConfig
  readonly sideEffectLevel?: SideEffectLevel
  execute(input: unknown, context?: Partial<ToolContext>): Promise<ToolExecutionResult<TOutput>>
  toDefinition(): ToolDefinition
  dispose?(): Promise<void>
}
```

### ToolExecutionResult

```ts
interface ToolExecutionResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
  toolCallId: string
  durationMs: number
  dryRun?: boolean                          // set when a dry run was performed
  idempotent?: boolean                      // set when output came from the idempotency store
  preconditionFailures?: PreconditionFailure[]
  approvalDenied?: boolean
  approvalReason?: string
}
```

---

## Types

| Export | Description |
|---|---|
| `ToolConfig` | Tool definition: `name`, `description`, `input`/`parameters` (Zod), `output?` (Zod), `handler?`, `timeoutMs?`, `sandbox?`, `sideEffectLevel?`, `idempotencyKey?`, `idempotencyStore?`, `preconditions?`, `dryRunHandler?`, `requireApproval?` |
| `Tool` | Built tool instance: metadata + `execute`, `toDefinition`, `dispose?` |
| `ToolContext` | Context passed to handlers: `toolCallId`, `traceId?`, `signal?`, `dryRun?`, `requestApproval?` |
| `ToolExecutionResult` | Execution outcome: `success`, `data?`, `error?`, `toolCallId`, `durationMs`, plus governance flags |
| `Toolkit` | Tool collection: `name`, `tools`, `getTool`, `execute`, `toDefinitions` |
| `SideEffectLevel` | `'read'` \| `'write'` \| `'destructive'` |
| `RequireApproval` | `'auto'` \| `'always'` \| `'never'` |
| `ApprovalRequest` | Approval input: `toolName`, `toolCallId`, `traceId?`, `sideEffectLevel?`, `input`, `reason?` |
| `ApprovalDecision` | Approval outcome: `status` (`'approved'` \| `'rejected'`), `reason?`, `decidedBy?` |
| `ApprovalHandler` | `(request: ApprovalRequest) => Promise<ApprovalDecision> \| ApprovalDecision` |
| `PreconditionFn` | `(input, ctx) => PreconditionResult \| Promise<PreconditionResult>` |
| `PreconditionResult` | `{ ok: boolean, reason? }` |
| `PreconditionFailure` | `{ name: string, reason: string }` |
| `IdempotencyStore` | Store interface: `get`, `put`, `delete` |
| `IdempotencyEntry` | Stored record: `key`, `toolName`, `output`, `recordedAt` |
| `InMemoryIdempotencyStoreConfig` | In-memory store config: `clock?` |
| `CapabilityGuardOptions` | `withCapability` options: `token`, `verifier?`, `dataClasses?`, `onDeny?` |
| `CapabilityDenialEvent` | Denial event: `toolName`, `tokenId`, `subject`, `reason`, `detail?` |
| `RetrievalToolConfig` | Retrieval tool config: `name?`, `description?`, `retrieve`, `topK?`, `formatResult?` |
| `RetrievalResult` | Retrieval hit: `content`, `score`, `source?`, `metadata?` |
| `RetrieveFn` | `(query: string, options?: { topK?: number }) => Promise<RetrievalResult[]>` |
| `Capability` | Sandbox capability: `'network'` \| `'fs:read'` \| `'fs:write'` \| `'subprocess'` \| scoped variants |
| `SandboxConfig` | Sandbox config: `mode` (`'worker'` \| `'process'`), `handler`, `timeoutMs?`, `capabilities?`, `env?` |
| `SandboxRunner` | Runner interface: `invoke`, `dispose` |
