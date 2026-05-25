# Getting Started with ElsiumAI

A quick guide to building your first AI application with ElsiumAI.

## Prerequisites

- [Node.js](https://nodejs.org) v20+ (or [Bun](https://bun.sh) v1.3+)
- An API key from [Anthropic](https://console.anthropic.com/), [OpenAI](https://platform.openai.com/), or [Google](https://aistudio.google.com/)

## Create a Project

The fastest way to get started:

```bash
# Install the CLI globally
npm install -g @elsium-ai/cli

# Scaffold a new project
elsium init my-app
cd my-app

# Configure your API key
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY

# Install dependencies
npm install

# Start development
npm run dev
```

This creates a project with:

```
my-app/
├── src/
│   ├── index.ts                  # Entry point — boots server
│   ├── agents/
│   │   └── assistant.ts          # Agent with guardrails + confidence
│   ├── tools/
│   │   └── example.ts            # Calculator tool with Zod schema
│   ├── policies/
│   │   └── default.ts            # Policy set — model allowlist + cost limit
│   ├── gateway/
│   │   └── mesh.ts               # Provider mesh with circuit breaker
│   └── workflows/
│       └── example.ts            # 2-step workflow
├── evals/
│   ├── quality.eval.ts           # Quality eval suite
│   └── determinism.eval.ts       # Determinism assertion
├── test/
│   └── agents/
│       └── assistant.test.ts     # Unit test with mockProvider + replay
├── .elsium/
│   ├── baselines/.gitkeep
│   └── recordings/.gitkeep
├── .env.example
├── .gitignore
├── biome.json
├── tsconfig.json
├── package.json
├── elsium.config.ts              # Central config (satisfies AppConfig)
└── README.md
```

## Manual Setup

If you prefer to set things up yourself:

```bash
mkdir my-app && cd my-app
npm init -y

npm install @elsium-ai/core @elsium-ai/gateway @elsium-ai/agents @elsium-ai/tools @elsium-ai/app @elsium-ai/mcp
npm install -D @elsium-ai/testing typescript
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

// 4. Or stream the response in real-time
const stream = assistant.stream('Explain TypeScript in detail')
for await (const event of stream) {
  if (event.type === 'text_delta') process.stdout.write(event.text)
}

// 5. Inspect the call with X-Ray
console.log(llm.lastCall())  // { traceId, provider, model, latencyMs, request, response, usage, cost }
```

> **Note:** Streaming requires a `stream` function in dependencies. When using an `LLMProvider` object or `provider` + `apiKey` config, streaming is auto-configured.

Run it:

```bash
npx tsx src/index.ts
```

## Adding Tools

Give your agent capabilities with tools:

```typescript
import { defineTool, createToolkit } from '@elsium-ai/tools'
import { z } from 'zod'

const weatherTool = defineTool({
  name: 'get_weather',
  description: 'Get current weather for a city',
  input: z.object({
    city: z.string().describe('City name'),
  }),
  handler: async ({ city }) => {
    // Call your weather API here
    return { temperature: 22, condition: 'sunny', city }
  },
})

const tools = createToolkit('weather', [weatherTool])

const agent = defineAgent(
  {
    name: 'weather-assistant',
    system: 'You help users check the weather. Use the get_weather tool when asked.',
    model: 'claude-sonnet-4-6',
    tools: [...tools.tools],
  },
  {
    complete: (req) => llm.complete(req),
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
| `POST /chat` | Send a message to an agent (supports SSE streaming) |
| `POST /complete` | Raw LLM completion (supports SSE streaming) |
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

### Streaming responses (SSE)

Add `"stream": true` to get real-time Server-Sent Events:

```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Write a poem",
    "agent": "assistant",
    "stream": true
  }'
# Response: text/event-stream with incremental text deltas
```

### Using the Client SDK

Consume your server from TypeScript:

```typescript
import { createClient } from '@elsium-ai/client'

const client = createClient({
  baseUrl: 'http://localhost:3000',
})

// Simple chat
const response = await client.chat({ agent: 'assistant', message: 'Hello!' })
console.log(response.message)

// Streaming chat
for await (const event of client.chatStream({ agent: 'assistant', message: 'Write a poem' })) {
  if (event.type === 'text_delta') process.stdout.write(event.text)
}
```

## Structured Output

Get typed, validated JSON responses from any provider:

```typescript
import { z } from 'zod'

const SentimentSchema = z.object({
  sentiment: z.enum(['positive', 'negative', 'neutral']),
  confidence: z.number(),
})

const { object } = await llm.generateObject({
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Analyze: "I love this!"' }] }],
  schema: SentimentSchema,
})

console.log(object.sentiment)   // 'positive' (fully typed)
console.log(object.confidence)  // 0.95
```

Each provider uses its native JSON mode (OpenAI: `json_schema`, Anthropic: tool-use, Google: `responseSchema`).

One-shot without a gateway instance — pass provider + apiKey + a `prompt` shorthand:

```typescript
import { generateObject } from 'elsium-ai'

const { object } = await generateObject({
  provider: 'openai',
  apiKey: process.env.OPENAI_API_KEY!,
  schema: SentimentSchema,
  prompt: 'Analyze: "I love this!"',
})
```

## Observability

ElsiumAI includes built-in tracing and cost tracking:

```typescript
import { observe } from '@elsium-ai/observe'

const tracer = observe({
  output: ['console'],
  costTracking: true,
})

// Wrap any operation in a span
const span = tracer.startSpan('agent.run', 'agent')
const result = await assistant.run('Hello')
span.end({ status: 'ok' })

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
    expect(mock.calls).toHaveLength(1)
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
const recorder = createReplayRecorder()
const wrappedComplete = recorder.wrap(llm.complete.bind(llm))
await wrappedComplete(request)
const recordings = recorder.toJSON()

// Replay (no API calls)
const player = createReplayPlayer(recordings)
const result = await player.complete(request)
```

Run evals from the CLI:

```bash
elsium eval ./evals/quality.ts
```

### Multi-Turn Conversation Testing

Test full agent conversations with per-turn assertions:

```typescript
import { runConversation, formatConversationReport } from '@elsium-ai/testing'

const result = await runConversation({
  name: 'support-flow',
  turns: [
    {
      role: 'user',
      content: 'I need help resetting my password',
      assertions: [
        { type: 'response_contains', value: 'email' },
        { type: 'tool_called', name: 'lookupUser' },
      ],
    },
    {
      role: 'user',
      content: 'My email is user@example.com',
      assertions: [
        { type: 'tool_called', name: 'sendResetEmail' },
        { type: 'response_contains', value: 'sent' },
      ],
    },
  ],
  runner: (messages) => agent.chat(messages),
})

console.log(formatConversationReport(result))
```

### Tool Call Assertions

Assert on which tools an agent called and with what arguments:

```typescript
import { assertToolCalls } from '@elsium-ai/testing'

const results = assertToolCalls(agentResult.toolCalls, [
  { type: 'called', name: 'search', times: 1 },
  { type: 'called_with', name: 'search', args: { query: 'weather' } },
  { type: 'called_in_order', names: ['search', 'format'] },
  { type: 'all_succeeded' },
])
```

### Red Team (Adversarial Testing)

Test your agent against 44 built-in attack probes (36 single-turn + 8 multi-turn):

```typescript
import { runRedTeam, formatRedTeamReport } from '@elsium-ai/testing'

const result = await runRedTeam({
  name: 'security-audit',
  runner: async (input) => {
    const r = await agent.run(input)
    return extractText(r.message.content)
  },
  multiTurnRunner: (messages) => agent.chat(messages),
  categories: ['prompt_injection', 'jailbreak'],
})

console.log(formatRedTeamReport(result))
```

### Unified Agent Eval

Mix single-turn and multi-turn cases in one eval suite:

```typescript
import { runAgentEval, formatAgentEvalReport } from '@elsium-ai/testing'

const result = await runAgentEval({
  name: 'full-eval',
  cases: [
    { type: 'single', name: 'factual', input: 'Capital of France?', criteria: [{ type: 'contains', value: 'Paris' }] },
    { type: 'conversation', name: 'booking', turns: [
      { role: 'user', content: 'Book a flight', assertions: [{ type: 'tool_called', name: 'search' }] },
      { role: 'user', content: 'Pick the cheapest', assertions: [{ type: 'tool_called', name: 'book' }] },
    ]},
  ],
  singleTurnRunner: async (input) => extractText((await agent.run(input)).message.content),
  multiTurnRunner: (messages) => agent.chat(messages),
})

console.log(formatAgentEvalReport(result))
```

### CI Integration

Output eval results in CI-compatible formats:

```bash
elsium eval ./evals/suite.ts --format junit     # JUnit XML
elsium eval ./evals/suite.ts --format github    # GitHub Actions annotations
elsium eval ./evals/suite.ts --format markdown  # Markdown summary
```

## RAG (Retrieval-Augmented Generation)

Build a knowledge base from your documents:

```typescript
import { rag } from '@elsium-ai/rag'

const pipeline = rag({
  loader: 'markdown',
  chunking: { strategy: 'recursive', maxChunkSize: 512, overlap: 50 },
  embeddings: {
    provider: 'openai',
    model: 'text-embedding-3-small',
    apiKey: env('OPENAI_API_KEY'),
  },
})

// Ingest documents
await pipeline.ingest('readme.md', '# ElsiumAI\n\nA TypeScript-first AI framework...')

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
    step('research', {
      handler: async (input) => {
        const result = await agent.run(`Research: ${input}`)
        return result.message.content
      },
    }),
    step('draft', {
      handler: async (input) => {
        const result = await agent.run(`Write a draft based on: ${input}`)
        return result.message.content
      },
    }),
    step('review', {
      handler: async (input) => {
        const result = await agent.run(`Review and improve: ${input}`)
        return result.message.content
      },
    }),
  ],
})

const result = await pipeline.run('AI in healthcare')
console.log(result.outputs['review'])
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
    { name: 'anthropic', config: { apiKey: env('ANTHROPIC_API_KEY') } },
    { name: 'openai', config: { apiKey: env('OPENAI_API_KEY') } },
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

## Verifiable Agent Execution

Capture an agent run as a signed `ExecutionProof` that any third party can verify offline:

```typescript
import {
  createEd25519Signer,
  createFileWriteOnceStore,
  generateEd25519KeyPair,
} from '@elsium-ai/core'
import { gateway } from '@elsium-ai/gateway'
import { PROOF_SESSION_METADATA_KEY, createProofRecorder } from '@elsium-ai/observe'

const pair = generateEd25519KeyPair()
const signer = createEd25519Signer({ privateKey: pair.privateKey, keyId: 'org-k1' })
const recorder = createProofRecorder({ signer })

const llm = gateway({
  provider: 'anthropic',
  apiKey: env('ANTHROPIC_API_KEY'),
  middleware: [recorder.middleware()],
})

const session = recorder.startSession({ agentId: 'invoice-extractor' })
await llm.complete({
  messages: [{ role: 'user', content: '...' }],
  metadata: { [PROOF_SESSION_METADATA_KEY]: session.proofId },
})
const proof = await session.finalize({
  store: createFileWriteOnceStore({ dir: './proofs' }),
})

// Later, on another machine — no API keys needed:
//   elsium verify ./proofs/<proofId>.json --public-key org.pub
```

See [`examples/verifiable-agent-execution/`](../examples/verifiable-agent-execution/) for the full demo.

## Capability Tokens

Mint an Ed25519-signed token that scopes what an agent run can touch — tools, LLM providers, MCP servers, RAG stores, data classes — and gate every execution point with the same `{ token, verifier?, onDeny? }` shape:

```typescript
import { createCapabilityIssuer, createEd25519Signer } from '@elsium-ai/core'
import { withCapability } from '@elsium-ai/tools'
import { capabilityMiddleware } from '@elsium-ai/gateway'

const issuer = createCapabilityIssuer({ signer, orgId: 'aperion-gaming' })
const token = issuer.mint({
  subject: { agent: 'support-bot' },
  capabilities: [
    { kind: 'tool', name: 'customer.read', constraints: { allowedFields: ['name', 'email'] } },
    { kind: 'llm', provider: 'anthropic', maxCost: 0.5 },
  ],
  dataClasses: { denied: ['pii', 'financial'] },
})

const guardedTool = withCapability(myTool, { token, verifier })
const llm = gateway({
  provider: 'anthropic',
  apiKey: '...',
  middleware: [capabilityMiddleware({ token, verifier })],
})
```

Delegation (strict-subset child tokens) and revocation are first-class. See [`examples/capability-tokens/`](../examples/capability-tokens/).

## Verification + Confidence (VAG + CAG)

`runWithVerification` enforces correctness with a repair loop; `requireConfidence` enforces calibrated certainty with a runtime threshold gate. Compose them:

```typescript
import {
  runWithVerification,
  requireConfidence,
  selfConsistency,
  zodValidator,
} from '@elsium-ai/agents'

const verified = await runWithVerification(
  async (repair) => {
    const messages = [
      ...baseMessages,
      ...(repair ? [{ role: 'user' as const, content: repair.repairPrompt }] : []),
    ]
    const { object } = await llm.generateObject({ messages, schema: MySchema })
    return object
  },
  { validators: [zodValidator(MySchema)], maxRepairs: 3 },
)

const gated = await requireConfidence(
  async () => ({ value: verified.value }),
  {
    strategy: selfConsistency({ samples: 5 }),
    min: 0.8,
    below: 'escalate', // or 'abort' or a callback
  },
)
```

Demos: [`examples/verification-pipeline/`](../examples/verification-pipeline/) and [`examples/confidence-strategies/`](../examples/confidence-strategies/).

## Fluent verification on the agent

`runWithVerification` is also available as a fluent API on any agent returned by `defineAgent`. Chain `withVerifier(...)` and `withRetryPolicy(...)` and every `agent.run()` / `agent.generate()` call internally loops generate → validate → repair-or-abort. Calls without verifiers attached behave identically to before — zero overhead unless you opt in.

```typescript
import { defineAgent, zodValidator } from '@elsium-ai/agents'

const verified = defineAgent({ name: 'extract', system: '...', model: 'claude-sonnet-4-6' }, deps)
  .withVerifier(zodValidator(InvoiceSchema))
  .withVerifier({
    name: 'amount-cap',
    validate: (r) => {
      const text = typeof r.message.content === 'string' ? r.message.content : ''
      return text.includes('"amount":') && JSON.parse(text).amount > 1_000_000
        ? { valid: false, failures: [{ validator: 'amount-cap', reason: 'amount exceeds 1M cap' }] }
        : { valid: true, failures: [] }
    },
  })
  .withRetryPolicy({ maxAttempts: 3 })

const result = await verified.run('Extract the invoice from <attachment>')
```

`withVerifier` and `withRetryPolicy` return a **new** agent — they don't mutate the base. The verifier list and policy are immutable per agent reference, so you can fork the same base agent into multiple verification configurations safely.

### `schemaValidator` and `judgeValidator`

Two validator factories that pair with `agent.withVerifier(...)` and match the public spec naming:

```typescript
import { schemaValidator, judgeValidator } from '@elsium-ai/agents'

agent
  .withVerifier(schemaValidator(InvoiceSchema))        // alias of zodValidator
  .withVerifier(
    judgeValidator({
      rubric: 'Summary must cite at least one source from the input.',
      judge: async (rubric, value) => callJudgeLLM(rubric, value), // { passed, score, reason? }
      threshold: 0.7,
    }),
  )
```

`schemaValidator` is an alias of `zodValidator` — both work, `schemaValidator` reads better in the fluent chain. `judgeValidator({ rubric, judge })` is provider-agnostic: you supply the judge function (typically an LLM call against a calibrated prompt) and the framework formats the failure with the score + rubric as the repair hint.

## Pause + resume (durable human-in-the-loop)

`agent.runResumable()` lets a tool pause the entire agent mid-execution and snapshot the conversation to a `StateStore`. Later, `agent.resume(resumeToken)` reloads the snapshot and continues — across process restarts, days apart, anywhere.

```typescript
import { createInMemoryStateStore, pauseAgent } from '@elsium-ai/core'
import { defineAgent } from '@elsium-ai/agents'
import { defineTool } from '@elsium-ai/tools'

const reviewTool = defineTool({
  name: 'request_approval',
  description: 'Ask a human reviewer before continuing',
  input: z.object({ amount: z.number() }),
  sideEffectLevel: 'destructive',
  handler: async (input) => {
    pauseAgent('reviewer approval needed', { amount: input.amount })
    return { /* unreachable — pauseAgent throws */ }
  },
})

const store = createInMemoryStateStore()
const agent = defineAgent({ name: 'ops', system: '...', model: '...', tools: [reviewTool] }, deps)

const outcome = await agent.runResumable('Approve refund of $1,200 for cust 42', {}, { stateStore: store })
if (outcome.status === 'paused') {
  // Persist outcome.resumeToken in your queue / DB / Slack thread.
  // Hours or days later, after a human approves:
  const final = await agent.resume(outcome.resumeToken, {
    stateStore: store,
    followUpMessage: { role: 'user', content: 'Approved by reviewer@example.com' },
  })
  console.log(final)
}
```

The framework ships `createInMemoryStateStore` for prototyping. For production, supply a durable adapter (Redis, Postgres, SQLite, S3) by implementing the `StateStore` interface — `save / load / delete / list`. **MVP scope:** snapshots are taken only at explicit `pauseAgent()` boundaries (not on every iteration). Full crash recovery across restarts is a planned follow-up.

## Replay and time-travel from a recorded trace

Every `agent.run()` automatically attaches a `TraceRecorder` and records each LLM iteration as a step. The trace stays in an in-memory ring buffer on the agent (default cap 100). `agent.replayFrom(traceId, { fromStep, overrides })` re-executes the run with selective overrides — perfect for "agent failed in prod → swap a prompt → see the downstream change":

```typescript
const result = await agent.run('Summarize Q1 earnings call')

const replay = await agent.replayFrom(result.traceId, {
  fromStep: 0,
  overrides: {
    'llm:iter_1': {
      kind: 'transform',
      input: (req) => ({ ...req, system: 'You are a tougher summarizer. Cut filler.' }),
    },
  },
})

for (const step of replay.steps) {
  console.log(step.key, step.source, step.overridden)
}
```

Steps **before** `fromStep` are served from the recording; steps **at and after** are re-executed live by the agent's LLM dependency, with overrides applied. **MVP scope:** only LLM iterations are recorded, not individual tool calls; in-memory only.

### `{ prompt }` shorthand for prompt swaps

The most common override is "rerun this step with a different system prompt". The shorthand `{ prompt: '...' }` is translated internally to a transform that swaps `request.system`:

```typescript
await agent.replayFrom(result.traceId, {
  fromStep: 'llm:iter_1',
  overrides: {
    'llm:iter_1': { prompt: 'You are a tougher summarizer. Cut filler.' },
  },
})
```

Equivalent to the verbose `{ kind: 'transform', input: (req) => ({ ...req, system: '...' }) }`. Use whichever reads cleaner.

## Automatic approval gates for destructive tools

Tools declared `sideEffectLevel: 'destructive'` now block execution behind an approval gate by default (`requireApproval: 'auto'`). Provide a `requestApproval` handler on the tool context — typically wired from the agent runtime — and the framework calls it before invoking the handler. Rejections return `{ success: false, approvalDenied: true }` without ever running the handler.

```typescript
import { defineTool } from '@elsium-ai/tools'

const transferTool = defineTool({
  name: 'transferFunds',
  description: 'Move money between accounts',
  input: TransferSchema,
  sideEffectLevel: 'destructive',
  // requireApproval defaults to 'auto' → destructive tools auto-gate
  handler: async (input) => bank.transfer(input),
})

const result = await transferTool.execute(input, {
  requestApproval: async (req) => ({
    status: req.input.amount > 1000 ? 'rejected' : 'approved',
    reason: 'auto-rejected over $1000',
  }),
})
```

Approval is skipped automatically when `dryRun: true`. Set `requireApproval: 'always'` to gate every call regardless of side-effect level (good for PII reads), or `'never'` to opt out entirely (good for test-only tools).

## Cost-Aware Routed Generation (CARG)

Route requests through a cascade of model tiers — start cheap, escalate only when the cheap tier fails or a classifier predicts it will:

```typescript
import { createCascadeRouter, createHeuristicClassifier } from '@elsium-ai/gateway'

const router = createCascadeRouter({
  tiers: [
    { name: 'cheap', gateway: gateway({ provider: 'openai', model: 'gpt-4o-mini', apiKey: env('OPENAI_API_KEY') }) },
    { name: 'flagship', gateway: gateway({ provider: 'anthropic', model: 'claude-sonnet-4-6', apiKey: env('ANTHROPIC_API_KEY') }) },
  ],
  classifier: createHeuristicClassifier({ longInputThreshold: 4000 }),
  escalateOnFailure: { errors: ['VALIDATION_ERROR', 'TIMEOUT'], maxAttempts: 2 },
})

const result = await router.complete({ messages: [...] })
console.log(result.attempts.map((a) => `${a.tier}:${a.outcome}`))
```

Full example at [`examples/carg-cascade/`](../examples/carg-cascade/).

## Streaming reasoning (thinking events)

Anthropic extended thinking and OpenAI reasoning models emit their internal reasoning as separate stream events you can render in a side panel without polluting the main text stream:

```typescript
const stream = llm.stream({
  messages: [{ role: 'user', content: 'Plan a 3-day itinerary in Lisbon' }],
  model: 'claude-sonnet-4-6',
  thinking: { enabled: true, budgetTokens: 4000 },
})

for await (const event of stream) {
  if (event.type === 'thinking_delta') process.stderr.write(event.text)
  else if (event.type === 'text_delta') process.stdout.write(event.text)
  else if (event.type === 'message_end') console.log('reasoning tokens:', event.usage.reasoningTokens)
}
```

Full example at [`examples/thinking-stream/`](../examples/thinking-stream/).

## Typed tool call streams (`withToolTypes`)

Wrap any stream to accumulate tool-call argument deltas and emit per-tool-typed `tool_call_complete` events validated against your Zod schemas — no manual JSON parsing, full autocomplete by tool name:

```typescript
import { withToolTypes } from '@elsium-ai/core'

const schemas = {
  get_weather: z.object({ city: z.string(), unit: z.enum(['C', 'F']).optional() }),
  search: z.object({ query: z.string(), limit: z.number().int().positive() }),
}

for await (const event of withToolTypes(llm.stream({ ... }), schemas)) {
  if (event.type === 'tool_call_complete' && !('parseError' in event)) {
    if (event.toolCall.name === 'get_weather') {
      // event.toolCall.arguments is { city: string; unit?: 'C' | 'F' }
    }
  }
}
```

Full example at [`examples/typed-tool-stream/`](../examples/typed-tool-stream/).

## Agent stream events — discriminated union

`agent.stream(input)` yields an `AgentStreamEvent` discriminated union you can switch on with full type narrowing. The framework emits both **granular** events (`text_delta`, `thinking_delta`, `tool_call_start/delta/end`) and **simple aliases** that match the public spec (`token`, `thinking`, `tool_call`, `final`). Pick the style that fits your UI:

```typescript
for await (const event of agent.stream('Plan a trip to Lisbon')) {
  switch (event.type) {
    case 'thinking':       // reasoning text after the model finishes its thinking block
      sidebar.append(event.text)
      break
    case 'token':          // every output token — easiest for "typewriter" UIs
      stdout.write(event.text)
      break
    case 'tool_call':      // parsed final tool call, after deltas are accumulated
      console.log('calling', event.toolCall.name, event.toolCall.arguments)
      break
    case 'tool_result':    // result of executing the tool
      console.log('returned', event.result.data)
      break
    case 'final':          // wrap-up: message + usage + toolCalls + stopReason
      saveResult(event.result)
      break
  }
}
```

The granular variants (`text_delta`, `thinking_start/delta/end`, `tool_call_start/delta/end`, `agent_end`) still fire — they're better when you need partial state during streaming (e.g. progressive UI). Both styles coexist; no breaking changes.

## Tool contracts (sideEffectLevel + idempotency + preconditions + dry-run)

Declare safety properties on every tool so the framework can prevent double-charges, block preconditions, and preview destructive actions:

```typescript
import { createInMemoryIdempotencyStore, defineTool } from '@elsium-ai/tools'

const transferTool = defineTool({
  name: 'transferFunds',
  input: z.object({ txId: z.string(), from: z.string(), to: z.string(), amount: z.number().positive() }),
  sideEffectLevel: 'destructive',
  idempotencyKey: (i) => i.txId,
  idempotencyStore: createInMemoryIdempotencyStore(),
  preconditions: [
    { name: 'hasBalance', check: async (i) => ({ ok: balanceOf(i.from) >= i.amount, reason: 'insufficient' }) },
  ],
  dryRunHandler: (i) => ({ ok: true, willTransfer: i.amount, preview: true }),
  handler: async (i) => doTransfer(i),
})

await transferTool.execute(input, { dryRun: true })  // skips handler, returns preview
await transferTool.execute(input)                    // first call runs
await transferTool.execute(input)                    // second call returns cached result, no double-charge
```

Full example at [`examples/tool-contracts/`](../examples/tool-contracts/).

### Bare-function preconditions

`preconditions` also accepts plain functions — useful when you have named functions in scope and don't want the wrapper boilerplate. The framework auto-names them from `fn.name`, falling back to `precondition_N`:

```typescript
const hasBeenAuthenticated = async (i: Input) => ({ ok: i.userToken !== undefined })
const balanceCheck = async (i: Input) => ({ ok: balanceOf(i.from) >= i.amount, reason: 'insufficient' })

const tool = defineTool({
  name: 'transferFunds',
  input: TransferSchema,
  preconditions: [hasBeenAuthenticated, balanceCheck], // auto-named from fn.name
  handler: async (i) => doTransfer(i),
})
```

Mix both forms freely — bare functions and `{ name, check }` objects can coexist in the same array.

## Human-in-the-loop (`askHuman`)

Pause a tool or agent and request approval — synchronously via a responder, or durably via a store that survives process restarts:

```typescript
import { askHuman, createInMemoryAskHumanStore, resolveAskHuman } from '@elsium-ai/agents'

const store = createInMemoryAskHumanStore()

// Agent issues a question (resolves only when a human writes the answer)
const decision = await askHuman({
  requestId: 'req-42',
  question: 'Approve $1200 refund?',
  options: ['approve', 'deny'] as const,
  store,
  timeoutMs: '7d',
})

// Elsewhere — webhook / dashboard / CLI:
await resolveAskHuman(store, 'req-42', {
  status: 'approved',
  option: 'approve',
  decidedBy: 'reviewer@example.com',
})
```

Full example at [`examples/ask-human/`](../examples/ask-human/).

### `agent.askHuman({...})` as a method

Every agent returned by `defineAgent` exposes `askHuman` as a method — same options as the standalone function, with `timeout` accepted as a duration string for ergonomics:

```typescript
const decision = await agent.askHuman({
  question: 'Approve transfer of $50,000?',
  options: ['approve', 'reject', 'modify'] as const,
  context: { trade, riskScore },
  timeout: '24h',           // string suffix or number in ms
})

if (decision.status === 'approved') { /* … */ }
```

`timeout` accepts `'5s' | '2m' | '1h' | '7d'` shorthand or a numeric millisecond value. Internally delegates to the standalone `askHuman`; both APIs are interchangeable.

## Time-travel replay (`replayFrom`)

Record every step of an agent run, then re-execute from any midpoint with selective overrides — perfect for iterating on prompts without re-paying for upstream LLM calls:

```typescript
import { createTraceRecorder, replayFrom } from '@elsium-ai/testing'

const recorder = createTraceRecorder({ agentId: 'news-bot' })
// ... wrap your pipeline so each step recorder.recordStep({ key, input, output, durationMs })
const trace = recorder.finish()

const result = await replayFrom(trace, {
  fromStep: 'summarize',
  executor: async ({ key, input }) => runStep(key, input),
  overrides: {
    research: { kind: 'transform', input: (i) => ({ ...i, query: 'tweaked query' }) },
    summarize: { kind: 'replace', output: { bullets: ['pinned'] } },
  },
})
```

Full example at [`examples/replay-from/`](../examples/replay-from/).

## Packages

| Package | Description |
|---|---|
| `@elsium-ai/core` | Types, errors, resilient streaming, **Ed25519 crypto foundation**, **capability tokens**, utilities |
| `@elsium-ai/gateway` | Multi-provider LLM gateway with `generateObject`, X-Ray, provider mesh, security middleware, **`capabilityMiddleware`** |
| `@elsium-ai/agents` | Agent framework with memory, guardrails, **VAG verification pipeline**, **CAG confidence strategies**, multi-agent |
| `@elsium-ai/tools` | Tool definitions with Zod validation + **`withCapability` guard** |
| `@elsium-ai/rag` | Document loading, chunking, embeddings, vector search + **`withRagCapability` guard** |
| `@elsium-ai/workflows` | Sequential, parallel, branching, resumable workflows |
| `@elsium-ai/observe` | Tracing, metrics, cost engine, OTel export, **proof recorder + `verifyProof` + `compareProofs`** |
| `@elsium-ai/mcp` | Bidirectional MCP client and server + **`createCapabilityGuardedMCPClient`** |
| `@elsium-ai/app` | HTTP server with middleware (CORS, auth, rate limiting) |
| `@elsium-ai/testing` | Mock providers, evals, prompt versioning, regression suites, replay |
| `@elsium-ai/cli` | CLI tool: scaffolding, X-Ray, **`elsium verify` + `elsium replay`** for execution proofs |

## Next Steps

- Read the [API Reference](./api-reference/) for detailed type documentation
- Check the cookbook for common patterns (multi-agent systems, streaming, structured output)
- Join the community and share what you build
