# Getting Started with ElsiumAI

A quick guide to building your first AI application with ElsiumAI.

## Prerequisites

- [Bun](https://bun.sh) v1.3+
- An API key from [Anthropic](https://console.anthropic.com/), [OpenAI](https://platform.openai.com/), or [Google](https://aistudio.google.com/)

## Create a Project

The fastest way to get started:

```bash
# Install the CLI globally
bun add -g @elsium-ai/cli

# Scaffold a new project
elsium init my-app
cd my-app

# Configure your API key
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY

# Install dependencies
bun install

# Start development
bun run dev
```

This creates a project with:

```
my-app/
├── src/
│   └── index.ts       # App entry point with example agent
├── package.json
├── tsconfig.json
├── .env.example
└── .gitignore
```

## Manual Setup

If you prefer to set things up yourself:

```bash
mkdir my-app && cd my-app
bun init -y

bun add @elsium-ai/core @elsium-ai/gateway @elsium-ai/agents @elsium-ai/tools @elsium-ai/app @elsium-ai/mcp
bun add -d @elsium-ai/testing typescript
```

## Your First Agent

Create `src/index.ts`:

```typescript
import { gateway } from '@elsium-ai/gateway'
import { defineAgent } from '@elsium-ai/agents'
import { env } from '@elsium-ai/core'

// 1. Create a gateway to your LLM provider (Anthropic, OpenAI, or Google)
const llm = gateway({
  provider: 'anthropic',  // or 'openai' or 'google'
  model: 'claude-sonnet-4-6',
  apiKey: env('ANTHROPIC_API_KEY'),
  xray: true,  // Enable X-Ray to inspect every LLM call
})

// 2. Define an agent
const assistant = defineAgent(
  {
    name: 'assistant',
    system: 'You are a helpful AI assistant.',
    model: 'claude-sonnet-4-6',
  },
  { complete: (req) => llm.complete(req) },
)

// 3. Run the agent
const result = await assistant.run('What is TypeScript?')
console.log(result.message.content)

// 4. Inspect the call with X-Ray
console.log(llm.lastCall())  // { rawRequest, rawResponse, tokens, durationMs, cost }
```

Run it:

```bash
bun src/index.ts
```

## Adding Tools

Give your agent capabilities with tools:

```typescript
import { defineTool, createToolkit } from '@elsium-ai/tools'
import { z } from 'zod'

const weatherTool = defineTool({
  name: 'get_weather',
  description: 'Get current weather for a city',
  parameters: z.object({
    city: z.string().describe('City name'),
  }),
  execute: async ({ city }) => {
    // Call your weather API here
    return { temperature: 22, condition: 'sunny', city }
  },
})

const tools = createToolkit([weatherTool])

const agent = defineAgent(
  {
    name: 'weather-assistant',
    system: 'You help users check the weather. Use the get_weather tool when asked.',
    model: 'claude-sonnet-4-6',
    tools: tools.definitions(),
  },
  {
    complete: (req) => llm.complete(req),
    executeTool: (name, args) => tools.execute(name, args),
  },
)

const result = await agent.run('What is the weather in Tokyo?')
console.log(result.message.content)
```

## Building a Server

Expose your agent as an HTTP API:

```typescript
import { createApp } from '@elsium-ai/app'
import { defineAgent } from '@elsium-ai/agents'
import { env } from '@elsium-ai/core'

const assistant = defineAgent(
  {
    name: 'assistant',
    system: 'You are a helpful AI assistant.',
    model: 'claude-sonnet-4-6',
  },
  { complete: (req) => llm.complete(req) },
)

const app = createApp({
  gateway: {
    providers: {
      anthropic: { apiKey: env('ANTHROPIC_API_KEY') },
    },
    defaultModel: 'claude-sonnet-4-6',
  },
  agents: [assistant],
  observe: {
    tracing: true,
    costTracking: true,
  },
  server: {
    port: 3000,
  },
})

app.listen()
```

This gives you:

| Endpoint | Description |
|---|---|
| `GET /health` | Health check |
| `GET /metrics` | Token usage and cost metrics |
| `POST /chat` | Send a message to an agent |
| `POST /complete` | Raw LLM completion |
| `GET /agents` | List registered agents |

### Chat with your agent

```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Hello!",
    "agent": "assistant"
  }'
```

## Observability

ElsiumAI includes built-in tracing and cost tracking:

```typescript
import { observe } from '@elsium-ai/observe'

const tracer = observe({
  serviceName: 'my-app',
  exporters: [{ type: 'console' }],
})

// Wrap any operation in a span
const span = tracer.startSpan('agent.run', { kind: 'agent' })
const result = await assistant.run('Hello')
span.setStatus('ok')
span.end()

// Check costs
const report = tracer.getCostReport()
console.log(`Total cost: $${report.totalCost.toFixed(4)}`)
```

### CLI Inspector

After running your app with tracing and X-Ray enabled:

```bash
# X-Ray: inspect the last LLM call
elsium xray

# X-Ray: inspect last N calls
elsium xray --last 5

# X-Ray: show raw request/response
elsium xray --raw

# List recent traces
elsium trace

# Inspect a specific trace
elsium trace trc_abc123

# View cost report
elsium cost

# Prompt management
elsium prompt list
elsium prompt diff classifier 1.0.0 1.1.0
```

## Testing

ElsiumAI provides first-class testing support:

```typescript
import { describe, it, expect } from 'vitest'
import { mockProvider } from '@elsium-ai/testing'
import { defineAgent } from '@elsium-ai/agents'

describe('my agent', () => {
  it('should answer questions', async () => {
    const mock = mockProvider({
      responses: [
        { content: 'TypeScript is a typed superset of JavaScript.' },
      ],
    })

    const agent = defineAgent(
      {
        name: 'test-agent',
        system: 'Answer questions accurately.',
        model: 'mock',
      },
      { complete: (req) => mock.complete(req) },
    )

    const result = await agent.run('What is TypeScript?')
    expect(result.message.content).toContain('TypeScript')
    expect(mock.getCalls()).toHaveLength(1)
  })
})
```

### Evaluation Suites

Score your LLM outputs against criteria, including LLM-as-judge:

```typescript
import { runEvalSuite } from '@elsium-ai/testing'

const results = await runEvalSuite({
  name: 'quality-check',
  cases: [
    {
      name: 'factual-answer',
      input: 'What is the capital of France?',
      criteria: [
        { type: 'contains', value: 'Paris' },
        { type: 'semantic_similarity', reference: 'Paris is the capital of France', threshold: 0.7 },
      ],
    },
    {
      name: 'helpful-response',
      input: 'How do I reset my password?',
      criteria: [
        { type: 'llm_judge', prompt: 'Is this helpful and actionable?', judge: myJudge },
      ],
    },
  ],
  runner: async (input) => {
    const result = await agent.run(input)
    return extractText(result.message.content)
  },
})
```

### Regression Detection

Catch quality regressions in CI:

```typescript
import { createRegressionSuite } from '@elsium-ai/testing'

const regression = createRegressionSuite('my-agent')
await regression.load('.elsium/baselines/my-agent.json')
const result = await regression.run(myRunner)

if (result.regressions.length > 0) process.exit(1)  // Fail CI on regression
```

### Prompt Versioning

Track prompt changes with diffs and template variables:

```typescript
import { createPromptRegistry, definePrompt } from '@elsium-ai/testing'

const registry = createPromptRegistry()
registry.register('classifier', definePrompt({
  name: 'classifier',
  version: '1.0.0',
  content: 'Classify: {{input}} into {{categories}}',
  variables: ['input', 'categories'],
}))

const diff = registry.diff('classifier', '1.0.0', '1.1.0')
const prompt = registry.render('classifier', { input: 'Hello', categories: 'greeting,question' })
```

### Deterministic Replay

Record LLM interactions and replay them in tests:

```typescript
import { createReplayRecorder, createReplayPlayer } from '@elsium-ai/testing'

// Record
const recorder = createReplayRecorder(llm.complete)
await recorder.complete(request)
await recorder.save('fixtures/my-test.json')

// Replay (no API calls)
const player = createReplayPlayer()
await player.load('fixtures/my-test.json')
const result = await player.complete(request)
```

Run evals from the CLI:

```bash
elsium eval ./evals/quality.ts
```

## RAG (Retrieval-Augmented Generation)

Build a knowledge base from your documents:

```typescript
import { rag } from '@elsium-ai/rag'

const pipeline = rag({
  loader: { type: 'markdown' },
  chunker: { type: 'recursive', chunkSize: 512, overlap: 50 },
  embeddings: {
    provider: 'openai',
    model: 'text-embedding-3-small',
    apiKey: env('OPENAI_API_KEY'),
  },
  store: { type: 'memory' },
})

// Ingest documents
await pipeline.ingest('# ElsiumAI\n\nA TypeScript-first AI framework...', {
  source: 'readme.md',
})

// Query
const results = await pipeline.query('What is ElsiumAI?', { topK: 3 })
for (const result of results) {
  console.log(`[${result.score.toFixed(2)}] ${result.chunk.content}`)
}
```

## Workflows

Chain operations together:

```typescript
import { defineWorkflow, step } from '@elsium-ai/workflows'

const pipeline = defineWorkflow({
  name: 'content-pipeline',
  steps: [
    step({
      name: 'research',
      execute: async (ctx) => {
        const result = await agent.run(`Research: ${ctx.input}`)
        return result.message.content
      },
    }),
    step({
      name: 'draft',
      execute: async (ctx) => {
        const result = await agent.run(`Write a draft based on: ${ctx.input}`)
        return result.message.content
      },
    }),
    step({
      name: 'review',
      execute: async (ctx) => {
        const result = await agent.run(`Review and improve: ${ctx.input}`)
        return result.message.content
      },
    }),
  ],
})

const result = await pipeline.execute('AI in healthcare')
console.log(result.output)
```

## Multi-Provider Support

ElsiumAI supports Anthropic, OpenAI, and Google out of the box. Swap providers by changing one line:

```typescript
// Anthropic
const llm = gateway({ provider: 'anthropic', model: 'claude-sonnet-4-6', apiKey: env('ANTHROPIC_API_KEY') })

// OpenAI
const llm = gateway({ provider: 'openai', model: 'gpt-4o', apiKey: env('OPENAI_API_KEY') })

// Google
const llm = gateway({ provider: 'google', model: 'gemini-2.0-flash', apiKey: env('GOOGLE_API_KEY') })
```

### Provider Mesh

Route across multiple providers with intelligent fallback, cost optimization, or latency racing:

```typescript
import { createProviderMesh } from '@elsium-ai/gateway'

const mesh = createProviderMesh({
  providers: [
    { name: 'anthropic', config: { apiKey: env('ANTHROPIC_API_KEY') }, priority: 1 },
    { name: 'openai', config: { apiKey: env('OPENAI_API_KEY') }, priority: 2 },
  ],
  strategy: 'fallback', // or 'cost-optimized', 'latency-optimized', 'capability-aware'
})

const result = await mesh.complete({
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
})
```

## MCP (Model Context Protocol)

Use any MCP server's tools in your agents, or expose your tools as an MCP server:

```typescript
import { createMCPClient } from '@elsium-ai/mcp'

// Connect to an MCP server
const mcp = createMCPClient({
  name: 'github',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-github'],
})
await mcp.connect()

// Convert MCP tools to ElsiumAI tools
const tools = await mcp.toElsiumTools()

// Use them in an agent
const agent = defineAgent(
  { name: 'dev-agent', system: 'You are a developer assistant.', tools },
  { complete: (req) => llm.complete(req) },
)
```

Expose your own tools as an MCP server:

```typescript
import { createMCPServer } from '@elsium-ai/mcp'

const server = createMCPServer({
  name: 'my-tools',
  tools: [weatherTool, calculatorTool],
})
await server.start()  // Listens on stdio
```

## Cost Intelligence

Track and control LLM spending with budgets, loop detection, and recommendations:

```typescript
import { createCostEngine } from '@elsium-ai/observe'

const costEngine = createCostEngine({
  dailyBudget: 50,
  perAgent: 10,
  loopDetection: { maxCallsPerMinute: 20, maxCostPerMinute: 2 },
  onAlert: (alert) => console.warn(`Cost alert: ${alert.type}`),
})

// Add as middleware — budgets are enforced automatically
const llm = gateway({
  provider: 'anthropic',
  apiKey: env('ANTHROPIC_API_KEY'),
  middleware: [costEngine.middleware()],
})

// Get intelligence report
const report = costEngine.getReport()
console.log(`Projected monthly: $${report.projectedMonthlySpend.toFixed(2)}`)
console.log('Recommendations:', report.recommendations)
```

## Semantic Guardrails

Add hallucination detection, factual grounding, and relevance checks to your agents:

```typescript
const agent = defineAgent(
  {
    name: 'research-agent',
    system: 'Answer questions based on provided context.',
    guardrails: {
      maxIterations: 10,
      semantic: {
        hallucination: { enabled: true, ragContext: docs, threshold: 0.7 },
        relevance: { enabled: true, threshold: 0.5 },
        autoRetry: { enabled: true, maxRetries: 2 },
      },
    },
  },
  { complete: (req) => llm.complete(req) },
)
```

When a semantic check fails and `autoRetry` is enabled, the agent automatically re-runs with corrective instructions.

## AI Security Layer

Protect your agents against prompt injection, jailbreak attempts, and secret leakage:

```typescript
import { securityMiddleware } from '@elsium-ai/gateway'

// Gateway-level security
const llm = gateway({
  provider: 'anthropic',
  apiKey: env('ANTHROPIC_API_KEY'),
  middleware: [
    securityMiddleware({
      promptInjection: true,
      jailbreakDetection: true,
      secretRedaction: true,
    }),
  ],
})

// Agent-level security
const agent = defineAgent(
  {
    name: 'secure-agent',
    system: 'You are a helpful assistant.',
    guardrails: {
      security: {
        detectPromptInjection: true,
        detectJailbreak: true,
        redactSecrets: true,
      },
    },
  },
  { complete: (req) => llm.complete(req) },
)
```

Security scans input for injection/jailbreak patterns and redacts secrets (API keys, SSNs, credit cards, Bearer tokens) from output.

## Confidence Scoring

Get confidence scores on every agent result:

```typescript
const agent = defineAgent(
  {
    name: 'confident-agent',
    system: 'Answer questions accurately.',
    confidence: {
      hallucinationRisk: true,
      relevanceScore: true,
    },
  },
  { complete: (req) => llm.complete(req) },
)

const result = await agent.run('What is TypeScript?')
console.log(result.confidence?.overall)          // 0.85
console.log(result.confidence?.hallucinationRisk) // 0.1
console.log(result.confidence?.relevanceScore)    // 0.9
```

When combined with semantic guardrails, confidence scores are derived from the semantic validation results for higher accuracy.

## Agent State Machines

Build multi-turn conversational flows with explicit state transitions:

```typescript
const agent = defineAgent(
  {
    name: 'support-bot',
    system: 'You are a support agent.',
    initialState: 'greet',
    states: {
      greet: {
        system: 'Greet the user warmly.',
        transition: (result) => 'help',
      },
      help: {
        system: 'Help with their question.',
        tools: [searchTool],
        transition: () => 'resolve',
      },
      resolve: {
        system: 'Summarize and close.',
        terminal: true,
        transition: () => 'resolve',
      },
    },
  },
  { complete: (req) => llm.complete(req) },
)

const result = await agent.run('I need help')
console.log(result.finalState)    // 'resolve'
console.log(result.stateHistory)  // Full trace of transitions
```

Each state can override the system prompt, available tools, and guardrails. A single conversation history is maintained across all states.

## Packages

| Package | Description |
|---|---|
| `@elsium-ai/core` | Types, errors, resilient streaming, utilities |
| `@elsium-ai/gateway` | Multi-provider LLM gateway (Anthropic, OpenAI, Google) with X-Ray, provider mesh, and security middleware |
| `@elsium-ai/agents` | Agent framework with memory, semantic guardrails, security, confidence, state machines, multi-agent |
| `@elsium-ai/tools` | Tool definitions with Zod validation |
| `@elsium-ai/rag` | Document loading, chunking, embeddings, vector search |
| `@elsium-ai/workflows` | Sequential, parallel, and branching workflows |
| `@elsium-ai/observe` | Tracing, metrics, cost intelligence engine, OpenTelemetry export |
| `@elsium-ai/mcp` | Bidirectional MCP client and server bridge |
| `@elsium-ai/app` | HTTP server with middleware (CORS, auth, rate limiting) |
| `@elsium-ai/testing` | Mock providers, evals, prompt versioning, regression suites, replay |
| `@elsium-ai/cli` | CLI tool for scaffolding, X-Ray inspection, prompt management |

## Next Steps

- Read the [API Reference](./api-reference/) for detailed type documentation
- Check the cookbook for common patterns (multi-agent systems, streaming, structured output)
- Join the community and share what you build
