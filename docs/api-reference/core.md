# elsium-ai/core

Foundation module providing types, error handling, streaming, logging, configuration utilities, and common patterns used across the ElsiumAI framework.

```ts
import { ElsiumError, createLogger, ok, err, createStream } from '@elsium-ai/core'
```

---

## Types

Core types for messages, content, provider configuration, and middleware.

| Export | Description |
|---|---|
| `Role` | Message role: `'system'` \| `'user'` \| `'assistant'` \| `'tool'` |
| `TextContent` | Text content part with `type: 'text'` |
| `ImageContent` | Image content part with `type: 'image'` |
| `AudioContent` | Audio content part with `type: 'audio'` |
| `DocumentContent` | Document content part with `type: 'document'` |
| `ContentPart` | Union of all content part types |
| `ToolCall` | Tool invocation with `id`, `name`, and `arguments` |
| `ToolResult` | Tool execution result with `toolCallId` and `content` |
| `Message` | Chat message with `role`, `content`, and optional `toolCalls` / `toolResults` |
| `TokenUsage` | Token counts: `inputTokens`, `outputTokens`, `totalTokens` |
| `CostBreakdown` | Cost details: `inputCost`, `outputCost`, `totalCost`, `currency` |
| `StopReason` | Why generation stopped: `'end_turn'` \| `'max_tokens'` \| `'stop_sequence'` \| `'tool_use'` |
| `LLMResponse` | Complete response with `message`, `usage`, `cost`, `stopReason`, `model` |
| `StreamEvent` | Stream event types: `text_delta`, `tool_call_delta`, `message_end`, and others |
| `XRayData` | Detailed execution trace data attached to responses |
| `StreamCheckpoint` | Checkpoint data for stream recovery |
| `ProviderConfig` | Provider configuration: `apiKey`, `baseUrl`, `timeout`, `maxRetries` |
| `CompletionRequest` | Request object: `messages`, `model`, `temperature`, `maxTokens`, `tools`, `stream` |
| `ToolDefinition` | Tool schema: `name`, `description`, `inputSchema` (JSON Schema) |
| `TenantContext` | Multi-tenant context with `tenantId`, `tier`, `metadata` |
| `MiddlewareContext` | Context passed through middleware chain |
| `MiddlewareNext` | Next function signature for middleware |
| `Middleware` | Request middleware `(ctx, next) => Promise<LLMResponse>` |
| `StreamMiddleware` | Stream middleware type |
| `StreamMiddlewareNext` | Next function for stream middleware |

---

## Error Handling

### ElsiumError

Custom error class with structured error codes, retryability, and metadata.

```ts
import { ElsiumError } from '@elsium-ai/core'
```

**Error Codes:**

| Code | Description |
|---|---|
| `PROVIDER_ERROR` | Generic provider failure |
| `RATE_LIMIT` | Rate limit exceeded (429) |
| `AUTH_ERROR` | Authentication failure (401) |
| `INVALID_REQUEST` | Malformed request |
| `TIMEOUT` | Request timed out |
| `NETWORK_ERROR` | Network connectivity failure |
| `PARSE_ERROR` | Response parsing failure |
| `VALIDATION_ERROR` | Input validation failure |
| `TOOL_ERROR` | Tool execution failure |
| `BUDGET_EXCEEDED` | Cost budget exceeded |
| `MAX_ITERATIONS` | Agent iteration limit reached |
| `STREAM_ERROR` | Streaming failure |
| `CONFIG_ERROR` | Configuration error |
| `UNKNOWN` | Unclassified error |

**Factory Methods:**

```ts
// Provider error with metadata
ElsiumError.providerError('Model not found', {
  provider: 'anthropic',
  statusCode: 404,
  retryable: false,
  cause: originalError,
})

// Rate limit (retryable: true)
ElsiumError.rateLimit('openai', 5000) // retryAfterMs

// Auth error (retryable: false)
ElsiumError.authError('anthropic')

// Timeout (retryable: true)
ElsiumError.timeout('google', 30000)

// Validation error (retryable: false)
ElsiumError.validation('Temperature must be between 0 and 1', { field: 'temperature' })

// Budget exceeded (retryable: false)
ElsiumError.budgetExceeded(12.50, 10.00)
```

---

## Result Monad

Functional error handling for operations where exceptions are not appropriate.

| Export | Signature | Description |
|---|---|---|
| `ok` | `ok<T>(value: T): Result<T, never>` | Wrap a success value |
| `err` | `err<E>(error: E): Result<never, E>` | Wrap an error value |
| `isOk` | `isOk<T, E>(result: Result<T, E>): boolean` | Check if result is Ok |
| `isErr` | `isErr<T, E>(result: Result<T, E>): boolean` | Check if result is Err |
| `unwrap` | `unwrap<T>(result: Result<T, unknown>): T` | Extract value or throw |
| `unwrapOr` | `unwrapOr<T>(result: Result<T, unknown>, fallback: T): T` | Extract value or use fallback |
| `tryCatch` | `tryCatch<T>(fn: () => Promise<T>): Promise<Result<T, Error>>` | Wrap async function in Result |
| `tryCatchSync` | `tryCatchSync<T>(fn: () => T): Result<T, Error>` | Wrap sync function in Result |

```ts
import { ok, err, tryCatch, unwrapOr, isOk } from '@elsium-ai/core'

const result = await tryCatch(() => fetchData())

if (isOk(result)) {
  console.log(result.value)
}

const value = unwrapOr(result, defaultValue)
```

---

## Streaming

### ElsiumStream

Async iterable stream with checkpoint and recovery support.

### createStream

```ts
createStream(executor: (emit: (event: StreamEvent) => void) => Promise<void>): ElsiumStream
```

Creates a managed stream from a push-based executor. Supports iteration, checkpointing, and event handling. To wrap an existing async iterable, use `new ElsiumStream(source)`.

```ts
import { ElsiumStream } from '@elsium-ai/core'

const stream = new ElsiumStream(provider.stream(request))

for await (const event of stream) {
  if (event.type === 'text_delta') {
    process.stdout.write(event.text)
  }
}
```

---

## Logger

### createLogger

```ts
createLogger(options?: { level?: 'debug' | 'info' | 'warn' | 'error'; context?: Record<string, unknown> }): Logger
```

Creates a structured logger. All library code must use this instead of `console.*`.

```ts
import { createLogger } from '@elsium-ai/core'

const log = createLogger({ level: 'info' })

log.info('Request completed', { provider: 'anthropic', latencyMs: 142 })
log.error('Request failed', { error: err.message })

// Child loggers inherit and extend context
const reqLog = log.child({ traceId: 'abc-123' })
reqLog.info('Processing') // includes traceId in output
```

---

## Config

Typed environment variable access with fallback values.

| Export | Signature | Description |
|---|---|---|
| `env` | `env(key: string, fallback?: string): string` | Read string env var |
| `envNumber` | `envNumber(key: string, fallback?: number): number` | Read numeric env var |
| `envBool` | `envBool(key: string, fallback?: boolean): boolean` | Read boolean env var |

```ts
import { env, envNumber, envBool } from '@elsium-ai/core'

const apiKey = env('ANTHROPIC_API_KEY')
const timeout = envNumber('REQUEST_TIMEOUT_MS', 30000)
const debug = envBool('DEBUG', false)
```

---

## Utilities

| Export | Signature | Description |
|---|---|---|
| `generateId` | `generateId(): string` | Generate a unique identifier |
| `generateTraceId` | `generateTraceId(): string` | Generate a trace-compatible ID |
| `extractText` | `extractText(content: ContentPart[]): string` | Extract plain text from content parts |
| `sleep` | `sleep(ms: number): Promise<void>` | Promise-based delay |
| `retry` | `retry<T>(fn: () => Promise<T>, opts?: RetryOptions): Promise<T>` | Retry with exponential backoff and jitter |

```ts
import { retry, generateTraceId } from '@elsium-ai/core'

const traceId = generateTraceId()

const result = await retry(() => fetchWithTimeout(url), {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
})
```

---

## Schema

### zodToJsonSchema

```ts
zodToJsonSchema(schema: ZodType): JsonSchema
```

Converts a Zod schema to JSON Schema format, used for defining tool parameters.

```ts
import { zodToJsonSchema } from '@elsium-ai/core'
import { z } from 'zod'

const paramSchema = z.object({
  query: z.string().describe('Search query'),
  limit: z.number().optional().default(10),
})

const jsonSchema = zodToJsonSchema(paramSchema)
```

---

## Registry

### createRegistry

```ts
createRegistry<T>(name: string): Registry<T>
```

Creates a typed plugin registry for registering and retrieving named components.

```ts
import { createRegistry } from '@elsium-ai/core'

const providers = createRegistry<ProviderFactory>('providers')

providers.register('custom', myProviderFactory)
const factory = providers.get('custom')
const all = providers.list() // string[]
```

---

## Token Management

| Export | Signature | Description |
|---|---|---|
| `countTokens` | `countTokens(text: string): number` | Estimate token count for text |
| `createContextManager` | `createContextManager(config: ContextManagerConfig): ContextManager` | Manage context window budget |

```ts
import { countTokens, createContextManager } from '@elsium-ai/core'

const tokens = countTokens('Hello, world!')

const ctx = createContextManager({ maxTokens: 4096, strategy: 'truncate' })
const used = ctx.estimateTokens(messages)
const fitted = await ctx.fit(messages)
```

---

## Circuit Breaker

### createCircuitBreaker

```ts
createCircuitBreaker(config?: CircuitBreakerConfig): CircuitBreaker
```

Implements the circuit breaker pattern for fault tolerance.

```ts
import { createCircuitBreaker } from '@elsium-ai/core'

const breaker = createCircuitBreaker({
  failureThreshold: 5,
  resetTimeoutMs: 30000,
})

const result = await breaker.execute(() => callProvider())
```

---

## Dedup

Request deduplication to prevent duplicate concurrent requests.

| Export | Signature | Description |
|---|---|---|
| `createDedup` | `createDedup(): Dedup` | Create a deduplication instance |
| `dedupMiddleware` | `dedupMiddleware(config?: DedupConfig): Middleware` | Middleware that deduplicates identical in-flight requests |

```ts
import { dedupMiddleware } from '@elsium-ai/core'

const gw = gateway({
  middleware: [dedupMiddleware()],
})
```

---

## Policy

Policy-based access control for requests.

| Export | Signature | Description |
|---|---|---|
| `createPolicySet` | `createPolicySet(policies: PolicyConfig[]): PolicySet` | Create a policy set from policies |
| `policyMiddleware` | `policyMiddleware(policySet: PolicySet, opts?): Middleware` | Enforce policies as middleware |
| `modelAccessPolicy` | `modelAccessPolicy(models: string[]): PolicyConfig` | Restrict allowed models |
| `tokenLimitPolicy` | `tokenLimitPolicy(max: number): PolicyConfig` | Limit max tokens per request |
| `costLimitPolicy` | `costLimitPolicy(max: number): PolicyConfig` | Limit cost per request |
| `contentPolicy` | `contentPolicy(patterns: RegExp[]): PolicyConfig` | Block content matching patterns |

```ts
import { createPolicySet, policyMiddleware, modelAccessPolicy, tokenLimitPolicy } from '@elsium-ai/core'

const policies = createPolicySet([
  modelAccessPolicy(['claude-sonnet-4-20250514', 'gpt-4o']),
  tokenLimitPolicy(4096),
])

const gw = gateway({
  middleware: [policyMiddleware(policies)],
})
```

---

## Shutdown

### createShutdownManager

```ts
createShutdownManager(): ShutdownManager
```

Manages graceful shutdown by draining in-flight operations (installs SIGTERM/SIGINT handlers).

```ts
import { createShutdownManager } from '@elsium-ai/core'

const shutdown = createShutdownManager()

// Track in-flight work so shutdown can drain it before exiting
await shutdown.trackOperation(async () => {
  await handleRequest()
})

// Begin graceful drain (also triggered automatically on SIGTERM/SIGINT)
await shutdown.shutdown()
```
