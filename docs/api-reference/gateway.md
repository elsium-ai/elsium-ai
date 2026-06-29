# elsium-ai/gateway

Multi-provider LLM gateway with middleware, security, caching, cost tracking, and intelligent routing.

```ts
import { gateway, createAnthropicProvider, composeMiddleware } from '@elsium-ai/gateway'
```

---

## Gateway

### gateway

```ts
gateway(config: GatewayConfig): Gateway
```

Creates a multi-provider LLM gateway. The gateway is the primary entry point for making LLM requests.

**Config:**

| Field | Type | Description |
|---|---|---|
| `provider` | `string` | Provider name (e.g. `'anthropic'`, `'openai'`, `'google'`, `'openai-compatible'`, or a registered name) |
| `apiKey` | `string` | API key for the provider |
| `model` | `string` | Default model identifier |
| `baseUrl` | `string` | Override the provider base URL |
| `timeout` | `number` | Request timeout in milliseconds |
| `maxRetries` | `number` | Maximum retry attempts |
| `middleware` | `Middleware[]` | Request middleware stack |
| `streamMiddleware` | `StreamMiddleware[]` | Stream middleware stack |
| `xray` | `boolean \| { maxHistory?: number }` | Enable X-Ray request tracing |
| `maxMessages` | `number` | Maximum messages per request |
| `maxInputTokens` | `number` | Maximum estimated input tokens per request |

**Methods:**

| Method | Signature | Description |
|---|---|---|
| `complete` | `complete(request: CompletionRequest): Promise<LLMResponse>` | Send a completion request |
| `stream` | `stream(request: CompletionRequest): ElsiumStream` | Stream a completion response |
| `generateObject` | `generateObject<T>(request & { schema: z.ZodType<T> }): Promise<{ object: T; response: LLMResponse }>` | Get structured output validated against a Zod schema |

```ts
import { gateway } from '@elsium-ai/gateway'

const gw = gateway({
  provider: 'anthropic',
  apiKey: env('ANTHROPIC_API_KEY'),
  model: 'claude-sonnet-4-20250514',
})

// Standard completion
const response = await gw.complete({
  messages: [{ role: 'user', content: 'Hello' }],
})

// Streaming
const stream = gw.stream({
  messages: [{ role: 'user', content: 'Tell me a story' }],
})

for await (const event of stream) {
  if (event.type === 'text_delta') {
    process.stdout.write(event.text)
  }
}

// Structured output
import { z } from 'zod'

const schema = z.object({
  sentiment: z.enum(['positive', 'negative', 'neutral']),
  confidence: z.number(),
})

const { object } = await gw.generateObject({
  messages: [{ role: 'user', content: 'Analyze: I love this product' }],
  schema,
})
// object: { sentiment: 'positive', confidence: 0.95 }
```

---

## Provider Registration

| Export | Signature | Description |
|---|---|---|
| `registerProviderFactory` | `registerProviderFactory(name: string, factory: ProviderFactory): void` | Register a provider factory globally |
| `registerProvider` | `registerProvider(name: string, factory: ProviderFactory): void` | Register a provider factory (or instance) in the provider registry |
| `getProviderFactory` | `getProviderFactory(name: string): ProviderFactory \| undefined` | Retrieve a registered factory |
| `listProviders` | `listProviders(): string[]` | List all registered provider names |
| `registerProviderMetadata` | `registerProviderMetadata(name: string, meta: ProviderMetadata): void` | Register provider metadata (models, capabilities) |
| `getProviderMetadata` | `getProviderMetadata(name: string): ProviderMetadata \| undefined` | Retrieve provider metadata |

```ts
import { registerProviderFactory, listProviders } from '@elsium-ai/gateway'

registerProviderFactory('custom', (config) => ({
  complete: async (request) => { /* ... */ },
  stream: async function* (request) { /* ... */ },
}))

const providers = listProviders() // ['anthropic', 'openai', 'google', 'custom']
```

---

## Built-in Providers

### createAnthropicProvider

```ts
createAnthropicProvider(config: ProviderConfig): LLMProvider
```

Creates a provider for Anthropic Claude models.

### createOpenAIProvider

```ts
createOpenAIProvider(config: ProviderConfig): LLMProvider
```

Creates a provider for OpenAI GPT models.

### createGoogleProvider

```ts
createGoogleProvider(config: ProviderConfig): LLMProvider
```

Creates a provider for Google Gemini models.

```ts
import {
  createAnthropicProvider,
  createOpenAIProvider,
  createGoogleProvider,
} from '@elsium-ai/gateway'

const anthropic = createAnthropicProvider({
  apiKey: env('ANTHROPIC_API_KEY'),
})

const openai = createOpenAIProvider({
  apiKey: env('OPENAI_API_KEY'),
})

const google = createGoogleProvider({
  apiKey: env('GOOGLE_API_KEY'),
})
```

### createOpenAICompatibleProvider

```ts
createOpenAICompatibleProvider(config: OpenAICompatibleConfig): LLMProvider
```

Creates a provider for any OpenAI-compatible Chat Completions API (e.g. self-hosted vLLM, Together, Groq, Ollama, local gateways). Wraps `createOpenAIProvider` with a custom `baseUrl` and reports a configurable provider name.

**Config:** extends `ProviderConfig` (`apiKey`, `timeout`, `maxRetries`).

| Field | Type | Description |
|---|---|---|
| `baseUrl` | `string` | Base URL of the OpenAI-compatible endpoint (required) |
| `name` | `string` | Provider name reported on responses (default `'openai-compatible'`) |
| `defaultModel` | `string` | Default model identifier (default `'default'`) |
| `capabilities` | `string[]` | Advertised capabilities (default `['tools', 'streaming', 'system']`) |

```ts
import { createOpenAICompatibleProvider } from '@elsium-ai/gateway'

const local = createOpenAICompatibleProvider({
  name: 'vllm',
  baseUrl: 'http://localhost:8000',
  apiKey: env('VLLM_API_KEY'),
  defaultModel: 'llama-3.1-70b',
})
```

---

## Middleware

### composeMiddleware

```ts
composeMiddleware(middlewares: Middleware[]): Middleware
```

Composes multiple request middlewares into a single middleware. Middlewares execute in order, following the Koa-style `(ctx, next)` pattern.

### composeStreamMiddleware

```ts
composeStreamMiddleware(middlewares: StreamMiddleware[]): StreamMiddleware
```

Composes multiple stream middlewares into a single stream middleware.

### Built-in Middleware

| Export | Description |
|---|---|
| `loggingMiddleware` | Logs request and response details with timing |
| `costTrackingMiddleware` | Tracks token usage and calculates cost per request |
| `xrayMiddleware` | Attaches detailed execution trace data to responses |
| `bulkheadMiddleware(config)` | Limits concurrent requests per provider or globally |
| `cacheMiddleware(config?)` | Caches responses (in-memory by default; configurable adapter, TTL, and key function) |
| `outputGuardrailMiddleware(guardrails)` | Validates outputs against guardrail rules |
| `securityMiddleware(config)` | Scans inputs for prompt injection, jailbreak attempts, and secrets |

```ts
import {
  gateway,
  composeMiddleware,
  loggingMiddleware,
  costTrackingMiddleware,
  xrayMiddleware,
  securityMiddleware,
  bulkheadMiddleware,
  cacheMiddleware,
  createInMemoryCache,
} from '@elsium-ai/gateway'

const gw = gateway({
  provider: 'anthropic',
  apiKey: env('ANTHROPIC_API_KEY'),
  middleware: [
    loggingMiddleware,
    costTrackingMiddleware,
    xrayMiddleware,
    securityMiddleware({ promptInjection: true, secretRedaction: true }),
    bulkheadMiddleware({ maxConcurrent: 10 }),
    cacheMiddleware({ adapter: createInMemoryCache(100), ttlMs: 60000 }),
  ],
})
```

### Custom Middleware

```ts
import type { Middleware } from '@elsium-ai/core'

const timingMiddleware: Middleware = async (ctx, next) => {
  const start = performance.now()
  const response = await next(ctx)
  const latencyMs = performance.now() - start
  log.info('Request completed', { latencyMs })
  return response
}
```

---

## Cache

### createInMemoryCache

```ts
createInMemoryCache(maxSize?: number): CacheAdapter
```

Creates an in-memory response cache with TTL expiration and bounded size (LRU eviction). The TTL is supplied per entry by `cacheMiddleware` via its `ttlMs` option.

```ts
import { createInMemoryCache, cacheMiddleware } from '@elsium-ai/gateway'

const cache = createInMemoryCache(500)

const gw = gateway({
  provider: 'anthropic',
  apiKey: env('ANTHROPIC_API_KEY'),
  middleware: [cacheMiddleware({ adapter: cache, ttlMs: 300000 })],
})
```

---

## Concurrency

### createBulkhead

```ts
createBulkhead(config?: BulkheadConfig): Bulkhead
```

Creates a global concurrency limiter. Caps the number of in-flight operations and queues the rest; when the queue is full it rejects with a rate-limit error, and queued operations time out after `queueTimeoutMs`.

**Config (`BulkheadConfig`):**

| Field | Type | Default | Description |
|---|---|---|---|
| `maxConcurrent` | `number` | `10` | Maximum operations running at once (must be >= 1) |
| `maxQueued` | `number` | `50` | Maximum operations waiting for a slot (0 disables queueing) |
| `queueTimeoutMs` | `number` | `30000` | How long a queued operation waits before timing out |

**Bulkhead:**

| Member | Signature | Description |
|---|---|---|
| `execute` | `execute<T>(fn: () => Promise<T>): Promise<T>` | Run `fn` under the concurrency limit |
| `active` | `number` (readonly) | Operations currently running |
| `queued` | `number` (readonly) | Operations currently waiting |

### bulkheadMiddleware

```ts
bulkheadMiddleware(config?: BulkheadConfig): Middleware
```

Wraps `createBulkhead` as request middleware, limiting concurrent gateway requests.

```ts
import { gateway, bulkheadMiddleware } from '@elsium-ai/gateway'

const gw = gateway({
  provider: 'anthropic',
  apiKey: env('ANTHROPIC_API_KEY'),
  middleware: [bulkheadMiddleware({ maxConcurrent: 5, maxQueued: 20 })],
})
```

### createFairQueue

```ts
createFairQueue(config: FairQueueConfig): FairQueue
```

Creates a per-agent token-bucket rate limiter. Unlike the global bulkhead, each identified agent gets its own bucket, so one greedy agent cannot starve others sharing the same LLM quota. Buckets refill continuously; requests consume one token and wait up to `waitTimeoutMs` for one. In-process only — distributed fairness is left to the user.

**Config (`FairQueueConfig`):**

| Field | Type | Default | Description |
|---|---|---|---|
| `perAgent` | `BucketConfig` | — | Default bucket parameters applied to every agent (required) |
| `overrides` | `Record<string, BucketConfig>` | — | Per-agent bucket parameter overrides keyed by agent name |
| `waitTimeoutMs` | `number` | `5000` | How long to wait for a token before giving up |
| `onTimeout` | `'throw' \| 'proceed'` | `'throw'` | Behavior when `waitTimeoutMs` elapses |
| `identifyAgent` | `(ctx: MiddlewareContext) => string \| undefined` | reads `ctx.metadata.agentName` | Extracts the agent identity; falls back to a shared `_default` bucket |

**BucketConfig:** `{ capacity: number; refillRatePerSec: number }` — both must be positive finite numbers.

**FairQueue:**

| Member | Signature | Description |
|---|---|---|
| `middleware` | `middleware(): Middleware` | Rate-limiting middleware for the gateway |
| `getBucketState` | `getBucketState(agent: string): BucketState \| null` | Current token state for one agent |
| `listBuckets` | `listBuckets(): readonly BucketState[]` | Token state for all active buckets |

```ts
import { gateway, createFairQueue } from '@elsium-ai/gateway'

const fairQueue = createFairQueue({
  perAgent: { capacity: 10, refillRatePerSec: 2 },
  overrides: { 'priority-agent': { capacity: 50, refillRatePerSec: 10 } },
  waitTimeoutMs: 3000,
})

const gw = gateway({
  provider: 'anthropic',
  apiKey: env('ANTHROPIC_API_KEY'),
  middleware: [fairQueue.middleware()],
})
```

---

## Security

Functions for scanning and sanitizing LLM inputs and outputs.

| Export | Signature | Description |
|---|---|---|
| `securityMiddleware` | `securityMiddleware(config: SecurityMiddlewareConfig): Middleware` | Scan inputs for injection/jailbreak/blocked patterns; redact secrets in responses (and, with `redactInput`, in requests) |
| `detectPromptInjection` | `detectPromptInjection(text: string): SecurityViolation[]` | Detect prompt injection attempts |
| `detectJailbreak` | `detectJailbreak(text: string): SecurityViolation[]` | Detect jailbreak attempts |
| `redactSecrets` | `redactSecrets(text: string, piiTypes?): { redacted: string; found: SecurityViolation[] }` | Redact API keys, tokens, secrets, and optional PII |
| `checkBlockedPatterns` | `checkBlockedPatterns(text: string, patterns: (string \| RegExp)[]): SecurityViolation[]` | Check text against custom blocked patterns |
| `classifyContent` | `classifyContent(text: string): ClassificationResult` | Classify content sensitivity (`public` / `confidential` / `restricted`) |
| `normalizeForDetection` | `normalizeForDetection(text: string): string` | Normalize text for detection (strip zero-width, fold homoglyphs, collapse whitespace, lowercase) |
| `expandForDetection` | `expandForDetection(text: string): string` | Normalized text plus any decoded base64 payloads — the haystack the detectors scan |

```ts
import { detectPromptInjection, redactSecrets } from '@elsium-ai/gateway'

const violations = detectPromptInjection(userInput)
if (violations.length > 0) {
  log.warn('Injection attempt detected', { detail: violations[0].detail })
}

const { redacted } = redactSecrets('My key is sk-abc12345xyz')
// redacted: 'My key is [REDACTED_API_KEY]'
```

### Input-side redaction

By default `securityMiddleware` redacts secrets only in the model's **response**. Set `redactInput: true` to also redact secrets — and any configured `piiTypes` — from the **outgoing** request (system prompt + input messages) *before* it reaches the provider, so sensitive values never leave your process. Off by default and backward-compatible.

```ts
import { gateway, securityMiddleware } from '@elsium-ai/gateway'

const gw = gateway({
  provider: 'anthropic',
  apiKey: process.env.ANTHROPIC_API_KEY!,
  middleware: [
    securityMiddleware({
      redactInput: true,           // mask secrets/PII before they reach the provider
      piiTypes: ['email', 'phone'],
    }),
  ],
})
```

### Evasion-resistant detection

`detectPromptInjection` and `detectJailbreak` normalize input before matching: strip zero-width/invisible characters, fold common Cyrillic/Greek homoglyphs to ASCII, collapse whitespace, and decode embedded base64 payloads so hidden attacks are scanned too. The normalization is pure, dependency-free, and edge-safe, and is exported as `normalizeForDetection` / `expandForDetection` for reuse in external guardrails.

Detection quality is measured by the internal benchmark `benchmarks/guardrail-detection.ts` (run `bun benchmarks/guardrail-detection.ts`): on its internal adversarial set it reports **100% recall across 6 evasion categories** (plain, zero-width, homoglyph, spacing, uppercase, base64) with **0% false positives** on a benign set including hard near-misses. This measures coverage against **known** evasions, not robustness to novel attacks — the detectors are evasion-resistant (harder to evade), not evasion-proof. The roadmap is validation against an external prompt-injection corpus; for higher assurance, layer an external detector on top.

That external-detector seam lives at the agent level: `@elsium-ai/agents` exposes an `injectionClassifier` extension point on `AgentSecurityConfig` (`(input: string) => boolean | Promise<boolean>`) for plugging in an LLM-based or third-party guardrail. The heuristic plus normalization described here is the gateway-level built-in.

---

## Pricing

| Export | Signature | Description |
|---|---|---|
| `calculateCost` | `calculateCost(model: string, usage: TokenUsage): CostBreakdown` | Calculate cost from usage |
| `registerPricing` | `registerPricing(model: string, pricing: ModelPricing): void` | Register custom model pricing |
| `estimateCost` | `estimateCost(model: string, tokenCount: number): number` | Estimate cost before a request |

```ts
import { calculateCost, registerPricing } from '@elsium-ai/gateway'

registerPricing('custom-model', {
  inputPerMillion: 3,
  outputPerMillion: 15,
})

const cost = calculateCost('claude-sonnet-4-20250514', {
  inputTokens: 1000,
  outputTokens: 500,
  totalTokens: 1500,
})
// cost: { inputCost: 0.003, outputCost: 0.0075, totalCost: 0.0105, currency: 'USD' }
```

---

## Batch

### createBatch

```ts
createBatch(gateway: Gateway, config?: BatchConfig): { execute(requests: CompletionRequest[]): Promise<BatchResult> }
```

Creates a batch runner that processes multiple completion requests, handling concurrency and error collection.

```ts
import { createBatch } from '@elsium-ai/gateway'

const batch = createBatch(gw)
const { results } = await batch.execute([
  { messages: [{ role: 'user', content: 'Summarize document A' }] },
  { messages: [{ role: 'user', content: 'Summarize document B' }] },
  { messages: [{ role: 'user', content: 'Summarize document C' }] },
])
```

---

## Router

### createProviderMesh

```ts
createProviderMesh(config: ProviderMeshConfig): ProviderMesh
```

Creates a multi-provider router that distributes requests across providers using configurable strategies.

**Strategies:**

| Strategy | Description |
|---|---|
| `fallback` | Try providers in declared order, falling back to the next on error |
| `cost-optimized` | Route between a cheaper and a more capable model based on estimated request complexity (requires `costOptimizer`) |
| `latency-optimized` | Race available providers and return the fastest response |
| `capability-aware` | Route to a provider that supports the capabilities the request requires |

```ts
import { createProviderMesh } from '@elsium-ai/gateway'

const mesh = createProviderMesh({
  providers: [
    { name: 'anthropic', config: { apiKey: env('ANTHROPIC_API_KEY') }, model: 'claude-sonnet-4-20250514' },
    { name: 'openai', config: { apiKey: env('OPENAI_API_KEY') }, model: 'gpt-4o' },
  ],
  strategy: 'fallback',
})
```

### createDeclarativeRouter

```ts
createDeclarativeRouter(initial: RoutingPolicy): DeclarativeRouter
```

Creates a data-driven routing layer that maps a request's shape (model, provider, tenant, capabilities, estimated cost/latency, arbitrary metadata) to a `RoutingTarget`. Rules reuse the same condition expressions and operators as `@elsium-ai/core` authorization. It resolves a target; composing it with `createProviderMesh` to execute the request is left to the caller. The policy is validated on construction and on every `loadPolicy`.

**RoutingPolicy:**

| Field | Type | Description |
|---|---|---|
| `apiVersion` | `'elsium.routing/v1'` | Schema version |
| `kind` | `'RoutingPolicy'` | Resource kind |
| `metadata` | `{ name: string; description?: string }` | Policy identity |
| `rules` | `RoutingRule[]` | Ordered routing rules |
| `default` | `RoutingTarget` | Target used when no rule matches |

**RoutingRule:** `{ name, when?: ConditionExpression, slo?: ServiceLevelObjective, target: RoutingTarget, priority?: number }` — higher `priority` evaluates first (default `0`).

**ServiceLevelObjective:** `{ maxLatencyMs?, maxCost?, requireCapabilities?: string[] }` — a rule is ineligible if estimated latency/cost exceed the caps or required capabilities are missing.

**RoutingTarget:** `{ strategy?: RoutingStrategy, provider?: string, model?: string }`.

**RoutingContext (input to `resolve`):** `{ tenant?, model?, provider?, estimatedCost?, estimatedLatencyMs?, capabilities?: string[], metadata?: Record<string, string | number | boolean> }`.

**RoutingResolution (output):** `{ target: RoutingTarget, matchedRule?: string, reason: string }`.

**DeclarativeRouter:**

| Method | Signature | Description |
|---|---|---|
| `resolve` | `resolve(ctx: RoutingContext): RoutingResolution` | Resolve the target for a request context |
| `loadPolicy` | `loadPolicy(policy: RoutingPolicy): void` | Replace the active policy (validated) |
| `exportPolicy` | `exportPolicy(): RoutingPolicy` | Return a copy of the active policy |
| `verify` | `verify(policy?: RoutingPolicy): { rule: string; issue: string }[]` | Lint a policy without applying it |

```ts
import { createDeclarativeRouter } from '@elsium-ai/gateway'

const router = createDeclarativeRouter({
  apiVersion: 'elsium.routing/v1',
  kind: 'RoutingPolicy',
  metadata: { name: 'tenant-routing' },
  rules: [
    {
      name: 'enterprise-to-opus',
      priority: 10,
      when: { op: 'eq', field: 'tenant', value: 'enterprise' },
      target: { provider: 'anthropic', model: 'claude-opus-4-20250514' },
    },
  ],
  default: { strategy: 'cost-optimized' },
})

const { target } = router.resolve({ tenant: 'enterprise' })
// target: { provider: 'anthropic', model: 'claude-opus-4-20250514' }
```

---

## Cost-Aware Routed Generation (CARG)

A cascade router that classifies a request's difficulty, then tries provider/model tiers from cheapest to most capable, escalating only when a tier fails, returns low-confidence output, or fails validation.

### createCascadeRouter

```ts
createCascadeRouter(config: CascadeRouterConfig, deps?: CascadeRouterFactoryOptions): CascadeRouter
```

**CascadeRouterConfig:**

| Field | Type | Description |
|---|---|---|
| `tiers` | `Tier[]` | Ordered tiers, cheapest first (at least one required) |
| `classifier` | `LLMClassifier` | Optional classifier; tiers with a `maxDifficulty` below the request difficulty are skipped |
| `escalateOnFailure` | `boolean \| EscalateOnFailureConfig` | Escalation policy (default `false`; `true` escalates on provider error only) |
| `onAudit` | `(event: CascadeAuditEvent) => void` | Receives attempt/escalation/success/exhausted events |

**Tier:** `{ name, provider, model, maxDifficulty? }`.

**EscalateOnFailureConfig:** `{ onProviderError?, validator?: CascadeValidator, confidence?: CascadeConfidenceCheck, maxEscalations? }` — `validator` returns `ValidatorCheckResult` (`{ valid, reason?, detail? }`), `confidence` returns `ConfidenceCheckResult` (`{ ok, confidence, reason? }`). `maxEscalations` defaults to `tiers.length - 1`.

**CascadeRouterFactoryOptions (`deps`):** `{ apiKeys?: Record<string, string>, makeGateway?: (tier: Tier) => Gateway }` — supply `apiKeys` keyed by provider for the default gateway factory, or inject `makeGateway` to build gateways yourself (e.g. in tests).

**CascadeRouter:**

| Member | Signature | Description |
|---|---|---|
| `complete` | `complete(request: CompletionRequest): Promise<CascadeResult>` | Run the cascade |
| `tiers` | `ReadonlyArray<Tier>` | Configured tiers |

**CascadeResult:** `{ response: LLMResponse, tier: string, totalCost: number, totalLatencyMs: number, attempts: CascadeAttempt[], classification?: RequestClassification }`. Each `CascadeAttempt` records the tier, status (`'ok' | 'failed' | 'validation-failed' | 'low-confidence' | 'skipped-by-classifier'`), cost, latency, and reason. When every eligible tier fails, `complete` throws `CascadeExhaustedError` (carrying `attempts` and `classification`).

```ts
import { createCascadeRouter, createHeuristicClassifier } from '@elsium-ai/gateway'

const router = createCascadeRouter(
  {
    tiers: [
      { name: 'cheap', provider: 'openai', model: 'gpt-4o-mini', maxDifficulty: 0.4 },
      { name: 'capable', provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    ],
    classifier: createHeuristicClassifier(),
    escalateOnFailure: true,
  },
  { apiKeys: { openai: env('OPENAI_API_KEY'), anthropic: env('ANTHROPIC_API_KEY') } },
)

const result = await router.complete({
  messages: [{ role: 'user', content: 'What is the capital of France?' }],
})
// result.tier === 'cheap', result.totalCost, result.attempts
```

### createHeuristicClassifier

```ts
createHeuristicClassifier(): LLMClassifier
```

A zero-cost, synchronous classifier that scores difficulty (0–1) from request shape (length, tool count, message count) and keyword domains (code, math, reasoning, creative). No LLM call.

### createLLMClassifier

```ts
createLLMClassifier(options: LLMClassifierOptions): LLMClassifier
```

A classifier that asks an LLM to rate request difficulty and domain, returning a `RequestClassification` (`{ difficulty, domain?, reason? }`). Falls back to `difficulty: 0.5` if the response can't be parsed.

**LLMClassifierOptions:** `{ complete: (request: CompletionRequest) => Promise<LLMResponse>, model?: string, maxTokens?: number }` (default `maxTokens` 64).

---

## PII Classification & Jurisdiction Routing

Two composable ports for data-residency-aware routing: a PII classifier that detects sensitive data, and a jurisdiction router that restricts the allowed providers based on detected PII classes and the tenant's jurisdiction. The class-to-provider rules are the user's policy; the framework provides the engine.

### createPiiClassifier

```ts
createPiiClassifier(): PiiClassifier
```

Creates a regex-based PII classifier. Built-in classes: `email`, `phone`, `ssn`, `credit_card`, `passport`, `ip_address`. Custom classes are added via `register`.

**PiiClassifier:**

| Member | Signature | Description |
|---|---|---|
| `classify` | `classify(text: string): readonly PiiMatch[]` | Find PII matches (`{ piiClass, start, end, matchedText }`) |
| `register` | `register(piiClass: PiiClass, pattern: RegExp): void` | Add a custom PII class and pattern |
| `classes` | `readonly PiiClass[]` | Registered PII classes |

### createJurisdictionRouter

```ts
createJurisdictionRouter(config: JurisdictionRouterConfig): JurisdictionRouter
```

Given a request text and candidate providers, detects PII and returns the providers allowed to receive that data under the configured jurisdiction policy.

**JurisdictionRouterConfig:** `{ policy: JurisdictionPolicy, classifier?: PiiClassifier }` (defaults to `createPiiClassifier()`).

**JurisdictionPolicy:** `{ byJurisdiction: Record<string, JurisdictionRules>, default?: JurisdictionRules }`. **JurisdictionRules:** `{ classProviders: Record<PiiClass | '*', readonly string[]> }` — maps each PII class (or `'*'` fallback) to the providers allowed to handle it.

**JurisdictionRouter:**

| Method | Signature | Description |
|---|---|---|
| `resolveProviders` | `resolveProviders(text, { jurisdiction?, candidateProviders }): JurisdictionResolution` | Resolve allowed providers for the text |

**JurisdictionResolution:** `{ detectedClasses, allowedProviders, deniedProviders, jurisdictionUsed, reason }`.

```ts
import { createJurisdictionRouter } from '@elsium-ai/gateway'

const router = createJurisdictionRouter({
  policy: {
    byJurisdiction: {
      eu: { classProviders: { email: ['azure-eu'], '*': ['azure-eu', 'anthropic'] } },
    },
    default: { classProviders: { '*': ['anthropic', 'openai'] } },
  },
})

const resolution = router.resolveProviders('Contact me at jane@example.com', {
  jurisdiction: 'eu',
  candidateProviders: ['azure-eu', 'anthropic', 'openai'],
})
// resolution.detectedClasses: ['email']
// resolution.allowedProviders: ['azure-eu']
```
