# @elsium-ai/client

TypeScript HTTP client for consuming ElsiumAI servers, with full SSE streaming support.

[![npm](https://img.shields.io/npm/v/@elsium-ai/client.svg)](https://www.npmjs.com/package/@elsium-ai/client)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE)

---

## Install

```bash
npm install @elsium-ai/client
```

---

## What's Inside

| Category | Exports |
|----------|---------|
| **Client** | `createClient` |
| **Types** | `ElsiumClient`, `ClientConfig`, `ChatRequest`, `ChatResponse`, `CompleteRequest`, `CompleteResponse`, `HealthResponse`, `MetricsResponse`, `AgentInfo` |
| **SSE** | `parseSSEStream` |

---

## Usage

### Creating a client

```typescript
import { createClient } from '@elsium-ai/client'

const client = createClient({
  baseUrl: 'http://localhost:3000',
  apiKey: 'my-api-token',       // Optional — sent as Authorization: Bearer header
  timeout: 30_000,               // Optional — request timeout in ms
})
```

### Chat with an agent

```typescript
const response = await client.chat({
  agent: 'support-agent',
  message: 'How do I return my order?',
})

console.log(response.message)  // Agent's response text
```

### Raw LLM completion

```typescript
const response = await client.complete({
  messages: [{ role: 'user', content: 'Explain TypeScript generics.' }],
  model: 'claude-sonnet-4-6',
})

console.log(response.message)
console.log(response.usage)    // { inputTokens, outputTokens, totalTokens }
```

### Streaming (SSE)

```typescript
// Stream chat responses
for await (const event of client.chatStream({
  agent: 'support-agent',
  message: 'Write a poem about coding',
})) {
  if (event.type === 'text_delta') {
    process.stdout.write(event.text)
  } else if (event.type === 'message_end') {
    console.log('\nDone:', event.usage)
  }
}

// Stream completions
for await (const event of client.completeStream({
  messages: [{ role: 'user', content: 'Count to 10 slowly' }],
})) {
  if (event.type === 'text_delta') {
    process.stdout.write(event.text)
  }
}
```

### Health check

```typescript
const health = await client.health()
console.log(health.status) // 'ok'
```

### List agents

```typescript
const agents = await client.agents()
for (const agent of agents) {
  console.log(`${agent.name}: ${agent.description}`)
}
```

### Metrics

```typescript
const metrics = await client.metrics()
console.log(metrics)
```

---

## SSE Parser

Use the SSE parser standalone to parse any Server-Sent Events response:

```typescript
import { parseSSEStream } from '@elsium-ai/client'

const response = await fetch('http://localhost:3000/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ agent: 'assistant', message: 'Hello', stream: true }),
})

for await (const event of parseSSEStream(response)) {
  console.log(event.type, event)
}
```

---

## ElsiumClient Interface

```typescript
interface ElsiumClient {
  chat(req: ChatRequest): Promise<ChatResponse>
  chatStream(req: ChatRequest): AsyncIterable<StreamEvent>
  complete(req: CompleteRequest): Promise<CompleteResponse>
  completeStream(req: CompleteRequest): AsyncIterable<StreamEvent>
  health(): Promise<HealthResponse>
  metrics(): Promise<MetricsResponse>
  agents(): Promise<AgentInfo[]>
}
```

---

## License

[MIT](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE) - Copyright (c) 2026 Eric Utrera
