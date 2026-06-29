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
