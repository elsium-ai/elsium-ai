# elsium-ai/client

HTTP client SDK for talking to an ElsiumAI server. Provides a typed client for chat, completion, health, metrics, and agent endpoints, plus a helper for parsing Server-Sent Events (SSE) streams.

```ts
import { createClient, parseSSEStream } from '@elsium-ai/client'
```

---

## Client

| Export | Signature | Description |
|---|---|---|
| `createClient` | `createClient(config: ClientConfig): ElsiumClient` | Create a typed HTTP client bound to a server |

### createClient

Returns an `ElsiumClient` configured to call the given `baseUrl`. Requests send `Content-Type: application/json` and, when `apiKey` is set, an `Authorization: Bearer <apiKey>` header. Each request is aborted after `timeout` milliseconds (default `30000`).

```ts
import { createClient } from '@elsium-ai/client'

const client = createClient({
  baseUrl: 'https://api.example.com',
  apiKey: process.env.ELSIUM_API_KEY,
  timeout: 30_000,
})

const response = await client.chat({ message: 'Hello', agent: 'support' })
console.log(response.message, response.usage.totalTokens)
```

### ClientConfig

```ts
interface ClientConfig {
  baseUrl: string    // Base URL of the ElsiumAI server
  apiKey?: string    // Optional bearer token
  timeout?: number   // Per-request timeout in ms (default: 30000)
}
```

### ElsiumClient

```ts
interface ElsiumClient {
  chat(req: ChatRequest): Promise<ChatResponse>
  chatStream(req: ChatRequest): AsyncIterable<StreamEvent>
  complete(req: CompleteRequest): Promise<CompleteResponse>
  completeStream(req: CompleteRequest): AsyncIterable<StreamEvent>
  health(): Promise<HealthResponse>
  metrics(): Promise<MetricsResponse>
  agents(): Promise<{ agents: AgentInfo[] }>
}
```

| Method | Endpoint | Description |
|---|---|---|
| `chat` | `POST /chat` | Send a single message to an agent and await the full reply |
| `chatStream` | `POST /chat` | Same as `chat`, streamed as `StreamEvent`s |
| `complete` | `POST /complete` | Low-level chat completion over a message array |
| `completeStream` | `POST /complete` | Same as `complete`, streamed as `StreamEvent`s |
| `health` | `GET /health` | Server health and configured providers |
| `metrics` | `GET /metrics` | Aggregate usage and cost metrics |
| `agents` | `GET /agents` | List available agents |

---

## Chat

```ts
const res = await client.chat({ message: 'Summarize this thread', agent: 'support' })
// res => { message, usage: { inputTokens, outputTokens, totalTokens, cost }, model, traceId }
```

### ChatRequest

```ts
interface ChatRequest {
  message: string
  agent?: string    // Named agent to route to
  stream?: boolean  // Forced internally per method; not required by callers
}
```

### ChatResponse

```ts
interface ChatResponse {
  message: string
  usage: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    cost: number
  }
  model: string
  traceId: string
}
```

---

## Complete

Lower-level completion endpoint that accepts an explicit message array and model parameters.

```ts
const res = await client.complete({
  messages: [{ role: 'user', content: 'Translate "hello" to French' }],
  model: 'claude-sonnet-4-5',
  system: 'You are a translator.',
  maxTokens: 256,
  temperature: 0.2,
})
// res => { id, message, model, usage, cost, traceId }
```

### CompleteRequest

```ts
interface CompleteRequest {
  messages: Array<{ role: string; content: string }>
  model?: string
  system?: string
  maxTokens?: number
  temperature?: number
  stream?: boolean
}
```

### CompleteResponse

```ts
interface CompleteResponse {
  id: string
  message: string
  model: string
  usage: { inputTokens: number; outputTokens: number; totalTokens: number }
  cost: { inputCost: number; outputCost: number; totalCost: number; currency: string }
  traceId: string
}
```

---

## Streaming

`chatStream` and `completeStream` return an `AsyncIterable<StreamEvent>`. Iterate with `for await`; the underlying SSE parsing is handled for you.

```ts
for await (const event of client.chatStream({ message: 'Tell me a story' })) {
  if (event.type === 'text_delta') {
    process.stdout.write(event.text)
  }
}
```

`StreamEvent` is re-used from `@elsium-ai/core` and is a discriminated union over `type` (`text_delta`, `thinking_delta`, `tool_call_start`, `message_end`, `error`, and more). See the core API reference for the full shape.

---

## SSE Parsing

| Export | Signature | Description |
|---|---|---|
| `parseSSEStream` | `parseSSEStream(response: Response): AsyncIterable<StreamEvent>` | Parse a raw `fetch` SSE response body into `StreamEvent`s |

### parseSSEStream

Consumes a streaming `Response` body, splits it on newlines, and yields one `StreamEvent` per valid `data:` line. Throws if `response.body` is `null`. `event: error` lines, blank lines, `[DONE]` sentinels, and malformed JSON are skipped.

Use this directly when you make your own `fetch` to an SSE endpoint instead of going through `chatStream` / `completeStream`.

```ts
import { parseSSEStream } from '@elsium-ai/client'

const response = await fetch('https://api.example.com/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: 'Hello', stream: true }),
})

for await (const event of parseSSEStream(response)) {
  if (event.type === 'text_delta') {
    process.stdout.write(event.text)
  }
}
```

---

## Server Info

### HealthResponse

```ts
interface HealthResponse {
  status: 'ok' | 'degraded'
  version: string
  uptime: number
  providers: string[]
}
```

### MetricsResponse

```ts
interface MetricsResponse {
  uptime: number
  totalRequests: number
  totalTokens: number
  totalCost: number
  byModel: Record<string, { requests: number; tokens: number; cost: number }>
}
```

### AgentInfo

```ts
interface AgentInfo {
  name: string
  model: string
  tools: string[]
}
```

```ts
const { agents } = await client.agents()
for (const agent of agents) {
  console.log(agent.name, agent.model, agent.tools)
}
```

---

## Types

| Export | Description |
|---|---|
| `ElsiumClient` | Client interface: `chat`, `chatStream`, `complete`, `completeStream`, `health`, `metrics`, `agents` |
| `ClientConfig` | Client options: `baseUrl`, `apiKey?`, `timeout?` |
| `ChatRequest` | Chat input: `message`, `agent?`, `stream?` |
| `ChatResponse` | Chat output: `message`, `usage`, `model`, `traceId` |
| `CompleteRequest` | Completion input: `messages[]`, `model?`, `system?`, `maxTokens?`, `temperature?`, `stream?` |
| `CompleteResponse` | Completion output: `id`, `message`, `model`, `usage`, `cost`, `traceId` |
| `HealthResponse` | Health output: `status`, `version`, `uptime`, `providers` |
| `MetricsResponse` | Metrics output: `uptime`, `totalRequests`, `totalTokens`, `totalCost`, `byModel` |
| `AgentInfo` | Agent descriptor: `name`, `model`, `tools` |
