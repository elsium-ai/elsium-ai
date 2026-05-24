# @elsium-ai/core

Core types, errors, result pattern, streaming, and infrastructure utilities for [ElsiumAI](https://github.com/elsium-ai/elsium-ai).

[![npm](https://img.shields.io/npm/v/@elsium-ai/core.svg)](https://www.npmjs.com/package/@elsium-ai/core)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE)

## Install

```bash
npm install @elsium-ai/core
```

## What's Inside

| Category | Exports |
|---|---|
| **Types** | `Role`, `TextContent`, `ImageContent`, `ContentPart`, `ToolCall`, `ToolResult`, `Message`, `TokenUsage`, `CostBreakdown`, `StopReason`, `LLMResponse`, `StreamEvent`, `StreamCheckpoint`, `XRayData`, `ProviderConfig`, `CompletionRequest`, `ToolDefinition`, `MiddlewareContext`, `MiddlewareNext`, `Middleware` |
| **Errors** | `ElsiumError`, `ErrorCode`, `ErrorDetails` |
| **Result** | `Result`, `Ok`, `Err`, `ok()`, `err()`, `isOk()`, `isErr()`, `unwrap()`, `unwrapOr()`, `tryCatch()`, `tryCatchSync()` |
| **Stream** | `ElsiumStream`, `createStream()`, `StreamTransformer`, `ResilientStreamOptions` |
| **Logger** | `createLogger()`, `Logger`, `LogLevel`, `LogEntry`, `LoggerOptions` |
| **Config** | `env()`, `envNumber()`, `envBool()` |
| **Utilities** | `generateId()`, `generateTraceId()`, `extractText()`, `sleep()`, `retry()` |
| **Circuit Breaker** | `createCircuitBreaker()`, `CircuitBreakerConfig`, `CircuitBreaker`, `CircuitState` |
| **Request Dedup** | `createDedup()`, `dedupMiddleware()`, `DedupConfig`, `Dedup` |
| **Policy Engine** | `createPolicySet()`, `policyMiddleware()`, `modelAccessPolicy()`, `tokenLimitPolicy()`, `costLimitPolicy()`, `contentPolicy()`, `PolicyDecision`, `PolicyResult`, `PolicyContext`, `PolicyRule`, `PolicyConfig`, `PolicySet` |
| **Shutdown** | `createShutdownManager()`, `ShutdownConfig`, `ShutdownManager` |
| **Crypto foundation** | `generateEd25519KeyPair()`, `createEd25519Signer()`, `createEd25519Verifier()`, `createKeyRegistry()`, `createInMemoryWriteOnceStore()`, `createFileWriteOnceStore()`, `Signature`, `VerifyResult`, `Signer`, `Verifier`, `KeyRegistry`, `WriteOnceStore` |
| **Capability tokens** | `createCapabilityIssuer()`, `createCapabilityVerifier()`, `canCallTool()`, `canCallLLM()`, `canQueryRag()`, `canUseMcp()`, `checkDataClass()`, `delegateToken()`, `createInMemoryRevocationStore()`, `CapabilityToken`, `AgentCapability`, `CapabilityCheckResult`, `RevocationStore` |

---

## Types

All type exports are interfaces and type aliases — no runtime cost.

### Role

```ts
type Role = 'system' | 'user' | 'assistant' | 'tool'
```

### TextContent

```ts
interface TextContent {
  type: 'text'
  text: string
}
```

### ImageContent

```ts
interface ImageContent {
  type: 'image'
  source:
    | { type: 'base64'; mediaType: string; data: string }
    | { type: 'url'; url: string }
}
```

### ContentPart

```ts
type ContentPart = TextContent | ImageContent
```

### ToolCall

```ts
interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}
```

### ToolResult

```ts
interface ToolResult {
  toolCallId: string
  content: string
  isError?: boolean
}
```

### Message

```ts
interface Message {
  role: Role
  content: string | ContentPart[]
  name?: string
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
  metadata?: Record<string, unknown>
}
```

### TokenUsage

```ts
interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}
```

### CostBreakdown

```ts
interface CostBreakdown {
  inputCost: number
  outputCost: number
  totalCost: number
  currency: 'USD'
}
```

### StopReason

```ts
type StopReason = 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use'
```

### LLMResponse

The unified response shape returned by all providers after a completion.

```ts
interface LLMResponse {
  id: string
  message: Message
  usage: TokenUsage
  cost: CostBreakdown
  model: string
  provider: string
  stopReason: StopReason
  latencyMs: number
  traceId: string
}
```

### StreamEvent

A discriminated union of all events emitted during streaming.

```ts
type StreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call_start'; toolCall: { id: string; name: string } }
  | { type: 'tool_call_delta'; toolCallId: string; arguments: string }
  | { type: 'tool_call_end'; toolCallId: string }
  | { type: 'message_start'; id: string; model: string }
  | { type: 'message_end'; usage: TokenUsage; stopReason: StopReason }
  | { type: 'error'; error: Error }
  | { type: 'checkpoint'; checkpoint: StreamCheckpoint }
  | { type: 'recovery'; partialText: string; error: Error }
```

### StreamCheckpoint

```ts
interface StreamCheckpoint {
  id: string
  timestamp: number
  text: string
  tokensSoFar: number
  eventIndex: number
}
```

### XRayData

Full request/response trace data for observability.

```ts
interface XRayData {
  traceId: string
  timestamp: number
  provider: string
  model: string
  latencyMs: number
  request: {
    url: string
    method: string
    headers: Record<string, string>
    body: Record<string, unknown>
  }
  response: {
    status: number
    headers: Record<string, string>
    body: Record<string, unknown>
  }
  usage: TokenUsage
  cost: CostBreakdown
}
```

### ProviderConfig

```ts
interface ProviderConfig {
  apiKey: string
  baseUrl?: string
  timeout?: number
  maxRetries?: number
}
```

### CompletionRequest

```ts
interface CompletionRequest {
  messages: Message[]
  model?: string
  system?: string
  maxTokens?: number
  temperature?: number
  seed?: number
  topP?: number
  stopSequences?: string[]
  tools?: ToolDefinition[]
  schema?: z.ZodType
  stream?: boolean
  metadata?: Record<string, unknown>
  signal?: AbortSignal
}
```

### ToolDefinition

```ts
interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}
```

### Middleware types

```ts
interface MiddlewareContext {
  request: CompletionRequest
  provider: string
  model: string
  traceId: string
  startTime: number
  metadata: Record<string, unknown>
}

type MiddlewareNext = (ctx: MiddlewareContext) => Promise<LLMResponse>

type Middleware = (ctx: MiddlewareContext, next: MiddlewareNext) => Promise<LLMResponse>
```

---

## Errors

### ErrorCode

```ts
type ErrorCode =
  | 'PROVIDER_ERROR'
  | 'RATE_LIMIT'
  | 'AUTH_ERROR'
  | 'INVALID_REQUEST'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'PARSE_ERROR'
  | 'VALIDATION_ERROR'
  | 'TOOL_ERROR'
  | 'BUDGET_EXCEEDED'
  | 'MAX_ITERATIONS'
  | 'STREAM_ERROR'
  | 'CONFIG_ERROR'
  | 'UNKNOWN'
```

### ErrorDetails

```ts
interface ErrorDetails {
  code: ErrorCode
  message: string
  provider?: string
  model?: string
  statusCode?: number
  retryable: boolean
  retryAfterMs?: number
  cause?: Error
  metadata?: Record<string, unknown>
}
```

### ElsiumError

Structured error class used throughout the framework. Extends `Error` with machine-readable fields for error handling, retries, and observability.

```ts
class ElsiumError extends Error {
  readonly code: ErrorCode
  readonly provider?: string
  readonly model?: string
  readonly statusCode?: number
  readonly retryable: boolean
  readonly retryAfterMs?: number
  readonly cause?: Error
  readonly metadata?: Record<string, unknown>

  constructor(details: ErrorDetails)
  toJSON(): Record<string, unknown>

  static providerError(message: string, opts: {
    provider: string
    statusCode?: number
    retryable?: boolean
    cause?: Error
  }): ElsiumError

  static rateLimit(provider: string, retryAfterMs?: number): ElsiumError
  static authError(provider: string): ElsiumError
  static timeout(provider: string, timeoutMs: number): ElsiumError
  static validation(message: string, metadata?: Record<string, unknown>): ElsiumError
  static budgetExceeded(spent: number, budget: number): ElsiumError
}
```

#### Static factory methods

**`ElsiumError.providerError(message, opts)`** — Generic provider failure.

| Parameter | Type | Description |
|---|---|---|
| `message` | `string` | Error description |
| `opts.provider` | `string` | Provider name |
| `opts.statusCode` | `number?` | HTTP status code |
| `opts.retryable` | `boolean?` | Whether to retry (default `false`) |
| `opts.cause` | `Error?` | Underlying error |

**`ElsiumError.rateLimit(provider, retryAfterMs?)`** — Rate limit (429). Always retryable.

**`ElsiumError.authError(provider)`** — Authentication failure (401). Not retryable.

**`ElsiumError.timeout(provider, timeoutMs)`** — Request timeout. Retryable.

**`ElsiumError.validation(message, metadata?)`** — Validation failure. Not retryable.

**`ElsiumError.budgetExceeded(spent, budget)`** — Token/cost budget exceeded. Not retryable.

```ts
import { ElsiumError } from '@elsium-ai/core'

try {
  await callProvider()
} catch (e) {
  if (e instanceof ElsiumError && e.retryable) {
    // safe to retry
  }
}

// Create specific errors
const err = ElsiumError.rateLimit('anthropic', 5000)
console.log(err.code)           // 'RATE_LIMIT'
console.log(err.retryAfterMs)   // 5000
```

---

## Result

A type-safe Result pattern for representing success/failure without exceptions.

### Types

```ts
type Result<T, E = Error> = Ok<T> | Err<E>

interface Ok<T> {
  readonly ok: true
  readonly value: T
}

interface Err<E> {
  readonly ok: false
  readonly error: E
}
```

### ok()

Wraps a value in a success result.

```ts
function ok<T>(value: T): Ok<T>
```

### err()

Wraps an error in a failure result.

```ts
function err<E>(error: E): Err<E>
```

### isOk()

Type guard that narrows a `Result` to `Ok`.

```ts
function isOk<T, E>(result: Result<T, E>): result is Ok<T>
```

### isErr()

Type guard that narrows a `Result` to `Err`.

```ts
function isErr<T, E>(result: Result<T, E>): result is Err<E>
```

### unwrap()

Extracts the value from an `Ok`, or throws the error from an `Err`.

```ts
function unwrap<T, E>(result: Result<T, E>): T
```

### unwrapOr()

Extracts the value from an `Ok`, or returns the fallback for an `Err`.

```ts
function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T
```

### tryCatch()

Wraps an async function in a `Result`. Caught errors are normalized to `Error`.

```ts
function tryCatch<T>(fn: () => Promise<T>): Promise<Result<T, Error>>
```

### tryCatchSync()

Synchronous version of `tryCatch`.

```ts
function tryCatchSync<T>(fn: () => T): Result<T, Error>
```

```ts
import { ok, err, isOk, unwrap, unwrapOr, tryCatch } from '@elsium-ai/core'

// Manual construction
const success = ok(42)
const failure = err(new Error('boom'))

if (isOk(success)) {
  console.log(success.value) // 42
}

// Safe unwrap with fallback
unwrapOr(failure, 0) // 0

// Wrap async operations
const result = await tryCatch(() => fetch('/api/data').then(r => r.json()))
if (isOk(result)) {
  console.log(result.value)
}
```

---

## Stream

### StreamTransformer

A function that transforms a stream of events into another stream of events.

```ts
type StreamTransformer = (
  source: AsyncIterable<StreamEvent>,
) => AsyncIterable<StreamEvent>
```

### ResilientStreamOptions

```ts
interface ResilientStreamOptions {
  checkpointIntervalMs?: number                          // default: 1000
  maxRetries?: number
  onCheckpoint?: (checkpoint: StreamCheckpoint) => void
  onPartialRecovery?: (text: string, error: Error) => void
}
```

### ElsiumStream

An `AsyncIterable<StreamEvent>` wrapper with convenience methods for consuming and transforming LLM streams. Supports only a single consumer — iterating twice throws.

```ts
class ElsiumStream implements AsyncIterable<StreamEvent> {
  constructor(source: AsyncIterable<StreamEvent>)
}
```

#### `stream.text()`

Returns an `AsyncIterable<string>` that yields only the text deltas.

```ts
text(): AsyncIterable<string>
```

#### `stream.toText()`

Collects all text deltas and returns the full text.

```ts
async toText(): Promise<string>
```

#### `stream.toTextWithTimeout(timeoutMs)`

Like `toText()` but stops collecting after `timeoutMs` milliseconds. Returns whatever text was collected before the deadline.

```ts
async toTextWithTimeout(timeoutMs: number): Promise<string>
```

#### `stream.toResponse()`

Collects the full text, token usage, and stop reason from the stream.

```ts
async toResponse(): Promise<{
  text: string
  usage: TokenUsage | null
  stopReason: StopReason | null
}>
```

#### `stream.pipe(transform)`

Creates a new `ElsiumStream` by piping events through a `StreamTransformer`.

```ts
pipe(transform: StreamTransformer): ElsiumStream
```

#### `stream.resilient(options?)`

Wraps the stream with checkpoint and partial-recovery support. Periodically emits `checkpoint` events and, on error, emits a `recovery` event containing whatever text was received before the failure.

```ts
resilient(options?: ResilientStreamOptions): ElsiumStream
```

### createStream()

Creates an `ElsiumStream` from an imperative callback. The `emit` function pushes events into a buffered async iterable (max 10,000 events).

```ts
function createStream(
  executor: (emit: (event: StreamEvent) => void) => Promise<void>,
): ElsiumStream
```

```ts
import { ElsiumStream, createStream } from '@elsium-ai/core'

// Create a stream from an imperative source
const stream = createStream(async (emit) => {
  emit({ type: 'message_start', id: 'msg_1', model: 'claude-sonnet-4-6' })
  emit({ type: 'text_delta', text: 'Hello ' })
  emit({ type: 'text_delta', text: 'world!' })
  emit({ type: 'message_end', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, stopReason: 'end_turn' })
})

// Consume as full text
const text = await stream.toText() // "Hello world!"

// Or iterate text deltas
for await (const chunk of stream.text()) {
  process.stdout.write(chunk)
}

// Add resilience with checkpoints
const resilient = stream.resilient({
  checkpointIntervalMs: 500,
  onCheckpoint: (cp) => console.log('checkpoint:', cp.text.length, 'chars'),
})

// Pipe through a transform
const filtered = stream.pipe(async function* (source) {
  for await (const event of source) {
    if (event.type !== 'checkpoint') yield event
  }
})
```

---

## Logger

### LogLevel

```ts
type LogLevel = 'debug' | 'info' | 'warn' | 'error'
```

### LogEntry

```ts
interface LogEntry {
  level: LogLevel
  message: string
  timestamp: string
  traceId?: string
  data?: Record<string, unknown>
}
```

### LoggerOptions

```ts
interface LoggerOptions {
  level?: LogLevel                    // default: 'info'
  pretty?: boolean                    // default: false (JSON single-line)
  context?: Record<string, unknown>   // merged into every entry
}
```

### Logger

```ts
interface Logger {
  debug(message: string, data?: Record<string, unknown>): void
  info(message: string, data?: Record<string, unknown>): void
  warn(message: string, data?: Record<string, unknown>): void
  error(message: string, data?: Record<string, unknown>): void
  child(context: Record<string, unknown>): Logger
}
```

### createLogger()

Creates a structured JSON logger. Messages below the configured level are silently dropped. `error` and `warn` go to `console.error`/`console.warn`; everything else goes to `console.log`.

```ts
function createLogger(options?: LoggerOptions): Logger
```

```ts
import { createLogger } from '@elsium-ai/core'

const logger = createLogger({ level: 'debug', pretty: true })
logger.info('server started', { port: 3000 })
// {"level":"info","message":"server started","timestamp":"...","data":{"port":3000}}

const child = logger.child({ traceId: 'trc_abc123' })
child.warn('slow response', { latencyMs: 4200 })
// includes traceId in every entry
```

---

## Config

Type-safe environment variable access. All three functions throw an `ElsiumError` with code `CONFIG_ERROR` when the variable is missing and no fallback is provided.

### env()

Returns a string environment variable, or the fallback, or throws.

```ts
function env(name: string, fallback?: string): string
```

### envNumber()

Parses the variable as a finite number. Throws if the value is not a valid finite number.

```ts
function envNumber(name: string, fallback?: number): number
```

### envBool()

Parses the variable as a boolean. `'true'`, `'1'`, and `'yes'` (case-insensitive) are truthy; everything else is falsy.

```ts
function envBool(name: string, fallback?: boolean): boolean
```

```ts
import { env, envNumber, envBool } from '@elsium-ai/core'

const apiKey = env('ANTHROPIC_API_KEY')               // throws if missing
const port = envNumber('PORT', 3000)                  // 3000 if unset
const debug = envBool('DEBUG', false)                 // false if unset
```

---

## Utilities

### generateId()

Generates a unique ID with an optional prefix, using timestamp + 4 random bytes.

```ts
function generateId(prefix?: string): string   // default prefix: 'els'
```

Returns a string like `els_m1abc2d_8f3e1a2b`.

### generateTraceId()

Generates a trace ID using timestamp + 6 random bytes. Always prefixed with `trc_`.

```ts
function generateTraceId(): string
```

Returns a string like `trc_m1abc2d_8f3e1a2b4c5d`.

### extractText()

Extracts plain text from a `Message.content` field, handling both the `string` and `ContentPart[]` forms.

```ts
function extractText(content: string | { type: string; text?: string }[]): string
```

### sleep()

Returns a promise that resolves after `ms` milliseconds.

```ts
function sleep(ms: number): Promise<void>
```

### retry()

Retries an async function with exponential backoff and jitter. Respects `retryAfterMs` on errors (e.g., `ElsiumError` rate limits).

```ts
function retry<T>(
  fn: () => Promise<T>,
  options?: {
    maxRetries?: number                         // default: 3
    baseDelayMs?: number                        // default: 1000
    maxDelayMs?: number                         // default: 30000
    shouldRetry?: (error: unknown) => boolean   // default: checks error.retryable
  },
): Promise<T>
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `fn` | `() => Promise<T>` | — | The async operation to retry |
| `options.maxRetries` | `number` | `3` | Maximum number of retry attempts |
| `options.baseDelayMs` | `number` | `1000` | Base delay for exponential backoff |
| `options.maxDelayMs` | `number` | `30000` | Maximum delay cap |
| `options.shouldRetry` | `(error: unknown) => boolean` | checks `error.retryable` | Predicate to decide whether to retry |

```ts
import { retry, generateId, generateTraceId, extractText, sleep } from '@elsium-ai/core'

const id = generateId()             // "els_m1abc2d_8f3e1a2b"
const traceId = generateTraceId()   // "trc_m1abc2d_8f3e1a2b4c5d"

// Extract text from either content format
extractText('hello')                             // "hello"
extractText([{ type: 'text', text: 'hello' }])  // "hello"

// Retry with defaults (3 retries, exponential backoff)
const data = await retry(() => fetchFromProvider(), {
  maxRetries: 5,
  shouldRetry: (err) => err instanceof Error,
})
```

---

## Circuit Breaker

Monitors failures within a sliding time window and stops sending traffic to a failing service. Automatically recovers via the half-open state.

### CircuitState

```ts
type CircuitState = 'closed' | 'open' | 'half-open'
```

State machine: **closed** (healthy) → **open** (tripping after threshold failures) → **half-open** (probing after reset timeout) → **closed** (on success) or back to **open** (on failure).

### CircuitBreakerConfig

```ts
interface CircuitBreakerConfig {
  failureThreshold?: number                                 // default: 5
  resetTimeoutMs?: number                                   // default: 30000
  halfOpenMaxAttempts?: number                               // default: 3
  windowMs?: number                                          // default: 60000
  onStateChange?: (from: CircuitState, to: CircuitState) => void
  shouldCount?: (error: unknown) => boolean                  // default: checks error.retryable, or true for unknown errors
}
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `failureThreshold` | `number` | `5` | Failures within `windowMs` before opening |
| `resetTimeoutMs` | `number` | `30000` | Time in open state before probing (half-open) |
| `halfOpenMaxAttempts` | `number` | `3` | Max concurrent probes in half-open state |
| `windowMs` | `number` | `60000` | Sliding window for counting failures |
| `onStateChange` | `(from, to) => void` | — | Callback on state transitions |
| `shouldCount` | `(error) => boolean` | checks `retryable` | Predicate to decide if an error counts as a failure |

### CircuitBreaker

```ts
interface CircuitBreaker {
  execute<T>(fn: () => Promise<T>): Promise<T>
  readonly state: CircuitState
  readonly failureCount: number
  reset(): void
}
```

| Member | Description |
|---|---|
| `execute(fn)` | Runs `fn` if the circuit is closed or half-open. Throws `ElsiumError` with code `PROVIDER_ERROR` if open. |
| `state` | Current state. Accessing this may trigger an open → half-open transition if `resetTimeoutMs` has elapsed. |
| `failureCount` | Number of failures within the current window. |
| `reset()` | Manually resets to the closed state and clears failure counts. |

### createCircuitBreaker()

```ts
function createCircuitBreaker(config?: CircuitBreakerConfig): CircuitBreaker
```

```ts
import { createCircuitBreaker } from '@elsium-ai/core'

const breaker = createCircuitBreaker({
  failureThreshold: 3,
  resetTimeoutMs: 10_000,
  onStateChange: (from, to) => console.log(`circuit: ${from} → ${to}`),
})

const result = await breaker.execute(() => callProvider())
console.log(breaker.state)         // 'closed'
console.log(breaker.failureCount)  // 0
```

---

## Request Dedup

Coalesces identical in-flight requests into a single execution and caches results for a short TTL.

### DedupConfig

```ts
interface DedupConfig {
  ttlMs?: number       // default: 5000
  maxEntries?: number  // default: 1000
}
```

### Dedup

```ts
interface Dedup<T> {
  deduplicate(key: string, fn: () => Promise<T>): Promise<T>
  hashRequest(request: unknown): string
  readonly size: number
  clear(): void
}
```

| Member | Description |
|---|---|
| `deduplicate(key, fn)` | Returns a cached result if within TTL, joins an in-flight request if one exists for `key`, or executes `fn`. |
| `hashRequest(request)` | Deterministic SHA-256 hash (first 16 hex chars) of a JSON-serializable object. Handles key ordering. |
| `size` | Number of cached + in-flight entries (expired entries are evicted on access). |
| `clear()` | Clears all cached and in-flight entries. |

### createDedup()

```ts
function createDedup<T>(config?: DedupConfig): Dedup<T>
```

### dedupMiddleware()

Returns a `Middleware` that deduplicates LLM requests based on their messages, model, provider, and key completion parameters.

```ts
function dedupMiddleware(config?: DedupConfig): Middleware
```

```ts
import { createDedup, dedupMiddleware } from '@elsium-ai/core'

// Standalone usage
const dedup = createDedup<string>({ ttlMs: 10_000 })
const key = dedup.hashRequest({ model: 'claude-sonnet-4-6', messages: [...] })
const result = await dedup.deduplicate(key, () => expensive())

// As middleware — identical concurrent requests share one API call
const middleware = dedupMiddleware({ ttlMs: 3000 })
```

---

## Policy Engine

Declarative rules to allow or deny LLM requests before they reach a provider.

### PolicyDecision

```ts
type PolicyDecision = 'allow' | 'deny'
```

### PolicyResult

```ts
interface PolicyResult {
  decision: PolicyDecision
  reason: string
  policyName: string
}
```

### PolicyContext

The evaluation context passed to every policy rule.

```ts
interface PolicyContext {
  model?: string
  provider?: string
  actor?: string
  role?: string
  tokenCount?: number
  costEstimate?: number
  requestContent?: string
  metadata?: Record<string, unknown>
}
```

### PolicyRule

```ts
type PolicyRule = (ctx: PolicyContext) => PolicyResult
```

### PolicyConfig

```ts
interface PolicyConfig {
  name: string
  description?: string
  rules: PolicyRule[]
  mode?: 'all-must-pass' | 'any-must-pass'   // default: 'all-must-pass'
}
```

### PolicySet

```ts
interface PolicySet {
  evaluate(ctx: PolicyContext): PolicyResult[]
  addPolicy(policy: PolicyConfig): void
  removePolicy(name: string): void
  readonly policies: string[]
}
```

| Member | Description |
|---|---|
| `evaluate(ctx)` | Runs all policy rules and returns an array of **denials only** (empty = all passed). |
| `addPolicy(policy)` | Adds a policy at runtime. |
| `removePolicy(name)` | Removes a policy by name. |
| `policies` | List of currently registered policy names. |

### createPolicySet()

```ts
function createPolicySet(policies: PolicyConfig[]): PolicySet
```

### policyMiddleware()

Returns a `Middleware` that evaluates all policies before forwarding the request. Throws `ElsiumError` with code `VALIDATION_ERROR` if any policy denies.

```ts
function policyMiddleware(policySet: PolicySet): Middleware
```

### Built-in policy factories

#### modelAccessPolicy()

Restricts requests to a list of allowed models. Supports glob-style trailing wildcards (e.g., `'claude-*'`).

```ts
function modelAccessPolicy(allowedModels: string[]): PolicyConfig
```

#### tokenLimitPolicy()

Denies requests whose estimated token count exceeds `maxTokens`.

```ts
function tokenLimitPolicy(maxTokens: number): PolicyConfig
```

#### costLimitPolicy()

Denies requests whose estimated cost exceeds `maxCost`.

```ts
function costLimitPolicy(maxCost: number): PolicyConfig
```

#### contentPolicy()

Denies requests whose content matches any of the provided regex patterns.

```ts
function contentPolicy(blockedPatterns: RegExp[]): PolicyConfig
```

```ts
import {
  createPolicySet,
  policyMiddleware,
  modelAccessPolicy,
  tokenLimitPolicy,
  costLimitPolicy,
  contentPolicy,
} from '@elsium-ai/core'

const policies = createPolicySet([
  modelAccessPolicy(['claude-sonnet-4-6', 'gpt-4o']),
  tokenLimitPolicy(100_000),
  costLimitPolicy(5.00),
  contentPolicy([/password/i, /secret_key/i]),
])

// Check manually
const denials = policies.evaluate({ model: 'unknown-model' })
// [{ decision: 'deny', reason: 'Model "unknown-model" is not in allowed list', policyName: 'model-access' }]

// Or use as middleware
const middleware = policyMiddleware(policies)
```

---

## Shutdown Manager

Tracks in-flight operations and drains them before process exit. Automatically registers signal handlers for `SIGTERM` and `SIGINT`.

### ShutdownConfig

```ts
interface ShutdownConfig {
  drainTimeoutMs?: number         // default: 30000
  signals?: string[]              // default: ['SIGTERM', 'SIGINT']
  onDrainStart?: () => void
  onDrainComplete?: () => void
  onForceShutdown?: () => void
}
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `drainTimeoutMs` | `number` | `30000` | Max time to wait for in-flight operations to finish |
| `signals` | `string[]` | `['SIGTERM', 'SIGINT']` | OS signals that trigger shutdown |
| `onDrainStart` | `() => void` | — | Called when drain begins |
| `onDrainComplete` | `() => void` | — | Called when all operations finish within timeout |
| `onForceShutdown` | `() => void` | — | Called when drain timeout expires |

### ShutdownManager

```ts
interface ShutdownManager {
  trackOperation<T>(fn: () => Promise<T>): Promise<T>
  shutdown(): Promise<void>
  dispose(): void
  readonly inFlight: number
  readonly isShuttingDown: boolean
}
```

| Member | Description |
|---|---|
| `trackOperation(fn)` | Executes `fn` while tracking it as in-flight. Throws `ElsiumError` with code `VALIDATION_ERROR` if already shutting down. |
| `shutdown()` | Initiates graceful shutdown. Waits for in-flight operations up to `drainTimeoutMs`. Idempotent — multiple calls return the same promise. |
| `dispose()` | Removes all registered signal handlers. Call this in tests to prevent leaks. |
| `inFlight` | Number of currently tracked operations. |
| `isShuttingDown` | `true` after `shutdown()` is called. |

### createShutdownManager()

```ts
function createShutdownManager(config?: ShutdownConfig): ShutdownManager
```

```ts
import { createShutdownManager } from '@elsium-ai/core'

const shutdown = createShutdownManager({
  drainTimeoutMs: 10_000,
  onDrainStart: () => console.log('draining...'),
  onDrainComplete: () => console.log('drained, exiting'),
  onForceShutdown: () => console.log('force shutdown!'),
})

// Wrap every request
const result = await shutdown.trackOperation(() => handleRequest())
console.log(shutdown.inFlight) // 0 after completion

// Cleanup in tests
shutdown.dispose()
```

---

## Crypto Foundation

Primitive cryptography for upstream packages that need signed audit trails, verifiable execution proofs, and tamper-evident storage. These primitives are deliberately low-level — they are the building blocks for ElsiumAI's verifiable agent execution and capability token systems.

### Ed25519 signing

```ts
import { generateEd25519KeyPair, createEd25519Signer, createEd25519Verifier, createKeyRegistry } from '@elsium-ai/core'

const pair = generateEd25519KeyPair()
// pair.privateKey: PKCS#8 PEM
// pair.publicKey:  SPKI PEM
// pair.fingerprint: SHA-256 hex of SPKI DER

const signer = createEd25519Signer({ privateKey: pair.privateKey, keyId: 'org-aperion-k7' })
const sig = signer.sign('payload to sign')
// sig.algorithm === 'Ed25519'
// sig.keyId === 'org-aperion-k7'
// sig.value: base64url

const registry = createKeyRegistry({
  trustRoots: [{ keyId: 'org-aperion-k7', publicKey: pair.publicKey, label: 'main signing key' }],
})

const verifier = createEd25519Verifier({ resolver: registry })
const result = verifier.verify('payload to sign', sig)
// result.valid === true
```

### Key registry with validity windows

```ts
import { createKeyRegistry } from '@elsium-ai/core'

const registry = createKeyRegistry()
registry.add('k1', publicKeyPem, {
  notBefore: Date.UTC(2026, 0, 1),
  notAfter: Date.UTC(2027, 0, 1),
  label: 'rotated-key-v1',
})

registry.isValid('k1')        // true if current time is within window
registry.resolve('k1')        // returns KeyObject only if valid right now
registry.list()               // all trusted keys with metadata
registry.remove('k1')         // revoke
```

Rejects prototype-pollution keyIds (`__proto__`, `constructor`, `prototype`), refuses re-adding the same `keyId`, and validates `notBefore < notAfter`.

### Write-once tamper-evident storage

```ts
import { createInMemoryWriteOnceStore, createFileWriteOnceStore } from '@elsium-ai/core'

const memStore = createInMemoryWriteOnceStore()
const fileStore = createFileWriteOnceStore({ dir: './proofs', fsync: true })

const receipt = await fileStore.put('proof/01HX9Y2/proof.json', JSON.stringify(proof))
// receipt.hash: sha-256 hex of payload
// receipt.size: bytes
// receipt.writtenAt: epoch ms

await fileStore.put('proof/01HX9Y2/proof.json', '...')  // throws WriteOnceConflictError

for await (const key of fileStore.list('proof/')) {
  // walks recursively, yields relative keys
}
```

File adapter uses `O_EXCL` (`flag: 'wx'`) for atomic write-once semantics on POSIX filesystems. Keys are validated against path traversal (`..`, absolute paths).

---

## Capability Tokens

OAuth-style scoped tokens for AI agents. An organization mints a signed token that declares exactly which tools, LLM providers, MCP servers, RAG stores, and data classes a specific agent run is allowed to touch. Every guarded execution point (`@elsium-ai/tools`' `withCapability` is the first; MCP / LLM / RAG guards land in β-2) verifies the token before doing work. Verification is offline and uses only the foundation `KeyRegistry`.

### Minting a token

```ts
import {
  generateEd25519KeyPair,
  createEd25519Signer,
  createCapabilityIssuer,
} from '@elsium-ai/core'

const pair = generateEd25519KeyPair()
const signer = createEd25519Signer({ privateKey: pair.privateKey, keyId: 'org-aperion-k7' })
const issuer = createCapabilityIssuer({ signer, orgId: 'aperion-gaming' })

const token = issuer.mint({
  subject: { agent: 'support-bot-v3', runId: 'run_xyz' },
  capabilities: [
    { kind: 'tool', name: 'customer.read', constraints: { allowedFields: ['name', 'email'] } },
    { kind: 'mcp',  server: 'github', tools: ['issues.list', 'prs.read'] },
    { kind: 'llm',  provider: 'anthropic', maxCost: 0.50, maxTokens: 50_000 },
    { kind: 'rag',  stores: ['kb-public'], maxResults: 10 },
  ],
  dataClasses: { allowed: ['public', 'internal'], denied: ['pii', 'financial'] },
  ttlMs: 60 * 60 * 1000,
})
```

### Verifying and checking scopes

```ts
import {
  createKeyRegistry,
  createCapabilityVerifier,
  canCallTool,
  canCallLLM,
} from '@elsium-ai/core'

const registry = createKeyRegistry({
  trustRoots: [{ keyId: 'org-aperion-k7', publicKey: ORG_PUBLIC_KEY_PEM }],
})

const verifier = createCapabilityVerifier({ resolver: registry })
const result = verifier.verifyToken(token)
// result.valid === true and signatureValid + withinValidityWindow are surfaced separately

const toolCheck = canCallTool(token, 'customer.read', {
  input: { name: 'Ana', email: 'a@x.com' },
  dataClasses: ['internal'],
})
// toolCheck.allowed === true; matchedCapability points at the granting entry

const llmCheck = canCallLLM(token, {
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  estimatedCost: 0.30,
})
// rejects with reason: 'budget-exceeded' if estimatedCost > maxCost
```

Refusals come back as a typed `CapabilityCheckResult` with a `reason` you can branch on (`no-matching-capability`, `denied-field`, `allowed-fields-violation`, `denied-data-class`, `budget-exceeded`, `expired`, `not-yet-valid`, `bad-signature`, `unknown-key`, `malformed`).

For tool execution, the wrapper lives in `@elsium-ai/tools`:

```ts
import { withCapability } from '@elsium-ai/tools'

const guarded = withCapability(myTool, {
  token,
  verifier,
  onDeny: (event) => audit.log('capability_denied', event),
})

await guarded.execute({ name: 'Ana' })
// Failures return ToolExecutionResult with success: false and error: "capability denied: <reason>"
```

### Delegation (parent → child)

A token holder can delegate a *strict subset* of its capabilities to a child token. Subset enforcement is checked at mint time: capabilities must be present on the parent, tool `deniedFields` must be inherited, LLM `maxCost`/`maxTokens` must be defined and ≤ parent, MCP tool allowlists must be subsets, budgets must shrink, denied data classes must propagate, and `expiresAt` cannot exceed the parent's.

```ts
const child = issuer.delegate(parent, {
  subject: { agent: 'support-bot:translator-sub' },
  capabilities: [
    { kind: 'llm', provider: 'anthropic', maxCost: 0.10 },  // ⊂ parent's 0.50
  ],
})
// child.subject.parentToken === parent.tokenId
```

### Revocation

Revocation uses a `RevocationStore` port — in-memory adapter ships; users can implement durable backends. Pass the store to the verifier and call `verifyTokenAsync` to consult it:

```ts
import { createInMemoryRevocationStore } from '@elsium-ai/core'

const revocationStore = createInMemoryRevocationStore()
const verifier = createCapabilityVerifier({ resolver: registry, revocationStore })

await revocationStore.revoke(token.tokenId, { reason: 'key compromised', revokedBy: 'admin' })
const result = await verifier.verifyTokenAsync(token)
// result.reason === 'revoked'
```

Revocation is **eventually consistent**: in-flight calls that already passed verification continue. There is no synchronous "kill" guarantee — document this in your runbook.

### Guards across the stack

| Surface | Wrapper | Package |
|---|---|---|
| Tools | `withCapability(tool, opts)` | `@elsium-ai/tools` |
| LLM calls | `capabilityMiddleware(opts)` (gateway `Middleware`) | `@elsium-ai/gateway` |
| MCP calls | `createCapabilityGuardedMCPClient(client, opts)` | `@elsium-ai/mcp` |
| RAG queries | `withRagCapability(pipeline, opts)` | `@elsium-ai/rag` |

Each wrapper accepts the same shape: `{ token, verifier?, onDeny? }`. Denials surface as typed events through `onDeny` (for audit) and either throw `ElsiumError` (LLM/MCP/RAG) or return a typed `ToolExecutionResult { success: false }` (tools) — depending on what the host API expects.

---

## Part of ElsiumAI

This package is the foundation layer of the [ElsiumAI](https://github.com/elsium-ai/elsium-ai) framework. See the [full documentation](https://github.com/elsium-ai/elsium-ai) for guides and examples.

## License

[MIT](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE)
