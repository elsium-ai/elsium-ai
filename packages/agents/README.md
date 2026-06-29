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
| **Security** | `createAgentSecurity`, `AgentSecurityConfig`, `AgentSecurityResult`, `createLLMGuardrail`, `InputGuardrail`, `LLMGuardrailOptions` | Prompt injection detection, jailbreak prevention, input/output secret + PII redaction, tool-argument redaction, and a pluggable async injection classifier (with a built-in LLM-backed implementation) |
| **Confidence** | `createConfidenceScorer`, `ConfidenceConfig`, `ConfidenceResult` | Score agent output confidence with heuristic and semantic signals |
| **State Machine** | `executeStateMachine` | Run an agent through a finite state machine of states and transitions |
| **Approval Gates** | `createApprovalGate`, `shouldRequireApproval`, `ApprovalRequest`, `ApprovalDecision`, `ApprovalCallback`, `ApprovalGateConfig`, `ApprovalGate` | Human-in-the-loop approval for high-stakes operations |
| **`askHuman`** | `askHuman`, `createInMemoryAskHumanStore`, `resolveAskHuman`, `AskHumanStore`, `AskHumanRequest`, `AskHumanDecision`, `AskHumanRecord`, `AskHumanResponder`, `AskHumanOptions`, `AskHumanStatus` | Standalone unified API for human-in-the-loop pauses. Two modes: responder callback (raced against timeout) or store-backed durable (out-of-band `resolveAskHuman` call). `timeoutMs` accepts a number or a string suffix (`'5s' \| '2m' \| '1h' \| '7d'`). Designed to pair with an `AsyncAgent` task store so the agent state survives a server restart. |
| **Verification (VAG)** | `runWithVerification`, `composeValidators`, `zodValidator`, `regexValidator`, `semanticAdapter`, `externalValidator`, `Validator`, `VerificationConfig`, `VerificationOutcome`, `RepairContext` | `generate → validate → repair-or-abort` pipeline. Validators (Zod schema, regex, semantic LLM-as-judge, external check) compose; failures are formatted as a repair prompt re-injected into the next generation. Returns `{ status: 'ok' \| 'repaired' \| 'aborted', value, attempts, history }`. |
| **Confidence Strategies (CAG)** | `selfConsistency`, `judgeEnsemble`, `logprobScore`, `createMajorityVoter`, `createSimilarityVoter`, `requireConfidence`, `ConfidenceTooLowError`, `ConfidenceStrategy`, `CalibratedScore` | Pluggable confidence strategies — self-consistency (N samples + voting), judge ensemble (M judges, mean/median/min), logprob (geometric-mean / mean / min over token logprobs). `requireConfidence(generate, { min, below: 'abort' \| 'escalate' \| callback })` is the threshold gate. Composes with VAG. |
| **Fluent verification** | `agent.withVerifier(v)`, `agent.withRetryPolicy({ maxAttempts, semantic })`, `withVerifiers`, `schemaValidator`, `judgeValidator`, `JudgeValidatorOptions`, `AgentRetryPolicy` | Chainable, immutable verification on any agent returned by `defineAgent`. Internally loops via `runWithVerification`. Validators operate on `AgentResult`. `schemaValidator` is the spec-named alias of `zodValidator`. `judgeValidator({ rubric, judge, threshold? })` wraps any user-supplied LLM-as-judge against a free-text rubric. Zero overhead when no verifier is attached. |
| **`agent.askHuman({...})`** | `agent.askHuman({ question, options, context, timeout, ... })` | Method on every agent — same options as the standalone `askHuman` plus `timeout` accepted as a duration string (`'5s' \| '2m' \| '1h' \| '7d'`) or a number in ms. Delegates internally; both APIs interchangeable. |
| **Pause + resume** | `agent.runResumable(input, options, { stateStore })`, `agent.resume(resumeToken, { followUpMessage })`, `runResumable`, `resumeAgent`, `AgentSnapshot`, `AgentRunOutcome` | Snapshot the agent's conversation to a `StateStore` when a tool calls `pauseAgent(reason)`. Returns `{ status: 'paused', resumeToken }`. `resume()` loads the snapshot and continues. MVP — snapshot only at explicit pause points; not full crash recovery. |
| **Auto-record + replay** | `agent.getTrace(traceId)`, `agent.listTraces()`, `agent.replayFrom(traceId, { fromStep, overrides })` | Every `agent.run()` records each LLM iteration as a step in an in-memory ring buffer (cap 100). `replayFrom` re-runs the trace with selective overrides via the core `replayFrom` primitive. MVP — LLM steps only, in-memory. |

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
  seed?: number
}
```

The optional `seed` is forwarded to every LLM `CompletionRequest` the agent makes (the tool loop and streaming), so a run can be reproduced by setting the same value. It is overridable per call via `AgentRunOptions.seed`. **Caveat:** `seed` only has an effect if the underlying provider honors it (forwarded where supported, e.g. OpenAI and Google; absent on Anthropic). It does not, by itself, make a hosted model deterministic — pair it with the `@elsium-ai/testing` `assertDeterministic` helper (which measures variance, it does not enforce it) to check reproducibility. See `examples/reproducible-run`.

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
  seed?: number
}
```

`seed` overrides `AgentConfig.seed` for a single `run` / `chat` / `generate` call, falling back to the agent-level value when omitted.

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

### Shared Memory

Agents in a multi-agent orchestration can share data through a `SharedMemory` instance. Each agent's output is automatically stored in shared memory keyed by agent name, and agents can read data written by previous agents.

```ts
import { createSharedMemory, runSequential } from '@elsium-ai/agents'

const memory = createSharedMemory()

// Share data between agents
memory.set('context', { topic: 'AI safety' })

// Use with multi-agent orchestration
const result = await runSequential(agents, input, { sharedMemory: memory })

// Each agent's output is stored in shared memory keyed by agent name
const allData = memory.getAll()
```

The `SharedMemory` interface:

```ts
interface SharedMemory {
  get<T = unknown>(key: string): T | undefined
  set(key: string, value: unknown): void
  has(key: string): boolean
  delete(key: string): boolean
  getAll(): Record<string, unknown>
  clear(): void
}
```

Pass shared memory via `MultiAgentOptions`:

```ts
interface MultiAgentOptions extends AgentRunOptions {
  sharedMemory?: SharedMemory
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

Create a security module that validates input for prompt injection and jailbreak attempts, redacts secrets / PII from input before it reaches the model, and sanitizes output by redacting detected secrets.

```ts
function createAgentSecurity(config: AgentSecurityConfig): {
  validateInput(input: string): AgentSecurityResult
  sanitizeInput(input: string): AgentSecurityResult
  sanitizeOutput(output: string): AgentSecurityResult
}
```

| Parameter | Type | Description |
|---|---|---|
| `config` | `AgentSecurityConfig` | Which security checks to enable |

**Returns:** An object with `validateInput`, `sanitizeInput`, and `sanitizeOutput` methods.

```ts
import { createAgentSecurity } from '@elsium-ai/agents'

const security = createAgentSecurity({
  detectPromptInjection: true,
  detectJailbreak: true,
  redactSecrets: true,
  redactInputSecrets: true,
  redactInputPii: ['email', 'phone'],
})

const inputCheck = security.validateInput('ignore all previous instructions and ...')
console.log(inputCheck.safe)        // false
console.log(inputCheck.violations)  // [{ type: 'prompt_injection', ... }]

// Redact secrets / PII from the raw input *before* it is sent to the model
const sanitizedInput = security.sanitizeInput('my key is sk-abc123def456ghi789 and email a@b.com')
console.log(sanitizedInput.redactedOutput)  // '...[REDACTED_API_KEY]... [REDACTED_EMAIL]'

const outputCheck = security.sanitizeOutput('Your API key is sk-abc123def456ghi789jkl012mno')
console.log(outputCheck.redactedOutput)  // 'Your API key is [REDACTED_API_KEY]'
```

When wired into an agent via `guardrails.security`, the input guardrail pipeline runs in this order on `run` / `chat` / `generate`:

1. **Detection** — `validateInput` (and any `injectionClassifier`) throw on a violation, rejecting the input.
2. **Async classifier** — the optional `injectionClassifier` runs on the raw input and throws if it flags an injection attempt.
3. **Redaction** — `sanitizeInput` transforms the input (secrets / PII) before it reaches the model.

`stream` applies only the synchronous steps (detection + redaction); the async `injectionClassifier` is skipped, since it would block stream construction. See `examples/input-guardrails`.

### `AgentSecurityConfig`

Configuration for the security module.

```ts
interface AgentSecurityConfig {
  detectPromptInjection?: boolean
  detectJailbreak?: boolean
  redactSecrets?: boolean
  blockedPatterns?: RegExp[]
  redactInputSecrets?: boolean
  redactInputPii?: Array<'email' | 'phone' | 'address' | 'passport' | 'all'>
  injectionClassifier?: (input: string) => boolean | Promise<boolean>
  redactToolArgSecrets?: boolean
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `detectPromptInjection` | `boolean` | `true` | Detect prompt injection patterns in input |
| `detectJailbreak` | `boolean` | `false` | Detect jailbreak attempt patterns in input |
| `redactSecrets` | `boolean` | `true` | Redact API keys, passwords, SSNs, credit card numbers, and bearer tokens in output |
| `blockedPatterns` | `RegExp[]` | `[]` | Additional custom regex patterns to block in input |
| `redactInputSecrets` | `boolean` | `false` | Redact secrets from user input *before* it reaches the model |
| `redactInputPii` | `Array<'email' \| 'phone' \| 'address' \| 'passport' \| 'all'>` | `[]` | PII categories to redact from input. Setting any category also redacts secrets from the input |
| `injectionClassifier` | `(input: string) => boolean \| Promise<boolean>` | -- | Optional async classifier (type `InputGuardrail`) run on the raw input; return `true` to reject it as an injection attempt. Applied on `run` / `chat` / `generate`, not on `stream` |
| `redactToolArgSecrets` | `boolean` | `false` | Redact secrets from tool-call arguments before they are executed and recorded in the trace. PII is intentionally *not* redacted from arguments, to avoid breaking tools that legitimately need it |

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

### `InputGuardrail` and `createLLMGuardrail`

`InputGuardrail` is the input-guardrail port — an async predicate that returns `true` to **reject** an input (treat it as a prompt-injection / jailbreak attempt) or `false` to allow it. It is the type accepted by `AgentSecurityConfig.injectionClassifier`.

```ts
type InputGuardrail = (input: string) => boolean | Promise<boolean>
```

This is the extension point for external integrations: plug in your own function wrapping Lakera, NeMo Guardrails, Rebuff, Presidio, etc. The framework is self-sufficient — integrating something external is the caller's choice, never a dependency.

`createLLMGuardrail` returns a built-in `InputGuardrail` backed by the same gateway you already use, so it adds no extra install — a self-contained, higher-precision alternative to the heuristic regex detector.

```ts
function createLLMGuardrail(options: LLMGuardrailOptions): InputGuardrail

interface LLMGuardrailOptions {
  complete: LLMComplete       // typically `gateway.complete` you already use
  model?: string              // defaults to the gateway's configured model
  instructions?: string       // override the classification system prompt
  onError?: 'allow' | 'block' // 'allow' (default) fails open; 'block' fails closed
}
```

```ts
import { defineAgent, createLLMGuardrail } from '@elsium-ai/agents'

const injectionClassifier = createLLMGuardrail({
  complete: (req) => llm.complete(req),
  onError: 'allow', // do not block legitimate traffic if the classifier itself fails
})

const agent = defineAgent(
  {
    name: 'assistant',
    system: 'You are helpful.',
    guardrails: { security: { injectionClassifier } },
  },
  { complete: (req) => llm.complete(req) },
)
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

### Typed State Context

Transitions can return a `StateTransitionResult` object to pass typed context between states, rather than just returning a state name string:

```ts
interface StateTransitionResult {
  next: string
  context: Record<string, unknown>
}
```

This allows each state to forward structured data to the next state:

```ts
states: {
  intake: {
    system: 'Gather order details from the user.',
    transition: (result) => ({
      next: 'validate',
      context: { orderId: '12345', items: ['widget'] },
    }),
  },
  validate: {
    system: 'Validate the order details are complete.',
    transition: (result) => 'confirm', // plain string still works
  },
  confirm: {
    system: 'Confirm the order with the user.',
    terminal: true,
    transition: () => 'confirm',
  },
}

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

## ReAct Agent

### `defineReActAgent`

Create a ReAct (Reasoning + Acting) agent that follows an explicit Thought/Action/Observation loop. The agent reasons about what to do, selects a tool to call, observes the result, and repeats until it has enough information to produce a final answer.

```ts
function defineReActAgent(config: {
	name: string
	tools: Tool[]
	system?: string
	maxIterations?: number
	provider?: string | LLMProvider
	apiKey?: string
}): Agent
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `config.name` | `string` | -- | Agent name. |
| `config.tools` | `Tool[]` | -- | Tools available to the agent during the Action step. |
| `config.system` | `string` | Built-in ReAct prompt | Custom system prompt (merged with ReAct instructions). |
| `config.maxIterations` | `number` | `10` | Maximum Thought/Action/Observation cycles before stopping. |
| `config.provider` | `string \| LLMProvider` | -- | Provider name or instance. |
| `config.apiKey` | `string` | -- | API key (used when `provider` is a string). |

**Returns:** `Agent`

The ReAct loop follows this cycle on each iteration:

1. **Thought** -- the agent reasons about the current state and decides what to do next.
2. **Action** -- the agent selects and calls a tool with arguments.
3. **Observation** -- the tool result is fed back into the conversation.

The loop repeats until the agent produces a final answer or `maxIterations` is reached. The agent supports both text-based parsing (extracting Thought/Action/Observation from the LLM's text output) and native tool calling (when the provider returns structured tool calls).

```ts
import { defineReActAgent } from '@elsium-ai/agents'
import { createTool } from '@elsium-ai/tools'
import { z } from 'zod'

const searchTool = createTool({
	name: 'search',
	description: 'Search the web for information',
	input: z.object({ query: z.string() }),
	execute: async ({ input }) => {
		return `Results for: ${input.query}`
	},
})

const agent = defineReActAgent({
	name: 'researcher',
	tools: [searchTool],
	provider: 'anthropic',
	apiKey: process.env.ANTHROPIC_API_KEY!,
	maxIterations: 5,
})

const result = await agent.run('What is the population of Tokyo?')
console.log(result.message.content)
```

---

## Verification-Augmented Generation (VAG)

`runWithVerification` wraps any generation function in a `generate → validate → repair-or-abort` pipeline. Validators are composable, failures are aggregated, and the formatted repair prompt is re-injected into the next call so the model can fix what the validator complained about — not blindly regenerate.

### Built-in validators

| Validator | Use for |
|---|---|
| `zodValidator(schema)` | Structured output that must match a Zod shape. Surfaces JSON path + Zod issue in the repair hint. |
| `regexValidator(pattern, { mode: 'must-match' \| 'must-not-match' })` | Cheap surface checks (formats, forbidden tokens). |
| `semanticAdapter(semanticValidator, { input })` | LLM-as-judge: hallucination / relevance / grounding. Wraps the existing `SemanticValidator`. |
| `externalValidator(fn, { name, repairHint })` | API checks, database lookups, business rules — anything async. |

Compose multiple validators with `composeValidators([v1, v2], { mode: 'all' \| 'short-circuit' })`.

### Example — Zod schema with repair loop

```ts
import { z } from 'zod'
import { gateway, runWithVerification, zodValidator } from 'elsium-ai'

const InvoiceSchema = z.object({
  vendor: z.string(),
  total: z.number().positive(),
  lineItems: z.array(z.object({ description: z.string(), amount: z.number() })),
})

const llm = gateway({ provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY! })

const outcome = await runWithVerification(
  async (repair) => {
    const messages = [
      { role: 'user' as const, content: 'Extract invoice from: ...raw text...' },
      ...(repair ? [{ role: 'user' as const, content: repair.repairPrompt }] : []),
    ]
    const { object } = await llm.generateObject({ messages, schema: InvoiceSchema })
    return object
  },
  {
    validators: [zodValidator(InvoiceSchema)],
    maxRepairs: 3,
  },
)

if (outcome.status === 'aborted') {
  // Give up gracefully; outcome.lastValue holds the last attempt
} else {
  // outcome.value is fully validated, outcome.status is 'ok' or 'repaired'
}
```

### Example — semantic + business-rule combo

```ts
import {
  composeValidators,
  createSemanticValidator,
  externalValidator,
  runWithVerification,
  semanticAdapter,
} from 'elsium-ai'

const sv = createSemanticValidator({ checks: { hallucination: true } }, llm.complete)

const validators = composeValidators(
  [
    semanticAdapter(sv, { input: question, threshold: 0.7 }),
    externalValidator(
      async (text) => ({ valid: !text.includes('TODO'), reason: 'output left a TODO marker' }),
      { name: 'no-todo', repairHint: 'Replace any TODO placeholder with a concrete answer.' },
    ),
  ],
  { mode: 'all' },
)

const outcome = await runWithVerification(
  async (repair) => {
    const r = await agent.chat([
      { role: 'user', content: question },
      ...(repair ? [{ role: 'user', content: repair.repairPrompt }] : []),
    ])
    return r.message.content as string
  },
  { validators: [validators] },
)
```

### Outcome shape

```ts
type VerificationOutcome<T> =
  | { status: 'ok' | 'repaired'; value: T; attempts: number; history: VerificationAttempt<T>[] }
  | { status: 'aborted'; lastValue: T | undefined; attempts: number; history: VerificationAttempt<T>[]; reason: 'max-repairs-exceeded' | 'unrecoverable' }
```

The `history` array lets you inspect every attempt (value + validator outcomes + duration) for audit and offline analysis. Hook `onAttempt` to stream attempts as they happen, or `onAbort` to escalate to human review.

---

## Confidence-Augmented Generation (CAG)

VAG tells you the output is *wrong*. CAG tells you the output is *uncertain* — even when nothing failed validation. Three pluggable strategies, all returning a `CalibratedScore<T>` you can branch on, plus a threshold gate that aborts or escalates below the line you set.

### Strategies

```ts
import {
  selfConsistency,
  judgeEnsemble,
  logprobScore,
  requireConfidence,
} from 'elsium-ai'

// Self-consistency: sample N times, vote with majority (default) or a custom voter.
const sc = selfConsistency<{ answer: string }>({ samples: 5 })

// Judge ensemble: M judges score the same output; aggregate mean | median | min.
const je = judgeEnsemble<string>({
  judges: [factCheckJudge, toneJudge, brevityJudge],
  aggregator: 'min', // pessimistic — overall confidence = weakest judge
})

// Logprob: aggregate token-level logprobs (geometric-mean default).
// Works with providers that expose logprobs via message.metadata.logprobs.
const lp = logprobScore<string>({ aggregator: 'geometric-mean' })
```

Each strategy implements the same `ConfidenceStrategy<T>` contract:

```ts
interface ConfidenceStrategy<T> {
  name: string
  score(generate: () => Promise<{ value: T; raw?: LLMResponse }>): Promise<CalibratedScore<T>>
}

interface CalibratedScore<T> {
  value: T
  confidence: number      // 0..1, calibrated to the strategy's semantics
  strategy: string
  samples?: ConfidenceSample<T>[]
  details?: Record<string, unknown>
}
```

### Threshold gate — `requireConfidence`

```ts
import { requireConfidence, selfConsistency, ConfidenceTooLowError } from 'elsium-ai'

const result = await requireConfidence(
  async () => {
    const r = await agent.run(question)
    return { value: r.message.content as string }
  },
  {
    strategy: selfConsistency({ samples: 5 }),
    min: 0.8,
    below: 'escalate',  // 'abort' throws ConfidenceTooLowError; callback runs custom escalation
  },
)
// result.status ∈ 'ok' | 'escalated' | 'aborted'
// result.value is the chosen output, result.confidence is the strategy's score
```

Custom escalation — typically "call a stronger model" or "open a human-review ticket":

```ts
const result = await requireConfidence(
  () => weakModel.run(prompt),
  {
    strategy: selfConsistency({ samples: 3 }),
    min: 0.7,
    below: async ({ value, confidence }) => {
      const upgraded = await strongModel.run(prompt)
      return {
        value: upgraded.text,
        confidence: 0.95,
        strategy: 'human-or-upgraded-model',
        samples: [{ value: upgraded.text }],
      }
    },
  },
)
```

### Composing CAG with VAG

The N samples produced by `selfConsistency` are reusable as VAG validator inputs (one judge per sample, agreement count as a confidence judgment). The two layers stack cleanly: VAG enforces correctness, CAG measures certainty, and `requireConfidence` is the runtime decision point that routes low-confidence outputs to escalation — directly into the CARG router (next).

---

## `askHuman` — durable human-in-the-loop

`askHuman` consolidates the human-in-the-loop pattern into a single ergonomic call. Two modes:

1. **Responder mode** — the caller supplies a `responder` callback (Slack bot, web UI, anything async). Raced against a setTimeout-based timeout.
2. **Store mode** — the caller supplies an `AskHumanStore` and the function polls for a decision every 250 ms. The decision is set out-of-band via `resolveAskHuman(store, requestId, decision)`. When the store is durable (e.g., the same task store an `AsyncAgent` uses), the agent state survives a server restart.

```ts
import { askHuman, createInMemoryAskHumanStore, resolveAskHuman } from '@elsium-ai/agents'

// Mode 1 — responder
const decision = await askHuman({
  question: 'Approve $50,000 transfer?',
  options: ['approve', 'reject', 'modify'] as const,
  context: { trade, riskScore },
  timeoutMs: '24h',          // accepts '5s' | '2m' | '1h' | '7d' or a number in ms
  onTimeout: 'reject',
  responder: async (req) => slack.askApproval(req),
})

// Mode 2 — store-backed
const store = createInMemoryAskHumanStore()
const pending = askHuman({
  question: 'Approve $50,000 transfer?',
  options: ['approve', 'reject'],
  timeoutMs: '24h',
  store,
  requestId: 'review_001',
})

// Out-of-band (Slack webhook, web UI POST, ...):
await resolveAskHuman(store, 'review_001', {
  status: 'approved',
  option: 'approve',
  decidedBy: 'jane@org',
  approved: true,
  requestId: 'review_001',
})

const decision = await pending
// decision.status ∈ 'approved' | 'rejected' | 'timeout' | 'custom'
```

The `AskHumanStore` port (`save / get / listPending / delete`) lets you swap the in-memory adapter for any durable backend. `listPending()` is the surface a notifier / digest reads ("show me all open approvals for the team").

---

## Part of ElsiumAI

This package is the agent layer of the [ElsiumAI](https://github.com/elsium-ai/elsium-ai) framework. See the [full documentation](https://github.com/elsium-ai/elsium-ai) for guides and examples.

## License

[MIT](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE)
