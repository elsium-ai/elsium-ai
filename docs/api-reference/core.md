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

### withToolTypes

```ts
withToolTypes<T extends ToolSchemaMap>(
  source: AsyncIterable<StreamEvent>,
  schemas: T,
): AsyncIterable<TypedStreamEvent<T>>
```

Wraps a raw `StreamEvent` stream and, as each tool call finishes, emits an extra synthesized `tool_call_complete` event with parsed, schema-validated arguments. Pass-through: every original event is still yielded first; the completion event follows. `schemas` is a `ToolSchemaMap` (`Record<string, ZodType>`) keyed by tool name — only listed tools get narrowed types.

When the buffered arguments parse and validate against the tool's Zod schema, a `TypedToolCallComplete<T>` is emitted whose `toolCall.name` / `toolCall.arguments` are narrowed per tool (`ToolArgs<T, K>`). On JSON-parse or validation failure, an `UnknownToolCallComplete` is emitted instead, carrying the raw string and a `parseError: { reason, raw }`. Any tool calls still pending when the source ends are flushed at the end.

| Type | Description |
|---|---|
| `ToolSchemaMap` | `Record<string, ZodType<unknown>>` mapping tool name to argument schema |
| `ToolArgs<T, K>` | Inferred argument type for tool `K` from its schema |
| `TypedToolCallComplete<T>` | Completion event with narrowed `toolCall` per tool name |
| `UnknownToolCallComplete` | Completion event for unparseable/invalid args, with `parseError` |
| `TypedStreamEvent<T>` | Union of `StreamEvent`, `TypedToolCallComplete<T>`, `UnknownToolCallComplete` |

```ts
import { withToolTypes } from '@elsium-ai/core'
import { z } from 'zod'

const schemas = {
  search: z.object({ query: z.string(), limit: z.number().optional() }),
}

for await (const event of withToolTypes(provider.stream(request), schemas)) {
  if (event.type === 'tool_call_complete' && event.toolCall.name === 'search') {
    // event.toolCall.arguments is typed as { query: string; limit?: number }
    if ('parseError' in event) console.warn(event.parseError.reason)
    else await runSearch(event.toolCall.arguments)
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

## Declarative Policy

Data-driven authorization using YAML/JSON-style `PolicyDocument`s evaluated by a built-in engine. This is the recommended path going forward; the closure-based `createPolicySet` above is kept during v0.x.

### createDeclarativePolicySet

```ts
createDeclarativePolicySet(config: DeclarativePolicySetConfig): DeclarativePolicySet
```

Builds a policy set from a `PolicyBundle`. Validates the bundle at construction — by default throws on `error`-level verification issues (set `strict: false` for warnings-only). Deny policies are evaluated before allow policies; within each pass, higher `spec.priority` documents win. If nothing matches, the bundle's `defaultEffect` applies.

| Type | Description |
|---|---|
| `DeclarativePolicySetConfig` | `{ bundle: PolicyBundle; evaluator?: PolicyEvaluator; strict?: boolean }` |
| `DeclarativePolicySet` | `{ evaluate(req); load(bundle); exportBundle(); verify(bundle?); evaluatorName }` |
| `PolicyBundle` | `{ apiVersion; documents: PolicyDocument[]; defaultEffect: 'allow' \| 'deny' }` |
| `PolicyDocument` | A single `{ apiVersion; kind: 'Policy'; metadata; spec }` rule |
| `PolicySpec` | `effect`, `subjects?`, `actions`, `resources?`, `when?`, `priority?` |
| `AuthorizationRequest` | `{ principal; action; resource?; context? }` |
| `EvaluationResult` | `{ decision: 'allow' \| 'deny'; reason; matchedPolicy? }` |
| `ConditionExpression` | One of 8 ops: `eq`, `ne`, `gt`, `lt`, `gte`, `lte`, `in`, `matches` |
| `MatchPattern` | Exact `string`, `{ in: string[] }`, or `{ regex: string }` |
| `VerificationIssue` | `{ document; severity: 'error' \| 'warning'; issue }` |

```ts
import { createDeclarativePolicySet } from '@elsium-ai/core'

const policies = createDeclarativePolicySet({
  bundle: {
    apiVersion: 'elsium.policy/v1',
    defaultEffect: 'deny',
    documents: [
      {
        apiVersion: 'elsium.policy/v1',
        kind: 'Policy',
        metadata: { name: 'allow-analysts-cheap-models' },
        spec: {
          effect: 'allow',
          subjects: [{ type: 'role', match: 'analyst' }],
          actions: [{ type: 'model:use' }],
          resources: [{ kind: 'model', id: { in: ['gpt-4o-mini', 'claude-haiku'] } }],
        },
      },
    ],
  },
})

const result = policies.evaluate({
  principal: { type: 'role', id: 'analyst' },
  action: { type: 'model:use' },
  resource: { kind: 'model', id: 'gpt-4o-mini' },
})
// { decision: 'allow', reason: '...', matchedPolicy: 'allow-analysts-cheap-models' }
```

Related exports: `createBuiltinEvaluator()` (default `PolicyEvaluator`), `evaluateCondition(expr, ctx)` (reuse the 8-operator semantics), `verifyBundle(bundle)` (standalone validation), and `declarativePolicyMiddleware(config)` (gateway-side enforcement deriving an `AuthorizationRequest` from `MiddlewareContext`).

---

## State Store

Durable key/value store for opaque agent snapshots — used by the agent runtime to pause and resume mid-execution (e.g. while waiting for human approval).

### createInMemoryStateStore

```ts
createInMemoryStateStore<TSnapshot = unknown>(
  config?: InMemoryStateStoreConfig,
): StateStore<TSnapshot>
```

In-memory `StateStore` adapter. Evicts oldest entries past `maxEntries` (default 10,000). The framework ships only this adapter; production users implement the `StateStore` interface over Redis/Postgres/SQLite/S3.

| Type | Description |
|---|---|
| `StateStore<TSnapshot>` | `save(key, snapshot)`, `load(key)`, `delete(key)`, optional `list(prefix?)` |
| `InMemoryStateStoreConfig` | `{ maxEntries?: number }` (default 10,000) |

```ts
import { createInMemoryStateStore } from '@elsium-ai/core'

const store = createInMemoryStateStore<MySnapshot>({ maxEntries: 1000 })
await store.save('run-123', snapshot)
const resumed = await store.load('run-123')
```

---

## Trace & Replay

Deterministic record-and-replay of agent step execution — used by the agent runtime and `@elsium-ai/testing`. A recorder captures each step's input/output; `replayFrom` re-runs a trace from a chosen point, replaying earlier steps verbatim and executing later ones live (with optional overrides).

### createTraceRecorder

```ts
createTraceRecorder(config?: TraceRecorderConfig): TraceRecorder
```

Creates a recorder. Call `recordStep({ key, input, output, ... })` per step, then `finish()` to get an immutable `AgentTrace`.

| Type | Description |
|---|---|
| `TraceRecorderConfig` | `{ agentId?; traceId?; clock?: () => number }` |
| `TraceRecorder` | `recordStep(...)`, `finish()`, `traceId`, `steps` |
| `TraceStep<TIn, TOut>` | `{ key; input; output; startedAt; durationMs; metadata? }` |
| `AgentTrace` | `{ id; agentId?; startedAt; endedAt?; steps: TraceStep[] }` |

### replayFrom

```ts
replayFrom<TInput, TOutput>(
  trace: AgentTrace,
  options: ReplayFromOptions<TInput, TOutput>,
): Promise<ReplayResult<TInput, TOutput>>
```

Replays `trace`. Steps before `fromStep` (a numeric index or step `key`) are returned verbatim (`source: 'replay'`); steps from that point on are run through `options.executor` (`source: 'live'`). Per-step `overrides` can `replace` an output or `transform` its input/output.

| Type | Description |
|---|---|
| `ReplayFromOptions<TIn, TOut>` | `{ fromStep: number \| string; executor: StepExecutor; overrides? }` |
| `StepExecutor<TIn, TOut>` | `({ key, input, originalStep }) => TOut \| Promise<TOut>` |
| `StepOverride<TIn, TOut>` | `{ kind: 'replace'; output }` or `{ kind: 'transform'; input?; output? }` |
| `ReplayedStep<TIn, TOut>` | `TraceStep` plus `source: 'replay' \| 'live'` and `overridden: boolean` |
| `ReplayResult<TIn, TOut>` | `{ traceId; steps: ReplayedStep[]; finalOutput }` |

```ts
import { createTraceRecorder, replayFrom } from '@elsium-ai/core'

const rec = createTraceRecorder({ agentId: 'support-bot' })
rec.recordStep({ key: 'fetch', input: { id: 1 }, output: { name: 'Ada' } })
rec.recordStep({ key: 'summarize', input: { name: 'Ada' }, output: 'Hi Ada' })
const trace = rec.finish()

const result = await replayFrom(trace, {
  fromStep: 'summarize',
  executor: ({ key, input }) => runStep(key, input),
  overrides: { fetch: { kind: 'replace', output: { name: 'Grace' } } },
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

---

## Crypto

Runtime primitives for governance code: Ed25519 signing/verification, a trusted-key registry, and tamper-evident write-once storage. Built on Node's `node:crypto`.

### generateEd25519KeyPair

```ts
generateEd25519KeyPair(): Ed25519KeyPair
```

Generates a fresh Ed25519 key pair. Returns PEM strings plus the public-key `fingerprint`.

| Type | Description |
|---|---|
| `Ed25519KeyPair` | `{ privateKey: string; publicKey: string; fingerprint: string }` (PEM + SHA-256 hex) |

### createEd25519Signer

```ts
createEd25519Signer(opts: {
  privateKey: string | Uint8Array | KeyObject
  keyId: string
}): Signer
```

Creates a signer from a PKCS#8 private key. `sign(payload)` returns a `Signature` with base64url value. Throws `CONFIG_ERROR` for non-Ed25519 keys or an empty `keyId`.

| Type | Description |
|---|---|
| `Signer` | `{ keyId; algorithm: 'Ed25519'; fingerprint; sign(payload) => Signature }` |
| `Signature` | `{ algorithm: 'Ed25519'; keyId: string; value: string }` |

### createEd25519Verifier

```ts
createEd25519Verifier(opts: { resolver: PublicKeyResolver }): Verifier
```

Creates a verifier that resolves public keys by `keyId` (typically a `KeyRegistry`). `verify(payload, signature)` returns a `VerifyResult`.

| Type | Description |
|---|---|
| `Verifier` | `{ verify(payload, signature) => VerifyResult }` |
| `VerifyResult` | `{ valid; keyId?; algorithm?; reason? }` |
| `PublicKeyResolver` | `{ resolve(keyId) => KeyObject \| undefined }` |

### createKeyRegistry

```ts
createKeyRegistry(config?: KeyRegistryConfig): KeyRegistry
```

A `PublicKeyResolver` over a set of trusted Ed25519 public keys, each with an optional validity window. `resolve()` returns a key only while valid; `isValid(keyId, atTime?)` checks the window. Rejects duplicate or reserved (`__proto__`, `constructor`, `prototype`) key IDs.

| Type | Description |
|---|---|
| `KeyRegistryConfig` | `{ trustRoots?: [...]; clock?: () => number }` |
| `KeyRegistry` | `add`, `get`, `remove`, `list`, `isValid`, plus `resolve` (extends `PublicKeyResolver`) |
| `TrustedKey` | `{ keyId; publicKey; fingerprint; notBefore?; notAfter?; label?; addedAt }` |
| `AddKeyOptions` | `{ notBefore?; notAfter?; label? }` |

### computeKeyFingerprint

```ts
computeKeyFingerprint(publicKey: KeyObject): string
```

SHA-256 hex of the SPKI-DER encoding of a public key. Stable identifier for a key.

```ts
import {
  generateEd25519KeyPair,
  createEd25519Signer,
  createEd25519Verifier,
  createKeyRegistry,
} from '@elsium-ai/core'

const { privateKey, publicKey } = generateEd25519KeyPair()

const signer = createEd25519Signer({ privateKey, keyId: 'svc-2026' })
const sig = signer.sign('audit-event-123')

const registry = createKeyRegistry()
registry.add('svc-2026', publicKey)

const verifier = createEd25519Verifier({ resolver: registry })
const result = verifier.verify('audit-event-123', sig) // { valid: true, ... }
```

(Lower-level helpers `publicKeyFromPem` / `privateKeyFromPem` parse and validate PEM into `KeyObject`s.)

### Write-Once Stores

Tamper-evident append-only storage. `put` is write-once: re-writing an existing key throws `WriteOnceConflictError`. Each `put` returns a `WriteReceipt` with the SHA-256 `hash` of the bytes.

```ts
createInMemoryWriteOnceStore(): WriteOnceStore
createFileWriteOnceStore(config: FileWriteOnceStoreConfig): WriteOnceStore
```

| Type | Description |
|---|---|
| `WriteOnceStore` | `put(key, value)`, `get(key)`, `has(key)`, `list(prefix?)` (async iterable) |
| `WriteReceipt` | `{ key; hash; size; writtenAt }` |
| `FileWriteOnceStoreConfig` | `{ dir: string; fsync?: boolean }` (fsync defaults to `true`) |
| `WriteOnceConflictError` | Thrown when a key already exists |

```ts
import { createFileWriteOnceStore } from '@elsium-ai/core'

const audit = createFileWriteOnceStore({ dir: './audit-log' })
const receipt = await audit.put('events/001.json', JSON.stringify(event))
// receipt.hash is the SHA-256 of the written bytes
```

---

## Capability Tokens

OAuth-style scoped, signed tokens that grant AI agents narrowly-defined permissions (tools, LLMs, RAG, MCP) with budgets, data-class constraints, and expiry. Tokens are Ed25519-signed via the Crypto layer and can be delegated and revoked.

### createCapabilityIssuer

```ts
createCapabilityIssuer(config: CapabilityIssuerConfig): CapabilityIssuer
```

Mints signed `CapabilityToken`s for a given org, signing with the provided `Signer`. `mint(options)` requires a subject and at least one capability; `ttlMs` defaults to one hour. `delegate(parent, options)` derives an attenuated child token.

| Type | Description |
|---|---|
| `CapabilityIssuerConfig` | `{ signer: Signer; orgId: string; clock? }` |
| `CapabilityIssuer` | `{ orgId; keyId; mint(options); delegate(parent, options) }` |
| `MintOptions` | `{ subject; capabilities; dataClasses?; budget?; ttlMs?; expiresAt?; notBefore? }` |

### createCapabilityVerifier

```ts
createCapabilityVerifier(config: CapabilityVerifierConfig): CapabilityVerifier
```

Verifies a token's signature and validity window. `verifyToken` is synchronous (signature + expiry); `verifyTokenAsync` additionally checks an optional `revocationStore`.

| Type | Description |
|---|---|
| `CapabilityVerifierConfig` | `{ resolver: PublicKeyResolver; clock?; revocationStore? }` |
| `CapabilityVerifier` | `{ verifyToken(token); verifyTokenAsync(token) }` |
| `TokenVerificationResult` | `{ valid; signatureValid; withinValidityWindow; reason?; detail? }` |

### CapabilityToken types

| Type | Description |
|---|---|
| `CapabilityToken` | `{ version; tokenId; issuer; subject; capabilities; dataClasses?; budget?; validity; signature }` |
| `AgentCapability` | Union of `ToolCapability`, `McpCapability`, `LLMCapability`, `RagCapability`, `WorkflowCapability` (discriminated by `kind`) |
| `CapabilitySubject` | `{ agent: string; runId?; parentToken? }` |
| `CapabilityIssuerRef` | `{ orgId: string; keyId: string }` |
| `CapabilityValidity` | `{ issuedAt; expiresAt; notBefore? }` |
| `CapabilityBudget` | `{ maxCost?; maxTokens?; maxCalls? }` |
| `CapabilityDataClasses` | `{ allowed?: DataClass[]; denied?: DataClass[] }` |
| `CapabilityCheckReason` | Denial reason enum (`expired`, `bad-signature`, `revoked`, `budget-exceeded`, ...) |
| `CapabilityCheckResult` | `{ allowed; reason?; detail?; matchedCapability? }` |
| `CAPABILITY_TOKEN_VERSION` | `'elsium-cap/v1'` constant |

```ts
import {
  createCapabilityIssuer,
  createCapabilityVerifier,
  createEd25519Signer,
  createKeyRegistry,
  generateEd25519KeyPair,
} from '@elsium-ai/core'

const { privateKey, publicKey } = generateEd25519KeyPair()
const signer = createEd25519Signer({ privateKey, keyId: 'issuer-1' })

const issuer = createCapabilityIssuer({ signer, orgId: 'acme' })
const token = issuer.mint({
  subject: { agent: 'support-bot' },
  capabilities: [{ kind: 'tool', name: 'search' }],
  budget: { maxCalls: 50 },
  ttlMs: 15 * 60 * 1000,
})

const registry = createKeyRegistry()
registry.add('issuer-1', publicKey)
const verifier = createCapabilityVerifier({ resolver: registry })
const check = verifier.verifyToken(token) // { valid: true, ... }
```

Capability-check helpers (`canCallTool`, `canCallLLM`, `canQueryRag`, `canUseMcp`, `checkDataClass`) and `delegateToken` evaluate a verified token against a specific request.

### createInMemoryRevocationStore

```ts
createInMemoryRevocationStore(config?: InMemoryRevocationStoreConfig): RevocationStore
```

In-memory `RevocationStore` for use with `verifyTokenAsync`. `revoke(tokenId, opts?)` is idempotent (returns the existing entry if already revoked). Production users implement `RevocationStore` over durable storage.

| Type | Description |
|---|---|
| `RevocationStore` | `revoke(tokenId, opts?)`, `isRevoked(tokenId)`, `getEntry(tokenId)`, `list()` |
| `RevocationEntry` | `{ tokenId; revokedAt; reason?; revokedBy? }` |
| `InMemoryRevocationStoreConfig` | `{ clock?: () => number }` |

```ts
import { createInMemoryRevocationStore, createCapabilityVerifier } from '@elsium-ai/core'

const revocations = createInMemoryRevocationStore()
await revocations.revoke(token.tokenId, { reason: 'compromised' })

const verifier = createCapabilityVerifier({ resolver: registry, revocationStore: revocations })
const result = await verifier.verifyTokenAsync(token) // { valid: false, reason: 'revoked', ... }
```
