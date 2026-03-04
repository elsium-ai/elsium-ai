# elsium-ai/gateway

Multi-provider LLM gateway with middleware, security, caching, cost tracking, and intelligent routing.

```ts
import { gateway, createAnthropicProvider, composeMiddleware } from 'elsium-ai/gateway'
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
| `providers` | `Record<string, ProviderConfig>` | Named provider configurations |
| `middleware` | `Middleware[]` | Request middleware stack |
| `streamMiddleware` | `StreamMiddleware[]` | Stream middleware stack |
| `defaultModel` | `string` | Default model identifier |
| `defaultProvider` | `string` | Default provider name |

**Methods:**

| Method | Signature | Description |
|---|---|---|
| `complete` | `complete(request: CompletionRequest): Promise<LLMResponse>` | Send a completion request |
| `stream` | `stream(request: CompletionRequest): ElsiumStream` | Stream a completion response |
| `completeWithStructuredOutput` | `completeWithStructuredOutput<T>(request, schema): Promise<T>` | Get structured output validated against a Zod schema |

```ts
import { gateway, createAnthropicProvider, createOpenAIProvider } from 'elsium-ai/gateway'

const gw = gateway({
  providers: {
    anthropic: createAnthropicProvider({ apiKey: env('ANTHROPIC_API_KEY') }),
    openai: createOpenAIProvider({ apiKey: env('OPENAI_API_KEY') }),
  },
  defaultProvider: 'anthropic',
  defaultModel: 'claude-sonnet-4-20250514',
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
  if (event.type === 'content-delta') {
    process.stdout.write(event.delta)
  }
}

// Structured output
import { z } from 'zod'

const schema = z.object({
  sentiment: z.enum(['positive', 'negative', 'neutral']),
  confidence: z.number(),
})

const result = await gw.completeWithStructuredOutput(
  { messages: [{ role: 'user', content: 'Analyze: I love this product' }] },
  schema,
)
// result: { sentiment: 'positive', confidence: 0.95 }
```

---

## Provider Registration

| Export | Signature | Description |
|---|---|---|
| `registerProviderFactory` | `registerProviderFactory(name: string, factory: ProviderFactory): void` | Register a provider factory globally |
| `registerProvider` | `registerProvider(name: string, factory: ProviderFactory): void` | Alias for `registerProviderFactory` |
| `getProviderFactory` | `getProviderFactory(name: string): ProviderFactory \| undefined` | Retrieve a registered factory |
| `listProviders` | `listProviders(): string[]` | List all registered provider names |
| `registerProviderMetadata` | `registerProviderMetadata(name: string, meta: ProviderMetadata): void` | Register provider metadata (models, capabilities) |
| `getProviderMetadata` | `getProviderMetadata(name: string): ProviderMetadata \| undefined` | Retrieve provider metadata |

```ts
import { registerProviderFactory, listProviders } from 'elsium-ai/gateway'

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
createAnthropicProvider(config: ProviderConfig): Provider
```

Creates a provider for Anthropic Claude models.

### createOpenAIProvider

```ts
createOpenAIProvider(config: ProviderConfig): Provider
```

Creates a provider for OpenAI GPT models.

### createGoogleProvider

```ts
createGoogleProvider(config: ProviderConfig): Provider
```

Creates a provider for Google Gemini models.

```ts
import {
  createAnthropicProvider,
  createOpenAIProvider,
  createGoogleProvider,
} from 'elsium-ai/gateway'

const anthropic = createAnthropicProvider({
  apiKey: env('ANTHROPIC_API_KEY'),
  defaultModel: 'claude-sonnet-4-20250514',
})

const openai = createOpenAIProvider({
  apiKey: env('OPENAI_API_KEY'),
  defaultModel: 'gpt-4o',
})

const google = createGoogleProvider({
  apiKey: env('GOOGLE_API_KEY'),
  defaultModel: 'gemini-2.0-flash',
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
| `cacheMiddleware(cache)` | Caches responses using a provided cache implementation |
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
} from 'elsium-ai/gateway'

const gw = gateway({
  providers: { /* ... */ },
  middleware: [
    loggingMiddleware,
    costTrackingMiddleware,
    xrayMiddleware,
    securityMiddleware({ detectInjection: true, redactSecrets: true }),
    bulkheadMiddleware({ maxConcurrent: 10 }),
    cacheMiddleware(createInMemoryCache({ ttlMs: 60000, maxSize: 100 })),
  ],
})
```

### Custom Middleware

```ts
import type { Middleware } from 'elsium-ai/core'

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
createInMemoryCache(opts?: { ttlMs?: number; maxSize?: number }): Cache
```

Creates an in-memory response cache with TTL expiration and bounded size (FIFO eviction).

```ts
import { createInMemoryCache, cacheMiddleware } from 'elsium-ai/gateway'

const cache = createInMemoryCache({ ttlMs: 300000, maxSize: 500 })

const gw = gateway({
  middleware: [cacheMiddleware(cache)],
})
```

---

## Security

Functions for scanning and sanitizing LLM inputs.

| Export | Signature | Description |
|---|---|---|
| `detectPromptInjection` | `detectPromptInjection(text: string): DetectionResult` | Detect prompt injection attempts |
| `detectJailbreak` | `detectJailbreak(text: string): DetectionResult` | Detect jailbreak attempts |
| `redactSecrets` | `redactSecrets(text: string): string` | Redact API keys, tokens, and secrets |
| `checkBlockedPatterns` | `checkBlockedPatterns(text: string, patterns: RegExp[]): PatternMatch[]` | Check text against custom blocked patterns |
| `classifyContent` | `classifyContent(text: string): ContentClassification` | Classify content for safety |

```ts
import { detectPromptInjection, redactSecrets } from 'elsium-ai/gateway'

const injection = detectPromptInjection(userInput)
if (injection.detected) {
  log.warn('Injection attempt detected', { score: injection.score })
}

const sanitized = redactSecrets('My key is sk-abc123xyz')
// sanitized: 'My key is [REDACTED]'
```

---

## Pricing

| Export | Signature | Description |
|---|---|---|
| `calculateCost` | `calculateCost(model: string, usage: TokenUsage): CostBreakdown` | Calculate cost from usage |
| `registerPricing` | `registerPricing(model: string, pricing: ModelPricing): void` | Register custom model pricing |
| `estimateCost` | `estimateCost(model: string, tokenCount: number): number` | Estimate cost before a request |

```ts
import { calculateCost, registerPricing } from 'elsium-ai/gateway'

registerPricing('custom-model', {
  inputPer1kTokens: 0.003,
  outputPer1kTokens: 0.015,
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
createBatch(gateway: Gateway, requests: CompletionRequest[]): Promise<LLMResponse[]>
```

Processes multiple completion requests as a batch, handling concurrency and error collection.

```ts
import { createBatch } from 'elsium-ai/gateway'

const responses = await createBatch(gw, [
  { messages: [{ role: 'user', content: 'Summarize document A' }] },
  { messages: [{ role: 'user', content: 'Summarize document B' }] },
  { messages: [{ role: 'user', content: 'Summarize document C' }] },
])
```

---

## Router

### createProviderMesh

```ts
createProviderMesh(config: MeshConfig): ProviderMesh
```

Creates a multi-provider router that distributes requests across providers using configurable strategies.

**Strategies:**

| Strategy | Description |
|---|---|
| `round-robin` | Distribute requests evenly across providers |
| `lowest-cost` | Route to the cheapest provider for the requested model |
| `fastest` | Route to the provider with the lowest observed latency |

```ts
import { createProviderMesh } from 'elsium-ai/gateway'

const mesh = createProviderMesh({
  providers: {
    anthropic: anthropicProvider,
    openai: openaiProvider,
  },
  strategy: 'lowest-cost',
  fallback: true,
})
```
