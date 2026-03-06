# elsium-ai/agents

Agent orchestration with tool use, memory, guardrails, multi-agent patterns, and state machines.

```ts
import { defineAgent, createMemory, runSequential } from 'elsium-ai/agents'
```

---

## Core

### defineAgent

```ts
defineAgent(config: AgentConfig): Agent
```

Creates an agent that can reason, use tools, and maintain memory across turns.

**Config:**

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Agent identifier |
| `model` | `string` | LLM model to use |
| `systemPrompt` | `string` | System prompt defining agent behavior |
| `tools` | `ToolDefinition[]` | Tools available to the agent |
| `memory` | `Memory` | Memory strategy for conversation history |
| `guardrails` | `Guardrail[]` | Input/output validation guardrails |
| `maxIterations` | `number` | Maximum tool-use loop iterations (default: 10) |

**Returns** an `Agent` with a `run(input, opts?)` method.

```ts
import { defineAgent, createMemory } from 'elsium-ai/agents'

const agent = defineAgent({
  name: 'researcher',
  model: 'claude-sonnet-4-20250514',
  systemPrompt: 'You are a research assistant. Use tools to find and synthesize information.',
  tools: [searchTool, summarizeTool],
  memory: createMemory('sliding-window', { maxMessages: 50 }),
  maxIterations: 15,
})

const result = await agent.run('What are the latest advances in quantum computing?')
// result contains the agent's final response, messages, and metadata
```

---

## Memory

### createMemory

```ts
createMemory(strategy: 'sliding-window' | 'token-limited' | 'unlimited', opts?: MemoryOptions): Memory
```

Creates a memory instance with the specified retention strategy.

| Strategy | Description |
|---|---|
| `sliding-window` | Keeps the last N messages (configure with `maxMessages`) |
| `token-limited` | Keeps messages within a token budget (configure with `maxTokens`) |
| `unlimited` | Retains all messages (use with caution) |

```ts
import { createMemory } from 'elsium-ai/agents'

const memory = createMemory('sliding-window', { maxMessages: 100 })
const tokenMemory = createMemory('token-limited', { maxTokens: 8192 })
const fullMemory = createMemory('unlimited')
```

### createInMemoryMemoryStore

```ts
createInMemoryMemoryStore(): MemoryStore
```

Creates an in-memory message store. Messages are lost when the process exits.

### createSqliteMemoryStore

```ts
createSqliteMemoryStore(path: string): MemoryStore
```

Creates a SQLite-backed persistent message store. Messages survive process restarts.

```ts
import { createMemory, createSqliteMemoryStore } from 'elsium-ai/agents'

const store = createSqliteMemoryStore('./data/memory.db')
const memory = createMemory('sliding-window', {
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
import { createSharedMemory } from 'elsium-ai/agents'

const shared = createSharedMemory()
shared.set('findings', ['result1', 'result2'])
const findings = shared.get('findings')
```

---

## Multi-Agent

### runSequential

```ts
runSequential(agents: Agent[], input: string, opts?: MultiAgentOptions): Promise<AgentResult>
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
import { defineAgent, runSequential, runParallel, runSupervisor, createSharedMemory } from 'elsium-ai/agents'

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

---

## Guardrails

### createSemanticValidator

```ts
createSemanticValidator(config: SemanticValidatorConfig): Guardrail
```

Validates agent outputs for hallucination, relevance, and grounding against source material.

### createAgentSecurity

```ts
createAgentSecurity(config: AgentSecurityConfig): Guardrail
```

Scans for prompt injection, jailbreak attempts, and secrets in agent inputs and outputs.

### createConfidenceScorer

```ts
createConfidenceScorer(config: ConfidenceScorerConfig): Guardrail
```

Scores confidence of agent outputs based on configurable criteria.

```ts
import { defineAgent, createSemanticValidator, createAgentSecurity } from 'elsium-ai/agents'

const agent = defineAgent({
  name: 'assistant',
  model: 'claude-sonnet-4-20250514',
  systemPrompt: 'You are a helpful assistant.',
  guardrails: [
    createSemanticValidator({
      checkHallucination: true,
      checkRelevance: true,
    }),
    createAgentSecurity({
      detectInjection: true,
      detectJailbreak: true,
      redactSecrets: true,
    }),
  ],
})
```

### createApprovalGate / shouldRequireApproval

```ts
createApprovalGate(config: ApprovalGateConfig): ApprovalGate
shouldRequireApproval(action: AgentAction, gate: ApprovalGate): boolean
```

Human-in-the-loop approval for sensitive agent actions.

```ts
import { createApprovalGate, shouldRequireApproval } from 'elsium-ai/agents'

const gate = createApprovalGate({
  requireApprovalFor: ['delete', 'send-email', 'execute-code'],
  autoApprove: ['search', 'summarize'],
})

if (shouldRequireApproval(action, gate)) {
  const approved = await requestHumanApproval(action)
  if (!approved) return
}
```

---

## State Machine

### executeStateMachine

```ts
executeStateMachine(
  agent: Agent,
  states: StateMachineConfig,
  input: string,
  opts?: StateMachineOptions,
): Promise<AgentResult>
```

Runs an agent through a defined state machine. Each state defines transitions that determine the next state based on the agent's output. Context is threaded through all transitions.

**Transition return types:**
- `string` -- name of the next state
- `{ next: string; context?: Record<string, unknown> }` -- next state with updated context

```ts
import { defineAgent, executeStateMachine } from 'elsium-ai/agents'

const agent = defineAgent({ name: 'support', model: 'claude-sonnet-4-20250514', /* ... */ })

const result = await executeStateMachine(agent, {
  initial: 'classify',
  states: {
    classify: {
      systemPrompt: 'Classify the user issue as billing, technical, or general.',
      transitions: (output, ctx) => {
        if (output.includes('billing')) return { next: 'billing', context: { type: 'billing' } }
        if (output.includes('technical')) return 'technical'
        return 'general'
      },
    },
    billing: {
      systemPrompt: 'Help the user with their billing issue.',
      transitions: () => 'resolve',
    },
    technical: {
      systemPrompt: 'Help the user with their technical issue.',
      transitions: () => 'resolve',
    },
    general: {
      systemPrompt: 'Help the user with their general inquiry.',
      transitions: () => 'resolve',
    },
    resolve: {
      systemPrompt: 'Summarize the resolution and ask if there is anything else.',
      transitions: () => null, // terminal state
    },
  },
}, 'I was double-charged on my last invoice')
```
