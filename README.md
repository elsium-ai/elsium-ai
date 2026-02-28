<p align="center">
  <a href="https://github.com/ebutrera9103/elsium-ai" target="blank"><img src="assets/logo.png" width="320" alt="ElsiumAI Logo" /></a>
</p>
<p align="center">A high-performance, TypeScript-first AI framework built on <a href="https://bun.sh" target="blank">Bun</a>.</p>
<p align="center">
  <a href="https://github.com/ebutrera9103/elsium-ai/actions"><img src="https://github.com/ebutrera9103/elsium-ai/workflows/CI/badge.svg" alt="CI"></a>
  <a href="https://github.com/ebutrera9103/elsium-ai/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/tests-382%20passing-brightgreen" alt="Tests">
  <img src="https://img.shields.io/badge/coverage-94.56%25-brightgreen" alt="Coverage">
  <img src="https://img.shields.io/badge/bundle-77KB%20minified-blue" alt="Bundle Size">
</p>

---

## What is ElsiumAI?

ElsiumAI is everything you need to build production AI applications in TypeScript — multi-provider LLM gateway, agents with semantic guardrails, tools, MCP support, RAG, workflows, cost intelligence, and testing — in a single framework with zero magic.

```typescript
import { gateway, defineAgent, defineTool, rag, observe, createMCPClient } from 'elsium-ai'
```

One import. Full type safety. Every LLM call is traceable, inspectable with X-Ray mode, and cost-tracked.

---

## What You Can Build

### Conversational AI agents

Build agents that think, use tools, and maintain conversation memory — with guardrails to keep them on track.

```typescript
import { gateway } from '@elsium-ai/gateway'
import { defineAgent } from '@elsium-ai/agents'
import { defineTool } from '@elsium-ai/tools'

const searchTool = defineTool({
  name: 'search',
  description: 'Search the web for information',
  input: z.object({ query: z.string() }),
  handler: async ({ query }) => {
    const results = await fetchSearchResults(query)
    return { results }
  },
})

const agent = defineAgent(
  {
    name: 'researcher',
    system: 'You are a research assistant. Use tools to find information.',
    model: 'claude-sonnet-4-6',
    tools: [searchTool],
    memory: { strategy: 'sliding-window', maxTokens: 8000 },
    guardrails: {
      maxIterations: 10,
      maxTokenBudget: 100_000,
    },
  },
  { complete: (req) => llm.complete(req) },
)

const result = await agent.run('Find the latest research on RAG architectures')
console.log(result.message.content)
// Every call tracked: result.totalCost, result.traceId, result.latencyMs
```

### RAG pipelines (Retrieval-Augmented Generation)

Load documents, chunk them intelligently, embed them into vectors, and query your knowledge base — all in a few lines.

```typescript
import { rag } from '@elsium-ai/rag'

const pipeline = rag({
  loader: 'markdown',
  chunking: { strategy: 'recursive', maxChunkSize: 512, overlap: 50 },
  embeddings: { provider: 'openai', model: 'text-embedding-3-small' },
})

// Ingest your docs
await pipeline.ingest('product-docs', markdownContent)
await pipeline.ingest('api-reference', apiDocsContent)

// Query with similarity search
const results = await pipeline.query('How do I authenticate API requests?', { topK: 5 })
// results: [{ content: '...', score: 0.94, metadata: { source: 'api-reference' } }, ...]
```

### Multi-step workflows

Chain operations into typed pipelines with retries, parallel execution, conditional branching, and circuit breakers.

```typescript
import { defineWorkflow, step } from '@elsium-ai/workflows'

const processDocument = defineWorkflow({
  name: 'document-processor',
  steps: [
    step('extract', {
      handler: async ({ url }) => {
        const content = await scrape(url)
        return { content }
      },
    }),
    step('analyze', {
      handler: async ({ content }) => {
        const analysis = await agent.run(`Analyze this: ${content}`)
        return { analysis: analysis.message.content }
      },
      retry: { maxAttempts: 3, backoff: 'exponential' },
    }),
    step('store', {
      handler: async ({ analysis }) => {
        await db.insert('analyses', { analysis })
        return { stored: true }
      },
    }),
  ],
})

const result = await processDocument.run({ url: 'https://example.com/paper' })
// result.steps — each step's output, duration, and status
// result.totalDurationMs — end-to-end timing
```

### AI-powered HTTP APIs

Spin up a production-ready API server with built-in CORS, rate limiting, and authentication.

```typescript
import { createApp } from '@elsium-ai/app'

const app = createApp({
  agents: [researcher, writer],
  server: {
    port: 3000,
    cors: true,
    rateLimit: { windowMs: 60_000, max: 100 },
    auth: { type: 'bearer', token: env('API_KEY') },
  },
})

app.listen()
// POST /chat    — conversation with agents
// POST /complete — single LLM completion
// GET  /health  — health check
```

### Multi-agent systems

Coordinate multiple specialized agents — sequentially, in parallel, or with a supervisor that delegates tasks.

```typescript
import { runSequential, runParallel, runSupervisor } from '@elsium-ai/agents'

// Sequential: researcher → writer → editor
const result = await runSequential(
  [researcher, writer, editor],
  'Write a blog post about AI agents',
  { complete: (req) => llm.complete(req) },
)

// Parallel: run multiple agents at the same time
const results = await runParallel(
  [sentimentAgent, summaryAgent, entityAgent],
  articleText,
  { complete: (req) => llm.complete(req) },
)

// Supervisor: one agent delegates to specialists
const result = await runSupervisor(
  managerAgent,
  [researcher, writer, factChecker],
  'Create a fact-checked report on quantum computing',
  { complete: (req) => llm.complete(req) },
)
```

### X-Ray Mode (DevTools for AI)

See the exact request, response, tokens, timing, and cost for every LLM call. Think browser DevTools for AI — no other framework does this.

```typescript
import { gateway } from '@elsium-ai/gateway'

const llm = gateway({
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  apiKey: env('ANTHROPIC_API_KEY'),
  xray: true,  // Enable X-Ray
})

await llm.complete({ messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }] })

// Inspect exactly what happened
const call = llm.lastCall()
// { rawRequest, rawResponse, tokens, durationMs, cost, traceId, model, provider }

// Full history
const history = llm.callHistory()
```

### Smart Provider Mesh

Route requests across multiple LLM providers with intelligent strategies: fallback chains, cost-optimized routing, latency racing, and capability-aware routing.

```typescript
import { createProviderMesh } from '@elsium-ai/gateway'

const mesh = createProviderMesh({
  providers: [
    { name: 'anthropic', config: { apiKey: env('ANTHROPIC_API_KEY') }, priority: 1 },
    { name: 'openai', config: { apiKey: env('OPENAI_API_KEY') }, priority: 2 },
    { name: 'google', config: { apiKey: env('GOOGLE_API_KEY') }, priority: 3 },
  ],
  strategy: 'cost-optimized', // or 'fallback', 'latency-optimized', 'capability-aware'
})

// Automatically routes to the best provider
const result = await mesh.complete({
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
})
```

### Cost Intelligence Engine

Not just tracking — intelligence. Per-user, per-agent, and per-feature budgets with loop detection, projected spend, and cost-saving recommendations.

```typescript
import { createCostEngine } from '@elsium-ai/observe'

const costEngine = createCostEngine({
  dailyBudget: 50,
  perAgent: 10,
  loopDetection: { maxCallsPerMinute: 20, maxCostPerMinute: 2 },
  onAlert: (alert) => console.warn(`Cost alert: ${alert.type}`),
})

// Use as gateway middleware — enforces budgets automatically
const llm = gateway({
  provider: 'anthropic',
  apiKey: env('ANTHROPIC_API_KEY'),
  middleware: [costEngine.middleware()],
})

// Get intelligence report
const report = costEngine.getReport()
// { totalSpend, projectedMonthlySpend, topDimensions, recommendations }
```

### Native MCP Support

First-class Model Context Protocol. Any MCP server becomes an ElsiumAI tool. Any ElsiumAI tool becomes an MCP server.

```typescript
import { createMCPClient, createMCPServer } from '@elsium-ai/mcp'

// Use any MCP server's tools in your agent
const mcp = createMCPClient({
  name: 'github',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-github'],
})
await mcp.connect()
const tools = await mcp.toElsiumTools()

const agent = defineAgent(
  { name: 'dev-agent', system: 'You are a developer assistant.', tools },
  { complete: (req) => llm.complete(req) },
)

// Or expose your tools as an MCP server
const server = createMCPServer({ name: 'my-tools', tools: [myTool1, myTool2] })
await server.start()
```

### Semantic Guardrails

Go beyond schema validation. Detect hallucinations, check factual grounding, and validate response relevance — with auto-retry on failure.

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
        grounding: { enabled: true, sources: facts },
        autoRetry: { enabled: true, maxRetries: 2 },
      },
    },
  },
  { complete: (req) => llm.complete(req) },
)
```

### Full observability with cost tracking

Track every LLM call's cost, latency, and token usage. Export traces to OpenTelemetry backends like Jaeger, Datadog, or Grafana.

```typescript
import { observe } from '@elsium-ai/observe'

const tracer = observe({
  output: ['console', 'json-file'],
  costTracking: true,
})

// All LLM calls are automatically traced
const span = tracer.startSpan('my-pipeline')
// ... do work ...
span.end({ status: 'ok' })

// Get a cost report
const report = tracer.getCostReport()
// { totalCost: 0.0234, totalTokens: 15420, byModel: { 'claude-sonnet-4-6': ... } }

// Export to OpenTelemetry
import { createOTLPExporter } from '@elsium-ai/observe'
const exporter = createOTLPExporter({ endpoint: 'http://localhost:4318' })
await exporter.export(tracer.getSpans())
```

### Deterministic AI testing

Test your AI code without hitting real APIs. Mock providers, record/replay fixtures, run evals, catch prompt regressions, and use LLM-as-judge criteria.

```typescript
import { mockProvider, runEvalSuite, createRegressionSuite, createReplayRecorder } from '@elsium-ai/testing'

test('agent answers correctly', async () => {
  const mock = mockProvider({
    responses: [{ content: 'The capital of France is Paris.' }],
  })

  const agent = defineAgent(
    { name: 'test-agent', system: 'Answer questions accurately.' },
    { complete: mock.complete },
  )

  const result = await agent.run('What is the capital of France?')
  expect(result.message.content).toContain('Paris')
  expect(mock.calls).toHaveLength(1)
})

// Eval framework with LLM-as-judge
const results = await runEvalSuite({
  name: 'quality-check',
  cases: [{
    name: 'helpful-response',
    input: 'How do I reset my password?',
    criteria: [
      { type: 'contains', value: 'password' },
      { type: 'llm_judge', prompt: 'Is this helpful and actionable?', judge: myJudge },
      { type: 'semantic_similarity', reference: 'Click forgot password...', threshold: 0.7 },
    ],
  }],
  runner: (input) => agent.run(input).then(r => extractText(r.message.content)),
})

// Regression detection for CI
const regression = createRegressionSuite('my-agent')
const result = await regression.run(myRunner)
if (result.regressions.length > 0) process.exit(1)

// Deterministic replay
const recorder = createReplayRecorder(llm.complete)
const result = await recorder.complete(request)  // Records the call
await recorder.save('fixtures/my-test.json')
```

### Prompt as Code

Treat prompts like database migrations: versioned, diffable, testable, with template variables.

```typescript
import { createPromptRegistry, definePrompt } from '@elsium-ai/testing'

const registry = createPromptRegistry()

registry.register('classifier', definePrompt({
  name: 'classifier',
  version: '1.0.0',
  content: 'Classify this text into: {{categories}}\n\nText: {{input}}',
  variables: ['categories', 'input'],
}))

registry.register('classifier', definePrompt({
  name: 'classifier',
  version: '1.1.0',
  content: 'You are a text classifier. Categories: {{categories}}\n\nClassify: {{input}}\nRespond with JSON.',
  variables: ['categories', 'input'],
}))

// Diff between versions
const diff = registry.diff('classifier', '1.0.0', '1.1.0')

// Render with variables
const prompt = registry.render('classifier', { categories: 'spam,ham', input: 'Buy now!' })
```

---

## Why ElsiumAI?

| Problem in existing frameworks | ElsiumAI solution |
|---|---|
| Over-abstracted, hard to debug | X-Ray mode — see the exact HTTP request/response for every LLM call |
| Python-only or poor TypeScript support | TypeScript-first with full end-to-end type safety |
| Need 3-4 libraries for one AI app | Single framework, modular packages — use only what you need |
| Poor error messages from LLMs | Structured `Result<T, E>` pattern with retry strategies |
| No cost visibility | Cost Intelligence Engine — budgets, projections, recommendations, loop detection |
| Hard to test AI code | Mock providers, fixtures, evals, LLM-as-judge, regression suites, replay mode |
| Vendor lock-in | Provider Mesh — Anthropic, OpenAI, Google with intelligent routing and fallback |
| No observability standard | OpenTelemetry compatible — export to Jaeger, Datadog, Grafana |
| No MCP support | Native bidirectional MCP — use any MCP server, expose tools as MCP server |
| Hallucination blindness | Semantic guardrails — hallucination detection, grounding checks, auto-retry |
| Prompt versioning chaos | Prompt as Code — versioned, diffable, testable prompt management |
| Streaming breaks on errors | Resilient streaming — checkpoints, partial recovery, timeout support |

---

## Quick Start

```bash
bun add @elsium-ai/core @elsium-ai/gateway @elsium-ai/agents
```

Or install everything at once:

```bash
bun add elsium-ai
```

```typescript
import { gateway } from '@elsium-ai/gateway'
import { defineAgent } from '@elsium-ai/agents'
import { env } from '@elsium-ai/core'

const llm = gateway({
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  apiKey: env('ANTHROPIC_API_KEY'),
})

const agent = defineAgent(
  { name: 'assistant', system: 'You are a helpful assistant.' },
  { complete: (req) => llm.complete(req) },
)

const result = await agent.run('What is TypeScript?')
console.log(result.message.content)
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                       @elsium-ai/app                         │
│               (App bootstrap + HTTP server)                  │
├──────────┬───────────┬──────────┬───────────┬────────────────┤
│ gateway  │  agents   │   rag    │   tools   │   workflows    │
│ (mesh)   │ (guards)  │          │           │                │
├──────────┴───────────┴──────────┼───────────┴────────────────┤
│       @elsium-ai/observe        │        @elsium-ai/mcp      │
│ (Tracing, metrics, cost intel)  │    (Client + Server)       │
├─────────────────────────────────┴────────────────────────────┤
│                      @elsium-ai/core                         │
│       (Types, schemas, errors, utilities, streaming)         │
└──────────────────────────────────────────────────────────────┘
```

## Packages

| Package | Description | Size |
|---------|-------------|------|
| [`@elsium-ai/core`](./packages/core) | Types, errors, resilient streaming, Result pattern, config loader | 5.2 KB |
| [`@elsium-ai/gateway`](./packages/gateway) | Multi-provider LLM gateway with X-Ray, middleware, and provider mesh | 12.4 KB |
| [`@elsium-ai/agents`](./packages/agents) | Agent framework with memory, semantic guardrails, multi-agent | 10.0 KB |
| [`@elsium-ai/tools`](./packages/tools) | Tool definitions with Zod schema validation | 7.0 KB |
| [`@elsium-ai/rag`](./packages/rag) | Document loading, chunking, embeddings, vector search | 9.2 KB |
| [`@elsium-ai/workflows`](./packages/workflows) | Sequential, parallel, and branching workflows | 4.6 KB |
| [`@elsium-ai/observe`](./packages/observe) | Tracing, cost intelligence engine, OpenTelemetry export | 2.9 KB |
| [`@elsium-ai/mcp`](./packages/mcp) | Bidirectional MCP client and server bridge | — |
| [`@elsium-ai/app`](./packages/app) | HTTP server with CORS, auth, rate limiting (Hono) | 17.7 KB |
| [`@elsium-ai/testing`](./packages/testing) | Mock providers, evals, prompt versioning, regression suites, replay | 7.9 KB |
| [`@elsium-ai/cli`](./packages/cli) | CLI for scaffolding, dev server, X-Ray inspection | — |

---

## Feature Comparison

| Feature | ElsiumAI | LangChain | Vercel AI SDK | LlamaIndex |
|---------|----------|-----------|---------------|------------|
| Language | TypeScript-first | Python (JS port) | TypeScript | Python (TS port) |
| Runtime | Bun | Node/Python | Node | Python |
| Type Safety | Full end-to-end | Partial | Good | Partial |
| Bundle Size | 77 KB | ~2 MB | ~150 KB | ~3 MB |
| Cold Start | < 3ms | ~500ms | ~50ms | ~800ms |
| X-Ray Mode (DevTools) | Yes | No | No | No |
| Multi-Provider Mesh | Yes (Anthropic, OpenAI, Google) | Yes | Yes | Yes |
| Cost Intelligence | Yes (budgets, projections, loop detection) | No | No | No |
| MCP Support | Yes (bidirectional) | Partial | No | No |
| Semantic Guardrails | Yes (hallucination, grounding, relevance) | No | No | No |
| Prompt Versioning | Yes (diff, template, registry) | No (LangSmith) | No | No |
| Resilient Streaming | Yes (checkpoints, recovery) | No | No | No |
| Built-in Tracing | Yes (OTel) | LangSmith (paid) | No | No |
| LLM-as-Judge Evals | Yes | No | No | LlamaIndex evals |
| Regression Detection | Yes | No | No | No |
| Deterministic Replay | Yes | No | No | No |
| Mock Providers | Yes | No | No | No |
| RAG Pipeline | Yes | Yes | No | Yes |
| Agent Framework | Yes | Yes | Partial | Yes |
| Tool System | Zod-validated | Dynamic | Zod-validated | Dynamic |
| Streaming | Native async iterables | Callbacks | ReadableStream | Callbacks |
| Modular (use what you need) | Yes | No (monolithic) | Partial | No (monolithic) |

---

## Performance

Benchmarked on Apple Silicon (M-series):

| Metric | Result | Target |
|--------|--------|--------|
| Cold Start (all packages) | ~2ms | < 50ms |
| Completion overhead | ~0.003ms | < 5ms |
| Throughput | ~400K ops/sec | — |
| Memory (per agent) | < 1 KB | < 10 MB |
| Core bundle | 5.2 KB | < 50 KB |
| Full bundle | 76.9 KB | < 200 KB |

```bash
bun benchmarks/run-all.ts
```

---

## Examples

| Example | Description | API Key Required |
|---------|-------------|:---:|
| [`chatbot`](./examples/chatbot) | Interactive conversation with memory and cost tracking | Yes |
| [`rag-app`](./examples/rag-app) | Knowledge base with document chunking and vector search | No |
| [`multi-agent`](./examples/multi-agent) | Sequential, parallel, and workflow agent pipelines | No |
| [`api-server`](./examples/api-server) | HTTP API with tools, multiple agents, and middleware | Optional |
| [`mcp-integration`](./examples/mcp-integration) | Bidirectional MCP bridge — client and server modes | Optional |
| [`cost-tracking`](./examples/cost-tracking) | Cost intelligence engine with budgets and recommendations | No |

```bash
bun examples/multi-agent/index.ts
bun examples/rag-app/index.ts
bun examples/mcp-integration/index.ts client
bun examples/cost-tracking/index.ts
```

---

## Core Principles

1. **Zero magic** — no hidden behavior, no decorators, no reflection
2. **Type safety end-to-end** — from config to LLM output
3. **Performance by default** — streaming, caching, connection pooling
4. **Debuggable** — every LLM call has a trace ID, cost, and latency
5. **Modular** — use only what you need, tree-shakeable
6. **Test-first** — mock providers, deterministic fixtures, eval tools

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and guidelines.

## Author

Created and maintained by **Eric Utrera** ([@ebutrera9103](https://github.com/ebutrera9103)).

## License

[MIT](./LICENSE) - Copyright (c) 2026 Eric Utrera
