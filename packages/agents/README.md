# @elsium-ai/agents

Agent orchestration, memory, guardrails, and multi-agent patterns for [ElsiumAI](https://github.com/elsium-ai/elsium-ai).

[![npm](https://img.shields.io/npm/v/@elsium-ai/agents.svg)](https://www.npmjs.com/package/@elsium-ai/agents)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE)

## Install

```bash
npm install @elsium-ai/agents @elsium-ai/core
```

## What's Inside

| Category | Exports | Description |
|---|---|---|
| **Agent** | `defineAgent`, `Agent`, `AgentDependencies` | Define and run a single agent with tools, memory, and guardrails |
| **Types** | `AgentConfig`, `AgentResult`, `AgentRunOptions`, `AgentHooks`, `GuardrailConfig`, `StateDefinition`, `StateHistoryEntry`, `StateMachineResult` | Core type definitions used across the package |
| **Memory** | `createMemory`, `Memory`, `MemoryConfig`, `MemoryStrategy` | Conversation history management with configurable retention strategies |
| **Multi-Agent** | `runSequential`, `runParallel`, `runSupervisor`, `MultiAgentConfig` | Orchestrate multiple agents in sequence, parallel, or supervisor patterns |
| **Semantic Guardrails** | `createSemanticValidator`, `SemanticGuardrailConfig`, `SemanticCheck`, `SemanticCheckResult`, `SemanticValidationResult`, `SemanticValidator` | Hallucination detection, relevance checking, and grounding validation |
| **Security** | `createAgentSecurity`, `AgentSecurityConfig`, `AgentSecurityResult` | Prompt injection detection, jailbreak prevention, and secret redaction |
| **Confidence** | `createConfidenceScorer`, `ConfidenceConfig`, `ConfidenceResult` | Score agent output confidence with heuristic and semantic signals |
| **State Machine** | `executeStateMachine` | Run an agent through a finite state machine of states and transitions |
| **Approval Gates** | `createApprovalGate`, `shouldRequireApproval`, `ApprovalRequest`, `ApprovalDecision`, `ApprovalCallback`, `ApprovalGateConfig`, `ApprovalGate` | Human-in-the-loop approval for high-stakes operations |

---

## Agent

### `defineAgent`

Create a new agent instance from a configuration object and a set of dependencies.

```ts
function defineAgent(config: AgentConfig, deps: AgentDependencies): Agent
```

| Parameter | Type | Description |
|---|---|---|
| `config` | `AgentConfig` | Full agent configuration (name, system prompt, tools, guardrails, etc.) |
| `deps` | `AgentDependencies` | External dependencies the agent requires (currently an LLM completion function) |

**Returns:** `Agent`

```ts
import { defineAgent } from '@elsium-ai/agents'

const agent = defineAgent(
  {
    name: 'assistant',
    system: 'You are a helpful assistant.',
    model: 'claude-sonnet-4-6',
  },
  { complete: (req) => llm.complete(req) },
)

const result = await agent.run('Explain circuit breakers in distributed systems.')
console.log(result.message.content)
```

### `Agent`

The object returned by `defineAgent`. Provides methods for running the agent and managing memory.

```ts
interface Agent {
  readonly name: string
  readonly config: AgentConfig
  run(input: string, options?: AgentRunOptions): Promise<AgentResult>
  chat(messages: Message[], options?: AgentRunOptions): Promise<AgentResult>
  resetMemory(): void
}
```

| Method | Description |
|---|---|
| `run(input, options?)` | Run the agent with a single string input. If `states` and `initialState` are configured, the agent runs in state-machine mode. |
| `chat(messages, options?)` | Run the agent with an array of `Message` objects for multi-turn conversations. |
| `resetMemory()` | Clear the agent's conversation memory. |

### `AgentDependencies`

Dependencies injected into an agent at creation time.

```ts
interface AgentDependencies {
  complete: (request: CompletionRequest) => Promise<LLMResponse>
}
```

---

## Types

### `AgentConfig`

Top-level configuration for creating an agent.

```ts
interface AgentConfig {
  name: string
  model?: string
  system: string
  tools?: Tool[]
  memory?: MemoryConfig
  guardrails?: GuardrailConfig
  hooks?: AgentHooks
  confidence?: boolean | ConfidenceConfig
  states?: Record<string, StateDefinition>
  initialState?: string
}
```

### `AgentResult`

The result returned after an agent run completes.

```ts
interface AgentResult {
  message: Message
  usage: {
    totalInputTokens: number
    totalOutputTokens: number
    totalTokens: number
    totalCost: number
    iterations: number
  }
  toolCalls: Array<{
    name: string
    arguments: Record<string, unknown>
    result: ToolExecutionResult
  }>
  traceId: string
  confidence?: ConfidenceResult
}
```

### `AgentRunOptions`

Optional parameters passed to `agent.run()` or `agent.chat()`.

```ts
interface AgentRunOptions {
  signal?: AbortSignal
  traceId?: string
  metadata?: Record<string, unknown>
}
```

### `AgentHooks`

Lifecycle hooks that fire at various points during the agent loop.

```ts
interface AgentHooks {
  onMessage?: (message: Message) => void | Promise<void>
  onToolCall?: (call: { name: string; arguments: Record<string, unknown> }) => void | Promise<void>
  onToolResult?: (result: ToolExecutionResult) => void | Promise<void>
  onError?: (error: Error) => void | Promise<void>
  onComplete?: (result: AgentResult) => void | Promise<void>
  onApprovalRequired?: ApprovalCallback
}
```

### `GuardrailConfig`

Configuration for input/output validation, semantic checks, security, and approval gates.

```ts
interface GuardrailConfig {
  maxIterations?: number
  maxTokenBudget?: number
  inputValidator?: (input: string) => boolean | string
  outputValidator?: (output: string) => boolean | string
  semantic?: SemanticGuardrailConfig
  security?: AgentSecurityConfig
  approval?: ApprovalGateConfig
}
```

### `StateDefinition`

Defines a single state within a state-machine agent.

```ts
interface StateDefinition {
  system?: string
  tools?: Tool[]
  guardrails?: GuardrailConfig
  transition: (result: AgentResult) => string
  terminal?: boolean
}
```

### `StateHistoryEntry`

A record of a single state execution and its transition.

```ts
interface StateHistoryEntry {
  state: string
  result: AgentResult
  transitionedTo: string | null
}
```

### `StateMachineResult`

Extends `AgentResult` with state-machine-specific data.

```ts
interface StateMachineResult extends AgentResult {
  stateHistory: StateHistoryEntry[]
  finalState: string
}
```

---

## Memory

### `createMemory`

Create a memory instance that manages conversation history with a configurable retention strategy.

```ts
function createMemory(config: MemoryConfig): Memory
```

| Parameter | Type | Description |
|---|---|---|
| `config` | `MemoryConfig` | Strategy and limits for memory retention |

**Returns:** `Memory`

```ts
import { createMemory } from '@elsium-ai/agents'

const memory = createMemory({
  strategy: 'sliding-window',
  maxMessages: 50,
})

memory.add({ role: 'user', content: 'Hello' })
memory.add({ role: 'assistant', content: 'Hi there!' })

console.log(memory.getMessages())       // [{ role: 'user', ... }, { role: 'assistant', ... }]
console.log(memory.getTokenEstimate())   // approximate token count
```

### `Memory`

The memory interface returned by `createMemory`.

```ts
interface Memory {
  readonly strategy: MemoryStrategy
  add(message: Message): void
  getMessages(): Message[]
  clear(): void
  getTokenEstimate(): number
}
```

| Method | Description |
|---|---|
| `add(message)` | Append a message. Automatically trims based on the configured strategy. |
| `getMessages()` | Return a copy of all stored messages. |
| `clear()` | Remove all messages from memory. |
| `getTokenEstimate()` | Return an approximate token count across all stored messages. |

### `MemoryConfig`

Configuration for a memory instance.

```ts
interface MemoryConfig {
  strategy: MemoryStrategy
  maxTokens?: number
  maxMessages?: number
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `strategy` | `MemoryStrategy` | -- | Retention strategy to use |
| `maxTokens` | `number` | `128000` | Maximum estimated tokens (used by `token-limited`) |
| `maxMessages` | `number` | `100` | Maximum number of messages (used by `sliding-window`) |

### `MemoryStrategy`

The available memory retention strategies.

```ts
type MemoryStrategy = 'sliding-window' | 'token-limited' | 'unlimited'
```

| Strategy | Behavior |
|---|---|
| `sliding-window` | Keeps the most recent `maxMessages` messages, dropping the oldest first |
| `token-limited` | Keeps messages within `maxTokens`, dropping the oldest first when the budget is exceeded |
| `unlimited` | Retains all messages without any trimming |

---

## Multi-Agent

### `runSequential`

Run multiple agents in sequence, piping the text output of each agent as the input to the next.

```ts
function runSequential(
  agents: Agent[],
  input: string,
  options?: AgentRunOptions,
): Promise<AgentResult[]>
```

| Parameter | Type | Description |
|---|---|---|
| `agents` | `Agent[]` | Ordered list of agents to run |
| `input` | `string` | Initial input for the first agent |
| `options` | `AgentRunOptions` | Shared run options for all agents |

**Returns:** `Promise<AgentResult[]>` -- one result per agent, in order.

```ts
import { defineAgent, runSequential } from '@elsium-ai/agents'

const researcher = defineAgent(
  { name: 'researcher', system: 'Research the topic thoroughly.' },
  { complete: (req) => llm.complete(req) },
)
const writer = defineAgent(
  { name: 'writer', system: 'Write a polished article from the research.' },
  { complete: (req) => llm.complete(req) },
)

const results = await runSequential([researcher, writer], 'Quantum computing basics')
const finalArticle = results[1].message.content
```

### `runParallel`

Run multiple agents concurrently on the same input. Uses `Promise.allSettled` internally so that partial results are returned even if some agents fail.

```ts
function runParallel(
  agents: Agent[],
  input: string,
  options?: AgentRunOptions,
): Promise<AgentResult[]>
```

| Parameter | Type | Description |
|---|---|---|
| `agents` | `Agent[]` | Agents to run in parallel |
| `input` | `string` | Input provided to every agent |
| `options` | `AgentRunOptions` | Shared run options |

**Returns:** `Promise<AgentResult[]>` -- results from all agents that completed successfully. Throws the first error only if all agents fail.

```ts
import { defineAgent, runParallel } from '@elsium-ai/agents'

const optimist = defineAgent(
  { name: 'optimist', system: 'Present the optimistic perspective.' },
  { complete: (req) => llm.complete(req) },
)
const critic = defineAgent(
  { name: 'critic', system: 'Present a critical analysis.' },
  { complete: (req) => llm.complete(req) },
)

const results = await runParallel([optimist, critic], 'Should we adopt microservices?')
```

### `runSupervisor`

Run a supervisor agent that coordinates a set of worker agents. The supervisor receives descriptions of all workers and the user request, and decides how to delegate.

```ts
function runSupervisor(
  supervisor: Agent,
  workers: Agent[],
  input: string,
  options?: AgentRunOptions,
): Promise<AgentResult>
```

| Parameter | Type | Description |
|---|---|---|
| `supervisor` | `Agent` | The coordinating agent |
| `workers` | `Agent[]` | Available worker agents (their names and system prompts are provided to the supervisor) |
| `input` | `string` | User request to delegate |
| `options` | `AgentRunOptions` | Shared run options |

**Returns:** `Promise<AgentResult>` -- the supervisor's synthesized response.

```ts
import { defineAgent, runSupervisor } from '@elsium-ai/agents'

const supervisor = defineAgent(
  { name: 'supervisor', system: 'Coordinate workers to answer the user.' },
  { complete: (req) => llm.complete(req) },
)
const coder = defineAgent(
  { name: 'coder', system: 'Write code solutions.' },
  { complete: (req) => llm.complete(req) },
)
const reviewer = defineAgent(
  { name: 'reviewer', system: 'Review code for bugs and improvements.' },
  { complete: (req) => llm.complete(req) },
)

const result = await runSupervisor(supervisor, [coder, reviewer], 'Build a rate limiter in TypeScript')
```

### `MultiAgentConfig`

Configuration type for multi-agent orchestration (useful when building higher-level abstractions).

```ts
interface MultiAgentConfig {
  agents: Agent[]
  strategy: 'sequential' | 'parallel' | 'supervisor'
  supervisor?: Agent
}
```

---

## Semantic Guardrails

### `createSemanticValidator`

Create a semantic validator that checks agent output for hallucinations, relevance, and grounding. When an `llmComplete` function is provided, checks use LLM-based evaluation; otherwise they fall back to word-overlap heuristics.

```ts
function createSemanticValidator(
  config: SemanticGuardrailConfig,
  llmComplete?: LLMComplete,
): SemanticValidator
```

| Parameter | Type | Description |
|---|---|---|
| `config` | `SemanticGuardrailConfig` | Which checks to enable and their thresholds |
| `llmComplete` | `(request: CompletionRequest) => Promise<LLMResponse>` | Optional LLM function for production-grade checks |

**Returns:** `SemanticValidator`

```ts
import { createSemanticValidator } from '@elsium-ai/agents'

const validator = createSemanticValidator(
  {
    hallucination: { enabled: true, ragContext: ['The capital of France is Paris.'], threshold: 0.7 },
    relevance: { enabled: true, threshold: 0.5 },
  },
  (req) => llm.complete(req),
)

const result = await validator.validate(
  'What is the capital of France?',
  'The capital of France is Paris.',
)
console.log(result.valid)   // true
console.log(result.checks)  // [{ name: 'hallucination', passed: true, ... }, ...]
```

### `SemanticValidator`

The validator object returned by `createSemanticValidator`.

```ts
interface SemanticValidator {
  validate(input: string, output: string): Promise<SemanticValidationResult>
  checkHallucination(output: string, context: string[]): Promise<SemanticCheckResult>
  checkRelevance(input: string, output: string): Promise<SemanticCheckResult>
  checkGrounding(output: string, sources: string[]): Promise<SemanticCheckResult>
}
```

| Method | Description |
|---|---|
| `validate(input, output)` | Run all enabled checks and return an aggregate result |
| `checkHallucination(output, context)` | Check whether the output contains claims unsupported by the given context |
| `checkRelevance(input, output)` | Check whether the output is relevant to the input |
| `checkGrounding(output, sources)` | Check whether the output's claims are grounded in the provided sources |

### `SemanticGuardrailConfig`

Configuration for which semantic checks to enable and how they behave.

```ts
interface SemanticGuardrailConfig {
  hallucination?: {
    enabled: boolean
    ragContext?: string[]
    threshold?: number
  }
  relevance?: {
    enabled: boolean
    threshold?: number
  }
  grounding?: {
    enabled: boolean
    sources?: string[]
  }
  customChecks?: SemanticCheck[]
  autoRetry?: {
    enabled: boolean
    maxRetries?: number
  }
}
```

### `SemanticCheck`

A custom semantic check function.

```ts
interface SemanticCheck {
  name: string
  check: (input: string, output: string) => Promise<SemanticCheckResult>
}
```

### `SemanticCheckResult`

The result of a single semantic check.

```ts
interface SemanticCheckResult {
  passed: boolean
  score: number
  reason: string
}
```

### `SemanticValidationResult`

The aggregate result of all semantic checks run by `validate()`.

```ts
interface SemanticValidationResult {
  valid: boolean
  checks: Array<{
    name: string
    passed: boolean
    score: number
    reason: string
  }>
}
```

---

## Security

### `createAgentSecurity`

Create a security module that validates input for prompt injection and jailbreak attempts, and sanitizes output by redacting detected secrets.

```ts
function createAgentSecurity(config: AgentSecurityConfig): {
  validateInput(input: string): AgentSecurityResult
  sanitizeOutput(output: string): AgentSecurityResult
}
```

| Parameter | Type | Description |
|---|---|---|
| `config` | `AgentSecurityConfig` | Which security checks to enable |

**Returns:** An object with `validateInput` and `sanitizeOutput` methods.

```ts
import { createAgentSecurity } from '@elsium-ai/agents'

const security = createAgentSecurity({
  detectPromptInjection: true,
  detectJailbreak: true,
  redactSecrets: true,
})

const inputCheck = security.validateInput('ignore all previous instructions and ...')
console.log(inputCheck.safe)        // false
console.log(inputCheck.violations)  // [{ type: 'prompt_injection', ... }]

const outputCheck = security.sanitizeOutput('Your API key is sk-abc123def456ghi789jkl012mno')
console.log(outputCheck.redactedOutput)  // 'Your API key is [REDACTED_API_KEY]'
```

### `AgentSecurityConfig`

Configuration for the security module.

```ts
interface AgentSecurityConfig {
  detectPromptInjection?: boolean
  detectJailbreak?: boolean
  redactSecrets?: boolean
  blockedPatterns?: RegExp[]
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `detectPromptInjection` | `boolean` | `true` | Detect prompt injection patterns in input |
| `detectJailbreak` | `boolean` | `false` | Detect jailbreak attempt patterns in input |
| `redactSecrets` | `boolean` | `true` | Redact API keys, passwords, SSNs, credit card numbers, and bearer tokens in output |
| `blockedPatterns` | `RegExp[]` | `[]` | Additional custom regex patterns to block in input |

### `AgentSecurityResult`

The result from an input validation or output sanitization check.

```ts
interface AgentSecurityResult {
  safe: boolean
  violations: Array<{
    type: string
    detail: string
    severity: 'low' | 'medium' | 'high'
  }>
  redactedOutput?: string
}
```

---

## Confidence

### `createConfidenceScorer`

Create a confidence scorer that evaluates how reliable an agent's output is. When semantic validation results are available they are used directly; otherwise heuristic word-overlap analysis is applied.

```ts
function createConfidenceScorer(config: ConfidenceConfig): {
  score(
    input: string,
    output: string,
    semanticResult?: SemanticValidationResult,
  ): Promise<ConfidenceResult>
}
```

| Parameter | Type | Description |
|---|---|---|
| `config` | `ConfidenceConfig` | Which confidence signals to compute |

**Returns:** An object with a `score` method.

```ts
import { createConfidenceScorer } from '@elsium-ai/agents'

const scorer = createConfidenceScorer({
  hallucinationRisk: true,
  relevanceScore: true,
  citationCoverage: false,
})

const confidence = await scorer.score(
  'What is TypeScript?',
  'TypeScript is a typed superset of JavaScript.',
)
console.log(confidence.overall)           // 0.0 - 1.0
console.log(confidence.hallucinationRisk) // 0.0 - 1.0 (lower is better)
console.log(confidence.relevanceScore)    // 0.0 - 1.0 (higher is better)
```

### `ConfidenceConfig`

Configuration for the confidence scorer.

```ts
interface ConfidenceConfig {
  hallucinationRisk?: boolean
  relevanceScore?: boolean
  citationCoverage?: boolean
  customChecks?: Array<{
    name: string
    check: (input: string, output: string) => Promise<{ score: number; reason: string }>
  }>
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `hallucinationRisk` | `boolean` | `true` | Compute hallucination risk (higher score = higher risk) |
| `relevanceScore` | `boolean` | `true` | Compute relevance to input (higher score = more relevant) |
| `citationCoverage` | `boolean` | `false` | Compute citation coverage against RAG context |
| `customChecks` | `Array` | `[]` | Additional custom scoring functions |

### `ConfidenceResult`

The scored confidence output.

```ts
interface ConfidenceResult {
  overall: number
  hallucinationRisk: number
  citationCoverage: number
  relevanceScore: number
  checks: Array<{ name: string; score: number; reason: string }>
}
```

---

## State Machine

### `executeStateMachine`

Execute an agent through a finite state machine. Each state can override the system prompt, tools, and guardrails. The agent transitions between states based on the `transition` function defined on each `StateDefinition` until a terminal state is reached.

```ts
function executeStateMachine(
  baseConfig: AgentConfig,
  stateConfig: { states: Record<string, StateDefinition>; initialState: string },
  deps: AgentDependencies,
  input: string,
  options?: AgentRunOptions,
): Promise<StateMachineResult>
```

| Parameter | Type | Description |
|---|---|---|
| `baseConfig` | `AgentConfig` | Base agent configuration (model, default system prompt, guardrails) |
| `stateConfig` | `{ states, initialState }` | State definitions and the name of the initial state |
| `deps` | `AgentDependencies` | LLM completion function |
| `input` | `string` | User input |
| `options` | `AgentRunOptions` | Optional run options |

**Returns:** `Promise<StateMachineResult>` -- the final agent result plus the full state history.

```ts
import { defineAgent } from '@elsium-ai/agents'

const agent = defineAgent(
  {
    name: 'order-processor',
    system: 'You process customer orders.',
    initialState: 'intake',
    states: {
      intake: {
        system: 'Gather order details from the user.',
        transition: (result) => 'validate',
      },
      validate: {
        system: 'Validate the order details are complete.',
        transition: (result) => 'confirm',
      },
      confirm: {
        system: 'Confirm the order with the user.',
        terminal: true,
        transition: () => 'confirm',
      },
    },
  },
  { complete: (req) => llm.complete(req) },
)

const result = await agent.run('I want to order 3 widgets')
console.log(result.finalState)   // 'confirm'
console.log(result.stateHistory) // [{ state: 'intake', ... }, { state: 'validate', ... }, ...]
```

Note: You do not need to call `executeStateMachine` directly. When `states` and `initialState` are set on the `AgentConfig`, calling `agent.run()` or `agent.chat()` automatically delegates to the state machine.

---

## Approval Gates

### `createApprovalGate`

Create an approval gate that intercepts operations and requests human (or programmatic) approval before proceeding.

```ts
function createApprovalGate(config: ApprovalGateConfig): ApprovalGate
```

| Parameter | Type | Description |
|---|---|---|
| `config` | `ApprovalGateConfig` | Callback, filters, timeout, and timeout behavior |

**Returns:** `ApprovalGate`

```ts
import { createApprovalGate } from '@elsium-ai/agents'

const gate = createApprovalGate({
  callback: async (request) => {
    console.log(`Approval needed: ${request.description}`)
    // In production, prompt a human or call an external approval service
    return {
      requestId: request.id,
      approved: true,
      reason: 'Auto-approved in development',
      decidedAt: Date.now(),
    }
  },
  requireApprovalFor: {
    tools: ['delete_record', 'send_email'],
    costThreshold: 1.0,
  },
  timeoutMs: 60_000,
  onTimeout: 'deny',
})

const decision = await gate.requestApproval(
  'tool_call',
  'Execute tool: delete_record',
  { toolName: 'delete_record', arguments: { id: '123' } },
)
console.log(decision.approved) // true
```

### `shouldRequireApproval`

Determine whether a given operation should be gated behind approval based on the configured rules.

```ts
function shouldRequireApproval(
  config: ApprovalGateConfig['requireApprovalFor'],
  context: { toolName?: string; model?: string; cost?: number },
): boolean
```

| Parameter | Type | Description |
|---|---|---|
| `config` | `ApprovalGateConfig['requireApprovalFor']` | The approval rules (which tools, models, or cost thresholds require approval) |
| `context` | `{ toolName?, model?, cost? }` | The current operation context to check |

**Returns:** `boolean` -- `true` if the operation requires approval.

```ts
import { shouldRequireApproval } from '@elsium-ai/agents'

const needsApproval = shouldRequireApproval(
  { tools: ['delete_record'], costThreshold: 5.0 },
  { toolName: 'delete_record' },
)
console.log(needsApproval) // true
```

### `ApprovalRequest`

Describes a pending approval request.

```ts
interface ApprovalRequest {
  id: string
  type: 'tool_call' | 'model_access' | 'budget_exceed' | 'custom'
  description: string
  context: Record<string, unknown>
  requestedAt: number
}
```

### `ApprovalDecision`

The decision returned by the approval callback.

```ts
interface ApprovalDecision {
  requestId: string
  approved: boolean
  reason?: string
  decidedBy?: string
  decidedAt: number
}
```

### `ApprovalCallback`

The function type called when approval is required.

```ts
type ApprovalCallback = (request: ApprovalRequest) => Promise<ApprovalDecision>
```

### `ApprovalGateConfig`

Configuration for the approval gate.

```ts
interface ApprovalGateConfig {
  callback: ApprovalCallback
  requireApprovalFor?: {
    tools?: string[] | boolean
    models?: string[]
    costThreshold?: number
  }
  timeoutMs?: number
  onTimeout?: 'deny' | 'allow'
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `callback` | `ApprovalCallback` | -- | Function invoked when approval is needed |
| `requireApprovalFor` | `object` | -- | Rules defining which operations require approval |
| `requireApprovalFor.tools` | `string[] \| boolean` | -- | Tool names that require approval, or `true` for all tools |
| `requireApprovalFor.models` | `string[]` | -- | Model identifiers that require approval |
| `requireApprovalFor.costThreshold` | `number` | -- | Cost threshold above which approval is required |
| `timeoutMs` | `number` | `300000` | Milliseconds to wait for approval before timing out |
| `onTimeout` | `'deny' \| 'allow'` | `'deny'` | Behavior when the approval request times out |

### `ApprovalGate`

The approval gate object returned by `createApprovalGate`.

```ts
interface ApprovalGate {
  requestApproval(
    type: ApprovalRequest['type'],
    description: string,
    context: Record<string, unknown>,
  ): Promise<ApprovalDecision>
  readonly pendingCount: number
}
```

---

## Part of ElsiumAI

This package is the agent layer of the [ElsiumAI](https://github.com/elsium-ai/elsium-ai) framework. See the [full documentation](https://github.com/elsium-ai/elsium-ai) for guides and examples.

## License

[MIT](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE)
