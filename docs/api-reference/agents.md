# elsium-ai/agents

Agent orchestration with tool use, memory, guardrails, multi-agent patterns, and state machines.

```ts
import { defineAgent, createMemory, runSequential } from '@elsium-ai/agents'
```

---

## Core

### defineAgent

```ts
defineAgent(config: AgentConfig, deps?: AgentDependencies): Agent
```

Creates an agent that can reason, use tools, and maintain memory across turns.

**Config:**

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Agent identifier |
| `model` | `string` | LLM model to use |
| `system` | `string` | System prompt defining agent behavior |
| `tools` | `Tool[]` | Tools available to the agent |
| `memory` | `MemoryConfig` | Memory strategy for conversation history |
| `guardrails` | `GuardrailConfig` | Input/output validation guardrails |
| `guardrails.maxIterations` | `number` | Maximum tool-use loop iterations (default: 10) |
| `seed` | `number` | Seed forwarded to every LLM request for reproducibility (overridable per run) |

**Returns** an `Agent` with `run(input, opts?)`, `stream(input, opts?)`, and `generate(input, schema, opts?)` methods.

### Reproducibility (`seed`)

Set `AgentConfig.seed` to forward a seed to every `CompletionRequest` the agent issues (both the tool loop and streaming). Override it per call with `AgentRunOptions.seed`; the per-run value falls back to the agent-level one when omitted.

```ts
const agent = defineAgent({ name: 'extractor', system: '...', seed: 42 })

const a = await agent.run('Extract the fields')
const b = await agent.run('Extract the fields', { seed: 7 }) // per-run override
```

**Caveat:** `seed` is only effective if the provider honors it (forwarded where supported, e.g. OpenAI and Google; absent on Anthropic). It does not, on its own, make a hosted model deterministic. Use `@elsium-ai/testing`'s `assertDeterministic` to measure run-to-run variance (it measures variance, it does not enforce it). See `examples/reproducible-run`.

```ts
import { defineAgent } from '@elsium-ai/agents'

const agent = defineAgent({
  name: 'researcher',
  model: 'claude-sonnet-4-20250514',
  system: 'You are a research assistant. Use tools to find and synthesize information.',
  tools: [searchTool, summarizeTool],
  memory: { strategy: 'sliding-window', maxMessages: 50 },
  guardrails: { maxIterations: 15 },
})

const result = await agent.run('What are the latest advances in quantum computing?')
// result contains the agent's final response, messages, and metadata
```

---

## Structured Output

### agent.generate

```ts
agent.generate<T>(input: string, schema: z.ZodType<T>, options?: AgentRunOptions): Promise<AgentGenerateResult<T>>
```

Runs the full agent loop (tools, guardrails, memory) and parses the final response into a typed object validated against a Zod schema. Throws `ElsiumError` if the response is not valid JSON or doesn't match the schema.

**AgentGenerateResult\<T\>:**

| Field | Type | Description |
|---|---|---|
| `data` | `T` | Parsed and validated data |
| `result` | `AgentResult` | Full agent execution result |

```ts
import { z } from 'zod'

const schema = z.object({
  answer: z.string(),
  confidence: z.number(),
  sources: z.array(z.string()),
})

const { data } = await agent.generate('What causes rain?', schema)
// data is fully typed: { answer: string, confidence: number, sources: string[] }
```

---

## Memory

### createMemory

```ts
createMemory(config: MemoryConfig): Memory
```

Creates a memory instance with the specified retention strategy.

| Strategy | Description |
|---|---|
| `sliding-window` | Keeps the last N messages (configure with `maxMessages`) |
| `token-limited` | Keeps messages within a token budget (configure with `maxTokens`) |
| `summary` | Compresses old messages into an LLM-generated summary (configure with `maxMessages` + `summarize`) |
| `unlimited` | Retains all messages (use with caution) |

```ts
import { createMemory, createSummarizeFn } from '@elsium-ai/agents'

const memory = createMemory({ strategy: 'sliding-window', maxMessages: 100 })
const tokenMemory = createMemory({ strategy: 'token-limited', maxTokens: 8192 })
const fullMemory = createMemory({ strategy: 'unlimited' })

// Summary strategy — compresses old messages with an LLM
const summarize = createSummarizeFn((req) => llm.complete(req))
const summaryMemory = createMemory({ strategy: 'summary', maxMessages: 20, summarize })
await summaryMemory.summarizeIfNeeded()
```

### createInMemoryMemoryStore

```ts
createInMemoryMemoryStore(): MemoryStore
```

Creates an in-memory message store. Messages are lost when the process exits.

### createSqliteMemoryStore

```ts
createSqliteMemoryStore(config: SqliteMemoryStoreConfig): MemoryStore
```

Creates a SQLite-backed persistent message store. Messages survive process restarts.

```ts
import { createMemory, createSqliteMemoryStore } from '@elsium-ai/agents'

const store = createSqliteMemoryStore({ path: './data/memory.db' })
const memory = createMemory({
  strategy: 'sliding-window',
  maxMessages: 100,
  store,
})
```

### createSharedMemory

```ts
createSharedMemory(): SharedMemory
```

Creates a shared key-value memory for cross-agent data sharing in multi-agent workflows. Includes prototype pollution guards (rejects `__proto__`, `constructor`, `prototype` keys).

**Methods:**

| Method | Signature | Description |
|---|---|---|
| `get` | `get(key: string): unknown` | Retrieve a value |
| `set` | `set(key: string, value: unknown): void` | Store a value |
| `getAll` | `getAll(): Record<string, unknown>` | Get all stored data |
| `clear` | `clear(): void` | Remove all data |

```ts
import { createSharedMemory } from '@elsium-ai/agents'

const shared = createSharedMemory()
shared.set('findings', ['result1', 'result2'])
const findings = shared.get('findings')
```

---

## Multi-Agent

### runSequential

```ts
runSequential(agents: Agent[], input: string, opts?: MultiAgentOptions): Promise<AgentResult[]>
```

Runs agents in sequence. Each agent receives the previous agent's output as its input.

### runParallel

```ts
runParallel(agents: Agent[], input: string, opts?: MultiAgentOptions): Promise<AgentResult[]>
```

Runs agents concurrently. All agents receive the same input and execute independently.

### runSupervisor

```ts
runSupervisor(supervisor: Agent, workers: Agent[], input: string, opts?: MultiAgentOptions): Promise<AgentResult>
```

A supervisor agent delegates tasks to worker agents, coordinating their execution and synthesizing results.

All multi-agent functions accept optional `sharedMemory` in their options for cross-agent data sharing.

```ts
import { defineAgent, runSequential, runParallel, runSupervisor, createSharedMemory } from '@elsium-ai/agents'

const researcher = defineAgent({ name: 'researcher', /* ... */ })
const writer = defineAgent({ name: 'writer', /* ... */ })
const editor = defineAgent({ name: 'editor', /* ... */ })

// Sequential: researcher -> writer -> editor
const result = await runSequential(
  [researcher, writer, editor],
  'Write an article about AI safety',
)

// Parallel: all agents work on the same input concurrently
const results = await runParallel(
  [researcher, writer, editor],
  'Analyze this dataset',
)

// Supervisor: coordinator delegates to workers
const supervisor = defineAgent({ name: 'coordinator', /* ... */ })
const shared = createSharedMemory()

const result = await runSupervisor(
  supervisor,
  [researcher, writer],
  'Create a research report',
  { sharedMemory: shared },
)
```

---

## Streaming

### agent.stream

```ts
agent.stream(input: string, options?: AgentRunOptions): AgentStream
```

Streams agent execution in real-time. Returns an `AgentStream` that yields `AgentStreamEvent` objects and provides a `.result()` method for the final `AgentResult`.

Requires a `stream` function in agent dependencies.

**AgentStreamEvent types:**

| Type | Fields | Description |
|---|---|---|
| `text_delta` | `text: string` | Incremental text from the LLM |
| `tool_call_start` | `toolCall: { id, name }` | Tool call initiated |
| `tool_call_delta` | `toolCallId, arguments` | Partial tool arguments |
| `tool_call_end` | `toolCallId` | Tool arguments complete |
| `tool_result` | `toolCallId, name, result` | Tool execution result |
| `iteration_start` | `iteration: number` | New loop iteration |
| `iteration_end` | `iteration: number` | Loop iteration complete |
| `agent_end` | `result: AgentResult` | Agent finished |
| `error` | `error: Error` | Execution error |

```ts
const agent = defineAgent(
  { name: 'assistant', system: 'You are helpful.' },
  { complete: (req) => llm.complete(req), stream: (req) => llm.stream(req) },
)

const stream = agent.stream('Hello')
for await (const event of stream) {
  if (event.type === 'text_delta') process.stdout.write(event.text)
}
const result = await stream.result()
```

---

## Threads

### createThread

```ts
createThread(config: ThreadConfig): Thread
```

Creates a conversation thread that manages message history across multiple `send()` calls.

**Config:**

| Field | Type | Description |
|---|---|---|
| `id` | `string?` | Custom thread ID (auto-generated if omitted) |
| `agent` | `Agent` | The agent to use for this thread |
| `metadata` | `Record?` | Custom metadata |
| `store` | `ThreadStore?` | Persistence adapter |

**Thread methods:**

| Method | Returns | Description |
|---|---|---|
| `send(input)` | `Promise<AgentResult>` | Send a message and get a response |
| `stream(input)` | `AgentStream` | Stream a response |
| `getMessages()` | `Message[]` | Get full conversation history |
| `addMessage(msg)` | `void` | Manually add a message |
| `fork(opts?)` | `Thread` | Fork thread with full history |
| `clear()` | `void` | Clear all messages |
| `save()` | `Promise<void>` | Manually persist to store |

### loadThread

```ts
loadThread(threadId: string, config: { agent, store }): Promise<Thread | null>
```

Loads a thread from a store. Returns `null` if not found.

### createInMemoryThreadStore

```ts
createInMemoryThreadStore(): ThreadStore
```

In-memory thread persistence. Data lost on process exit.

---

## Async Agents

### createAsyncAgent

```ts
createAsyncAgent(config: AsyncAgentConfig): AsyncAgent
```

Wraps an agent for background task execution with progress tracking and cancellation.

**Config:**

| Field | Type | Description |
|---|---|---|
| `agent` | `Agent` | The agent to run tasks with |
| `onProgress` | `(task, event) => void` | Progress callback |
| `onComplete` | `(task) => void` | Completion callback |
| `onError` | `(task, error) => void` | Error callback |

**AsyncAgent methods:**

| Method | Returns | Description |
|---|---|---|
| `submit(input, opts?)` | `AgentTask` | Submit a task for execution |
| `getTask(id)` | `AgentTask \| null` | Get a task by ID |
| `listTasks(filter?)` | `AgentTask[]` | List tasks, optionally filtered by status |
| `cancelAll()` | `void` | Cancel all pending/running tasks |

**AgentTask:**

| Property/Method | Description |
|---|---|
| `id` | Task identifier |
| `status` | `'pending' \| 'running' \| 'completed' \| 'failed' \| 'cancelled'` |
| `result` | `AgentResult \| null` |
| `error` | `Error \| null` |
| `wait()` | `Promise<AgentResult>` — resolves when task completes |
| `cancel()` | Cancel the task |

```ts
const asyncAgent = createAsyncAgent({ agent, onComplete: (t) => notify(t.id) })
const task = asyncAgent.submit('Research quantum computing')
const result = await task.wait()
```

### Task Stores

Pass a `TaskStore` as `AsyncAgentConfig.taskStore` to persist every task transition, so submitted tasks survive process restarts. The package ships two reference adapters; for production durability implement `TaskStore` against your own backend.

```ts
createInMemoryTaskStore(): TaskStore
createJsonFileTaskStore(config: JsonFileTaskStoreConfig): TaskStore
```

`createInMemoryTaskStore` keeps `PersistedTask` records in a `Map` (lost on exit). `createJsonFileTaskStore` writes one `<taskId>.json` file per task under `config.dir` using atomic temp-file renames and per-id write serialization.

**JsonFileTaskStoreConfig:**

| Field | Type | Description |
|---|---|---|
| `dir` | `string` | Directory where task JSON files are written (created if missing) |

**TaskStore methods:**

| Method | Returns | Description |
|---|---|---|
| `save(task)` | `Promise<void>` | Persist (upsert) a `PersistedTask` |
| `load(taskId)` | `Promise<PersistedTask \| null>` | Load a task by ID |
| `list(filter?)` | `Promise<PersistedTask[]>` | List tasks, optionally filtered by `status` |
| `delete(taskId)` | `Promise<void>` | Remove a task record |

```ts
import { createAsyncAgent, createJsonFileTaskStore } from '@elsium-ai/agents'

const taskStore = createJsonFileTaskStore({ dir: './data/tasks' })
const asyncAgent = createAsyncAgent({ agent, taskStore })
```

---

## ReAct Agent

### defineReActAgent

```ts
defineReActAgent(config: ReActConfig): ReActAgent
```

Creates an agent that follows the explicit **ReAct** (Reason + Act) loop — emitting `Thought → Action → Action Input → Observation` cycles until it produces a `Final Answer`. Unlike `defineAgent`, the result carries the full step-by-step `reasoning` trace, and the agent is wired directly to a gateway/provider rather than taking `AgentDependencies`.

**ReActConfig:**

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Agent identifier |
| `tools` | `Tool[]` | Tools available to the agent |
| `model` | `string?` | LLM model to use |
| `system` | `string?` | User system prompt, prepended to the built-in ReAct prompt |
| `maxIterations` | `number?` | Maximum reasoning iterations (default: 10) |
| `maxTokenBudget` | `number?` | Token budget across the run (default: 500000) |
| `hooks` | `ReActConfig['hooks']?` | `AgentHooks` plus `onThought`, `onAction`, `onObservation` callbacks |
| `provider` | `string \| LLMProvider \| ProviderMesh?` | Provider name, or an object exposing `complete` |
| `apiKey` | `string?` | API key (required when `provider` is a name string) |
| `baseUrl` | `string?` | Optional provider base URL |

Provide either an `LLMProvider`/`ProviderMesh` object as `provider`, or a provider name string together with `apiKey`; otherwise construction throws.

**ReActAgent** exposes `name` and `run(input, options?): Promise<ReActResult>`.

**ReActResult** extends `AgentResult` with `reasoning: ReActStep[]`, where each `ReActStep` is `{ iteration, thought, action?: { tool, input }, observation? }`.

```ts
import { defineReActAgent } from '@elsium-ai/agents'

const agent = defineReActAgent({
  name: 'researcher',
  provider: 'openai',
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4o',
  tools: [searchTool, calculatorTool],
  hooks: {
    onThought: (thought, i) => console.log(`[${i}] ${thought}`),
  },
})

const result = await agent.run('What is the population of France times 2?')
for (const step of result.reasoning) {
  console.log(step.thought, step.action, step.observation)
}
```

---

## Guardrails

### createSemanticValidator

```ts
createSemanticValidator(config: SemanticGuardrailConfig, llmComplete?: LLMComplete): SemanticValidator
```

Validates agent outputs for hallucination, relevance, and grounding against source material.

### createAgentSecurity

```ts
createAgentSecurity(config: AgentSecurityConfig): {
  validateInput(input: string): AgentSecurityResult
  sanitizeInput(input: string): AgentSecurityResult
  sanitizeOutput(output: string): AgentSecurityResult
}
```

Scans for prompt injection, jailbreak attempts, and secrets in agent inputs and outputs, and can redact secrets / PII from input before it reaches the model.

**AgentSecurityConfig:**

| Field | Type | Default | Description |
|---|---|---|---|
| `detectPromptInjection` | `boolean` | `true` | Detect prompt injection patterns in input |
| `detectJailbreak` | `boolean` | `false` | Detect jailbreak attempt patterns in input |
| `redactSecrets` | `boolean` | `true` | Redact secrets (API keys, passwords, SSNs, cards, bearer tokens) in output |
| `blockedPatterns` | `RegExp[]` | `[]` | Additional custom regex patterns to block in input |
| `redactInputSecrets` | `boolean` | `false` | Redact secrets from user **input** before it reaches the model |
| `redactInputPii` | `Array<'email' \| 'phone' \| 'address' \| 'passport' \| 'all'>` | `[]` | PII categories to redact from input; setting any category also redacts input secrets |
| `injectionClassifier` | `InputGuardrail` | -- | Optional async classifier run on the raw input; return `true` to reject it (applied on `run`/`chat`/`generate`, not `stream`) |
| `redactToolArgSecrets` | `boolean` | `false` | Redact secrets from tool-call arguments before execution and trace (PII is left intact) |

**Input guardrail pipeline** (applied on `run` / `chat` / `generate`): detection (throws on violation) → async `injectionClassifier` (throws if flagged) → redaction (transforms the text sent to the model). `stream` applies only the synchronous steps (detection + redaction); the async classifier is skipped. See `examples/input-guardrails`.

### createLLMGuardrail

```ts
createLLMGuardrail(options: LLMGuardrailOptions): InputGuardrail
```

Returns a built-in `InputGuardrail` (`(input: string) => boolean | Promise<boolean>`, `true` = reject) backed by the gateway you already use — no extra install. Plug it into `AgentSecurityConfig.injectionClassifier` as a higher-precision alternative to the heuristic regex detector.

`InputGuardrail` is the extension port: pass `createLLMGuardrail`, or your own function wrapping an external tool (Lakera, NeMo Guardrails, Presidio, etc.). External integration is the caller's choice, never a dependency.

**LLMGuardrailOptions:**

| Field | Type | Default | Description |
|---|---|---|---|
| `complete` | `LLMComplete` | -- | Completion function — typically `gateway.complete` |
| `model` | `string` | gateway default | Model override |
| `instructions` | `string` | built-in prompt | Override the classification system prompt |
| `onError` | `'allow' \| 'block'` | `'allow'` | `'allow'` fails open (do not block on classifier failure); `'block'` fails closed |

```ts
import { defineAgent, createLLMGuardrail } from '@elsium-ai/agents'

const agent = defineAgent({
  name: 'assistant',
  system: 'You are helpful.',
  guardrails: {
    security: {
      injectionClassifier: createLLMGuardrail({ complete: (req) => llm.complete(req) }),
    },
  },
})
```

### createConfidenceScorer

```ts
createConfidenceScorer(config: ConfidenceConfig): { score(input: string, output: string, semanticResult?: SemanticValidationResult): Promise<ConfidenceResult> }
```

Scores confidence of agent outputs based on configurable criteria.

```ts
import { defineAgent } from '@elsium-ai/agents'

const agent = defineAgent({
  name: 'assistant',
  model: 'claude-sonnet-4-20250514',
  system: 'You are a helpful assistant.',
  guardrails: {
    semantic: {
      hallucination: { enabled: true },
      relevance: { enabled: true },
    },
    security: {
      detectPromptInjection: true,
      detectJailbreak: true,
      redactSecrets: true,
    },
  },
})
```

### createApprovalGate / shouldRequireApproval

```ts
createApprovalGate(config: ApprovalGateConfig): ApprovalGate
shouldRequireApproval(
  config: ApprovalGateConfig['requireApprovalFor'],
  context: { toolName?: string; model?: string; cost?: number },
): boolean
```

Human-in-the-loop approval for sensitive agent actions.

```ts
import { createApprovalGate, shouldRequireApproval } from '@elsium-ai/agents'

const requireApprovalFor = { tools: ['delete', 'send-email', 'execute-code'] }

const gate = createApprovalGate({
  callback: (req) => requestHumanApproval(req),
  requireApprovalFor,
})

if (shouldRequireApproval(requireApprovalFor, { toolName: action.name })) {
  const decision = await gate.requestApproval('tool_call', `Run ${action.name}`, {
    toolName: action.name,
  })
  if (!decision.approved) return
}
```

### createApprovalChain / createInMemoryApprovalStore

```ts
createApprovalChain(config: ApprovalChainConfig): ApprovalChain
createInMemoryApprovalStore(): ApprovalStore
```

Multi-stage human-in-the-loop approval. A request flows through ordered `ApprovalStage`s; each stage decides whether it applies (`enter`), who approves it (`approver`), and what happens on timeout. `callback` approvers are auto-invoked; `role`/`user` approvers pause the chain until resolved externally via `store.resolveStage(...)`. The package ships only the in-memory store; implement `ApprovalStore` against your own backend for durability.

**ApprovalChainConfig:**

| Field | Type | Description |
|---|---|---|
| `stages` | `readonly ApprovalStage[]` | Ordered stages (at least one; names must be unique) |
| `store` | `ApprovalStore` | Persistence adapter for approval state |
| `notifier` | `ApprovalNotifier?` | Optional hook called when a stage is entered (Slack/email/PagerDuty) |

**ApprovalStage:**

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Unique stage name |
| `enter` | `(req: ApprovalRequest) => boolean` | Returns `true` if the stage applies; `false` skips it |
| `approver` | `ApproverSpec` | `{ type: 'role' \| 'user', target: string }` or `{ type: 'callback', target: ApprovalCallback }` |
| `timeoutMs` | `number?` | Stage timeout (default: 300000) |
| `onTimeout` | `'deny' \| 'escalate' \| 'allow'?` | Action when the timeout fires (default: `'deny'`) |

**ApprovalChain methods:**

| Method | Returns | Description |
|---|---|---|
| `request(req)` | `Promise<ApprovalState>` | Start a chain (`req` omits `id`/`requestedAt`); advances through auto-resolvable stages |
| `resume(requestId)` | `Promise<ApprovalState>` | Re-advance a pending chain (e.g. after an external `resolveStage`) |
| `cancel(requestId, reason)` | `Promise<ApprovalState>` | Deny all pending stages and mark the chain denied |
| `store` | `ApprovalStore` | The backing store |

`ApprovalState` reports `status` (`'pending' \| 'approved' \| 'denied' \| 'expired'`), `currentStage`, and per-stage `StageState[]`.

```ts
import { createApprovalChain, createInMemoryApprovalStore } from '@elsium-ai/agents'

const chain = createApprovalChain({
  store: createInMemoryApprovalStore(),
  stages: [
    {
      name: 'manager',
      enter: (req) => (req.context?.amount as number) > 1000,
      approver: { type: 'role', target: 'manager' },
      timeoutMs: 60_000,
      onTimeout: 'escalate',
    },
    {
      name: 'auto-policy',
      enter: () => true,
      approver: { type: 'callback', target: (req) => ({
        requestId: req.id, approved: true, decidedAt: Date.now(),
      }) },
    },
  ],
})

let state = await chain.request({ type: 'tool_call', description: 'Wire funds', context: { amount: 5000 } })
// A role/user stage waits — the approving UI resolves it, then resume:
await chain.store.resolveStage(state.request.id, 'manager', {
  requestId: state.request.id, approved: true, decidedBy: 'alice', decidedAt: Date.now(),
})
state = await chain.resume(state.request.id)
```

### askHuman / resolveAskHuman / createInMemoryAskHumanStore

```ts
askHuman<TOption>(options: AskHumanOptions<TOption> & { timeoutMs?: string | number }): Promise<AskHumanDecision<TOption>>
resolveAskHuman(store: AskHumanStore, requestId: string, decision: Omit<AskHumanDecision, 'decidedAt'>): Promise<void>
createInMemoryAskHumanStore(config?: InMemoryAskHumanStoreConfig): AskHumanStore
```

Durable, option-based human-in-the-loop primitive. `askHuman` poses a question with a fixed set of `options` and resolves either through a `responder` callback or by polling a `store` until a human resolves it via `resolveAskHuman`. The same capability is also available pre-bound on every agent as `agent.askHuman(options)`.

**AskHumanOptions:**

| Field | Type | Description |
|---|---|---|
| `question` | `string` | The question to ask (required, non-empty) |
| `options` | `readonly TOption[]` | Allowed answer options (at least one) |
| `context` | `Record?` | Arbitrary context attached to the request |
| `timeoutMs` | `string \| number?` | Timeout; accepts ms or a duration string like `'2h'`, `'1d'` (default: 24h) |
| `onTimeout` | `'reject' \| 'timeout'?` | Status used when the timeout fires (default: `'timeout'`) |
| `store` | `AskHumanStore?` | Store to persist/poll the request |
| `responder` | `AskHumanResponder<TOption>?` | Callback that resolves the request directly |
| `requestId` | `string?` | Custom request ID |

Either a `responder` or a `store` must be supplied. **AskHumanDecision** is `{ status: 'approved' \| 'rejected' \| 'timeout' \| 'custom', option?, reason?, decidedBy?, decidedAt }`.

```ts
import { askHuman, createInMemoryAskHumanStore, resolveAskHuman } from '@elsium-ai/agents'

const store = createInMemoryAskHumanStore()

// Worker A: pauses until a human resolves the request (or 2h elapse)
const pending = askHuman({
  question: 'Approve the refund?',
  options: ['approve', 'deny'] as const,
  timeoutMs: '2h',
  store,
  requestId: 'refund-42',
})

// Worker B (the UI / webhook): resolve it
await resolveAskHuman(store, 'refund-42', {
  status: 'custom', option: 'approve', decidedBy: 'ops',
})

const decision = await pending // { status: 'custom', option: 'approve', ... }
```

---

## Verification (VAG)

Verification-Augmented Generation: generate, validate against one or more `Validator`s, and automatically re-generate with a repair prompt until the output passes or the repair budget is exhausted.

### runWithVerification

```ts
runWithVerification<T>(generate: GenerateFn<T>, config: VerificationConfig<T>): Promise<VerificationOutcome<T>>
```

Runs the generate → validate → repair loop. `generate(repair?)` produces a candidate (receiving a `RepairContext` with a ready-made `repairPrompt` on retries); validators run in `'all'` mode (every validator must pass). Throws if `config.validators` is empty.

**VerificationConfig:**

| Field | Type | Description |
|---|---|---|
| `validators` | `Validator<T>[]` | Validators to apply (all must pass) |
| `maxRepairs` | `number?` | Max repair attempts after the first try (default from package) |
| `formatRepairPrompt` | `(failures, previousValue) => string?` | Custom repair-prompt builder |
| `onAttempt` | `(attempt: VerificationAttempt<T>) => void?` | Called after each attempt |
| `onAbort` | `(abort: VerificationAbort<T>) => void?` | Called when the loop gives up |

**VerificationOutcome** is either `{ status: 'ok' \| 'repaired', value, attempts, history }` or `{ status: 'aborted', lastValue, attempts, history, reason }`.

A `Validator<T>` is `{ name, validate(value, context): ValidationOutcome | Promise<ValidationOutcome> }`, where `ValidationOutcome` is `{ valid, failures: ValidationFailure[] }`. Built-in validator factories are exported for common cases: `zodValidator` / `schemaValidator`, `regexValidator`, `judgeValidator`, `semanticAdapter`, `externalValidator`, and `composeValidators`.

```ts
import { runWithVerification, zodValidator } from '@elsium-ai/agents'
import { z } from 'zod'

const schema = z.object({ title: z.string().max(60), tags: z.array(z.string()).min(1) })

const outcome = await runWithVerification(
  async (repair) => llm.completeJson(repair?.repairPrompt ?? 'Summarize the article'),
  { validators: [zodValidator(schema)], maxRepairs: 2 },
)

if (outcome.status !== 'aborted') {
  console.log(outcome.value, `passed in ${outcome.attempts} attempt(s)`)
}
```

### withVerifiers

```ts
withVerifiers(base: Agent, verifiers: Validator<AgentResult>[], policy?: AgentRetryPolicy): Agent
```

Wraps an `Agent` so that `run` and `generate` automatically retry through `runWithVerification` against the supplied `AgentResult` verifiers. Failed verification throws an `ElsiumError` after exhausting the retry budget. The fluent equivalents `agent.withVerifier(validator)` and `agent.withRetryPolicy(policy)` are available on every agent returned by `defineAgent`.

**AgentRetryPolicy:**

| Field | Type | Description |
|---|---|---|
| `maxAttempts` | `number?` | Total attempts including the first (default: 3) |
| `semantic` | `boolean?` | Enable semantic repair behavior (default: true) |

```ts
import { defineAgent, judgeValidator } from '@elsium-ai/agents'

const agent = defineAgent({ name: 'writer', system: 'Write concise summaries.' })

const verified = agent
  .withVerifier(judgeValidator({
    rubric: 'The summary must be under 3 sentences and factually grounded.',
    judge: (rubric, value) => myLLMJudge(rubric, value), // { passed, score }
  }))
  .withRetryPolicy({ maxAttempts: 4 })

const result = await verified.run('Summarize the quarterly report')
```

---

## Confidence (CAG)

Confidence-Augmented Generation voters aggregate multiple samples of the same generation into a single winner plus a confidence score. They plug into `selfConsistency({ voter })` (and are usable standalone).

### createMajorityVoter / createSimilarityVoter

```ts
createMajorityVoter<T>(): Voter<T>
createSimilarityVoter<T>(options: SimilarityVoterOptions<T>): Voter<T>
```

`createMajorityVoter` picks the most frequent sample using a canonicalized deep-equality key (order-insensitive for object keys); `confidence` is the winner's share of the votes. `createSimilarityVoter` clusters samples with a caller-supplied similarity function and returns the largest cluster's representative; `confidence` is that cluster's share.

**SimilarityVoterOptions:**

| Field | Type | Description |
|---|---|---|
| `similarity` | `(a: T, b: T) => number \| Promise<number>` | Pairwise similarity in `[0, 1]` |
| `threshold` | `number?` | Minimum similarity to join a cluster (default: 0.85) |

A `Voter<T>` is `{ name, vote(samples): VoteResult<T> | Promise<VoteResult<T>> }`, where `VoteResult` is `{ winner, confidence, details? }`.

```ts
import { selfConsistency, createMajorityVoter, createSimilarityVoter } from '@elsium-ai/agents'

// Exact-match majority across 5 samples
const exact = selfConsistency({ samples: 5, voter: createMajorityVoter() })
const r1 = await exact.score(async () => ({ value: await classify(input) }))

// Cluster free-text answers by embedding similarity
const fuzzy = selfConsistency({
  voter: createSimilarityVoter({
    similarity: (a, b) => cosineSim(embed(a), embed(b)),
    threshold: 0.9,
  }),
})
const r2 = await fuzzy.score(async () => ({ value: await answer(input) }))
console.log(r2.value, r2.confidence)
```

---

## State Machine

### executeStateMachine

```ts
executeStateMachine(
  baseConfig: AgentConfig,
  stateConfig: { states: Record<string, StateDefinition>; initialState: string },
  deps: AgentDependencies,
  input: string,
  options?: AgentRunOptions,
): Promise<StateMachineResult>
```

Runs an agent through a defined state machine. Each state defines transitions that determine the next state based on the agent's output. Context is threaded through all transitions.

**Transition return types:**
- `string` -- name of the next state
- `{ next: string; context?: Record<string, unknown> }` -- next state with updated context

```ts
import { executeStateMachine } from '@elsium-ai/agents'

// deps: { complete, stream } backed by your gateway
const deps = { complete: (req) => llm.complete(req), stream: (req) => llm.stream(req) }

const result = await executeStateMachine(
  { name: 'support', model: 'claude-sonnet-4-20250514', system: 'Help the user.' },
  {
    initialState: 'classify',
    states: {
      classify: {
        system: 'Classify the user issue as billing, technical, or general.',
        transition: (result, ctx) => {
          const output = String(result.message.content)
          if (output.includes('billing')) return { next: 'billing', context: { type: 'billing' } }
          if (output.includes('technical')) return 'technical'
          return 'general'
        },
      },
      billing: {
        system: 'Help the user with their billing issue.',
        transition: () => 'resolve',
      },
      technical: {
        system: 'Help the user with their technical issue.',
        transition: () => 'resolve',
      },
      general: {
        system: 'Help the user with their general inquiry.',
        transition: () => 'resolve',
      },
      resolve: {
        system: 'Summarize the resolution and ask if there is anything else.',
        terminal: true, // terminal state
        transition: () => 'resolve',
      },
    },
  },
  deps,
  'I was double-charged on my last invoice',
)
```

---

## Channels

### createWebhookChannel

```ts
createWebhookChannel(config: WebhookChannelConfig): ChannelAdapter & { receive(msg): void }
```

Creates a webhook-based channel adapter. Call `receive()` to inject incoming messages (e.g., from an HTTP webhook handler).

**Config:**

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Channel identifier |
| `onSend` | `(userId, message) => void` | Callback when agent sends a response |

### ChannelAdapter

```ts
interface ChannelAdapter {
  readonly name: string
  start(): Promise<void>
  stop(): Promise<void>
  send(userId: string, message: OutgoingMessage): Promise<void>
  onMessage(handler: (message: IncomingMessage) => void): void
}
```

Implement this interface to create custom adapters for messaging platforms (WhatsApp, Telegram, Discord, Slack, etc.).

**IncomingMessage:**

| Field | Type | Description |
|---|---|---|
| `channelName` | `string` | Which channel the message came from |
| `userId` | `string` | User identifier on the platform |
| `text` | `string` | Message text |
| `attachments` | `ChannelAttachment[]?` | Optional attachments |
| `metadata` | `Record?` | Platform-specific metadata |
| `raw` | `unknown?` | Raw platform message |

### createChannelGateway

```ts
createChannelGateway(config: ChannelGatewayConfig): ChannelGateway
```

Connects channel adapters to agents via a session router. Incoming messages are routed to the correct session, processed by the agent, and responses are sent back through the originating channel.

**Config:**

| Field | Type | Description |
|---|---|---|
| `adapters` | `ChannelAdapter[]` | Channel adapters to connect |
| `router` | `SessionRouter` | Session router for thread management |
| `agent` | `Agent` | Default agent for all channels |
| `resolveAgent` | `(msg) => Agent?` | Dynamic agent selection per message |
| `onError` | `(error, msg) => void` | Error callback |

```ts
import {
  createWebhookChannel, createChannelGateway,
  createSessionRouter, defineAgent,
} from '@elsium-ai/agents'

const webhook = createWebhookChannel({
  name: 'api',
  onSend: (userId, msg) => sendPushNotification(userId, msg.text),
})

const agent = defineAgent({ name: 'assistant', system: 'You are helpful.' })
const router = createSessionRouter({ defaultAgent: agent })

const gateway = createChannelGateway({
  adapters: [webhook],
  router,
  agent,
})

await gateway.start()

// In your HTTP handler:
webhook.receive({ userId: 'user-123', text: 'Hello!' })
```

---

## Session Router

### createSessionRouter

```ts
createSessionRouter(config: SessionRouterConfig): SessionRouter
```

Maps (channel, userId) pairs to persistent conversation threads with concurrency control.

**Config:**

| Field | Type | Description |
|---|---|---|
| `defaultAgent` | `Agent` | Agent used when none specified |
| `store` | `ThreadStore?` | Optional persistence for threads |
| `concurrency` | `'serial' \| 'parallel'` | Concurrency mode (default: `'serial'`) |
| `sessionTimeout` | `number?` | Auto-expire sessions after ms of inactivity |
| `onSessionCreated` | `(session) => void` | Callback on new session |
| `onSessionExpired` | `(session) => void` | Callback on session expiry |

**SessionRouter methods:**

| Method | Returns | Description |
|---|---|---|
| `resolve(opts)` | `Promise<Thread>` | Get or create a thread for channel+user |
| `getSession(channel, userId)` | `SessionInfo \| null` | Get session info |
| `listSessions()` | `SessionInfo[]` | List all active sessions |
| `endSession(channel, userId)` | `boolean` | End a specific session |
| `endAllSessions()` | `void` | End all sessions and cleanup |

**Serial concurrency** (default) ensures only one agent turn runs at a time per session — subsequent messages wait for the current turn to complete. This prevents race conditions in conversation history.

```ts
import { createSessionRouter, defineAgent, createInMemoryThreadStore } from '@elsium-ai/agents'

const agent = defineAgent({ name: 'support', system: 'You help users.' })
const store = createInMemoryThreadStore()

const router = createSessionRouter({
  defaultAgent: agent,
  store,
  concurrency: 'serial',
  sessionTimeout: 30 * 60 * 1000, // 30 minutes
  onSessionCreated: (s) => console.log(`New session: ${s.sessionId}`),
  onSessionExpired: (s) => console.log(`Expired: ${s.sessionId}`),
})

// Get or create a thread for this user
const thread = await router.resolve({ channelName: 'slack', userId: 'U12345' })
const result = await thread.send('Help me reset my password')
```

---

## Scheduler

### createScheduler

```ts
createScheduler(config: SchedulerConfig): Scheduler
```

Cron-based task scheduler for recurring agent tasks. Agents run autonomously on schedule.

**Config:**

| Field | Type | Description |
|---|---|---|
| `agent` | `Agent` | Default agent for scheduled tasks |
| `resolveAgent` | `(task) => Agent?` | Dynamic agent selection per task |
| `onComplete` | `(task, result) => void` | Callback on successful run |
| `onError` | `(task, error) => void` | Callback on failed run |
| `tickIntervalMs` | `number` | Check interval in ms (default: 60000) |

**Scheduler methods:**

| Method | Returns | Description |
|---|---|---|
| `schedule(cron, input, opts?)` | `ScheduledTask` | Schedule a recurring task |
| `unschedule(taskId)` | `boolean` | Remove a scheduled task |
| `getTask(taskId)` | `ScheduledTask \| null` | Get task by ID |
| `listTasks()` | `ScheduledTask[]` | List all tasks |
| `pause(taskId)` | `boolean` | Pause a task |
| `resume(taskId)` | `boolean` | Resume a paused task |
| `start()` | `void` | Start the scheduler tick loop |
| `stop()` | `void` | Stop the scheduler |

**Schedule options:**

| Field | Type | Description |
|---|---|---|
| `id` | `string?` | Custom task ID |
| `name` | `string?` | Human-readable name |
| `startImmediately` | `boolean?` | Run once immediately |
| `maxRuns` | `number?` | Stop after N runs |

### parseCronExpression / cronMatchesDate / getNextCronDate

```ts
parseCronExpression(expression: string): CronFields | null
cronMatchesDate(fields: CronFields, date: Date): boolean
getNextCronDate(fields: CronFields, after: Date): Date
```

Cron utilities. Standard 5-field cron syntax: `minute hour dayOfMonth month dayOfWeek`. Supports `*`, ranges (`1-5`), steps (`*/15`), and comma-separated values (`0,30`).

```ts
import { createScheduler, defineAgent } from '@elsium-ai/agents'

const agent = defineAgent({ name: 'reporter', system: 'Generate a daily summary.' })

const scheduler = createScheduler({
  agent,
  onComplete: (task, result) => sendSlackMessage(result.message.content),
  onError: (task, error) => alertOps(error),
})

// Every day at 9am
scheduler.schedule('0 9 * * *', 'Generate the daily metrics report')

// Every 30 minutes on weekdays
scheduler.schedule('*/30 * * * 1-5', 'Check for critical alerts', {
  name: 'alert-check',
})

// Run once immediately, then stop
scheduler.schedule('0 0 1 1 *', 'Run initial data sync', {
  startImmediately: true,
  maxRuns: 1,
})

scheduler.start()
```

---

## Agent Identity

Cryptographic agent identity with HMAC-SHA256 signing, replay protection, and cross-agent verification.

### createAgentIdentity

```ts
createAgentIdentity(config: AgentIdentityConfig): Promise<AgentIdentity>
```

Creates a cryptographic identity for an agent. Each identity has a unique keypair, can sign payloads with HMAC-SHA256, and verify signatures with timing-safe comparison and replay protection.

**Config:**

| Field | Type | Description |
|---|---|---|
| `agentId` | `string` | Unique agent identifier |
| `secret` | `string?` | HMAC secret (auto-generated if omitted) |
| `replayWindowMs` | `number?` | Replay protection window (default: 5 min) |

```ts
import { createAgentIdentity } from '@elsium-ai/agents'

const identity = await createAgentIdentity({ agentId: 'researcher' })

const signed = await identity.sign({ action: 'tool_call', tool: 'search' })

const result = await identity.verify(signed)
// { valid: true }
```

### createIdentityRegistry

```ts
createIdentityRegistry(): IdentityRegistry
```

Central registry for managing and verifying agent identities across a multi-agent system.

```ts
import { createAgentIdentity, createIdentityRegistry } from '@elsium-ai/agents'

const registry = createIdentityRegistry()

const researcher = await createAgentIdentity({ agentId: 'researcher' })
const reviewer = await createAgentIdentity({ agentId: 'reviewer' })

registry.register(researcher)
registry.register(reviewer)

const signed = await researcher.sign({ data: 'findings' })
const verification = await registry.verifySignedPayload(signed)
// { valid: true }
```

---

## Runtime Policy Enforcement

Enforce policies at agent runtime — before each tool call, not just at the HTTP layer.

### createRuntimePolicyEnforcer

```ts
createRuntimePolicyEnforcer(config: RuntimePolicyConfig): RuntimePolicyEnforcer
```

Creates a policy enforcer that checks RBAC, tool access, and custom policies before each tool execution inside the agent loop.

**Config:**

| Field | Type | Description |
|---|---|---|
| `policies` | `PolicySet` | Policy set from `@elsium-ai/core` |
| `actor` | `string?` | Actor identity for policy context |
| `role` | `string?` | Role for policy evaluation |
| `allowedTools` | `string[]?` | Whitelist of allowed tool names |
| `deniedTools` | `string[]?` | Blacklist of denied tool names |

```ts
import { createPolicySet, tokenLimitPolicy } from '@elsium-ai/core'
import { defineAgent, createRuntimePolicyEnforcer, toolAccessPolicy } from '@elsium-ai/agents'

const policies = createPolicySet([
  tokenLimitPolicy(10_000),
  toolAccessPolicy(['search', 'read_file']),
])

const agent = defineAgent({
  name: 'restricted-agent',
  system: 'You are a read-only assistant.',
  guardrails: {
    runtimePolicy: {
      policies,
      role: 'viewer',
      allowedTools: ['search', 'read_file'],
      deniedTools: ['delete_file', 'write_file'],
    },
    maxDurationMs: 30_000,
  },
})
```

### Built-in Policy Factories

| Factory | Description |
|---|---|
| `toolAccessPolicy(tools: string[])` | Restricts tool execution to a whitelist |
| `iterationLimitPolicy(max: number)` | Limits agent iteration count via policy |

---

## Memory Integrity

SHA-256 hash-chained memory stores that detect tampering.

### createSecureMemoryStore

```ts
createSecureMemoryStore(inner: MemoryStore): SecureMemoryStore
```

Wraps any `MemoryStore` with a SHA-256 hash chain. Every message gets a hash binding it to the previous message, forming a tamper-evident chain (same pattern as `createAuditTrail`).

```ts
import { createInMemoryMemoryStore, createSecureMemoryStore } from '@elsium-ai/agents'

const inner = createInMemoryMemoryStore()
const secure = createSecureMemoryStore(inner)

await secure.save('agent-1', messages)

const integrity = await secure.verifyIntegrity('agent-1')
// { valid: true, totalMessages: 5, chainComplete: true }
```

### Utility Functions

| Function | Description |
|---|---|
| `computeMessageHash(msg, index, previousHash)` | Compute SHA-256 hash for a single message in the chain |
| `verifyMessageChain(messages, hashes)` | Verify integrity of a complete message chain |
