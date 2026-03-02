# @elsium-ai/testing

Testing utilities, mock providers, fixtures, and eval framework for [ElsiumAI](https://github.com/elsium-ai/elsium-ai).

[![npm](https://img.shields.io/npm/v/@elsium-ai/testing.svg)](https://www.npmjs.com/package/@elsium-ai/testing)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE)

## Install

```bash
npm install @elsium-ai/testing --save-dev
```

## What's Inside

| Category | Exports | Description |
|---|---|---|
| **Mock Provider** | `mockProvider`, `MockProvider`, `MockProviderOptions`, `MockResponseConfig` | Zero-latency LLM provider for unit tests |
| **Fixtures** | `createFixture`, `loadFixture`, `createRecorder`, `Fixture`, `FixtureEntry`, `FixtureRecorder` | Record, save, and replay request/response pairs |
| **Eval** | `runEvalSuite`, `formatEvalReport`, `EvalCase`, `EvalCriterion`, `EvalResult`, `CriterionResult`, `EvalSuiteConfig`, `EvalSuiteResult`, `LLMJudge` | Evaluation framework with built-in and custom criteria |
| **Snapshot** | `createSnapshotStore`, `hashOutput`, `testSnapshot`, `PromptSnapshot`, `SnapshotStore`, `SnapshotTestResult` | Hash-based snapshot testing for LLM outputs |
| **Prompts** | `createPromptRegistry`, `definePrompt`, `PromptDefinition`, `PromptDiff`, `DiffLine`, `PromptRegistry` | Versioned prompt registry with diff and rendering |
| **Regression** | `createRegressionSuite`, `RegressionBaseline`, `RegressionResult`, `RegressionDetail`, `RegressionSuite` | Baseline-driven regression detection |
| **Replay** | `createReplayRecorder`, `createReplayPlayer`, `ReplayEntry`, `ReplayRecorder`, `ReplayPlayer` | Record and replay raw LLM completion calls |
| **Pinning** | `createPinStore`, `pinOutput`, `Pin`, `PinStore`, `PinResult` | Pin expected outputs and detect drift |
| **Determinism** | `assertDeterministic`, `assertStable`, `DeterminismResult`, `StabilityResult` | Verify output consistency across repeated runs |

---

## Mock Provider

Create a mock `LLMProvider` that returns pre-configured responses without making real API calls.

### `MockResponseConfig`

```ts
interface MockResponseConfig {
  content?: string
  toolCalls?: Array<{
    id?: string
    name: string
    arguments: Record<string, unknown>
  }>
  stopReason?: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence'
  usage?: Partial<TokenUsage>
  model?: string
  delay?: number
}
```

### `MockProviderOptions`

```ts
interface MockProviderOptions {
  responses?: MockResponseConfig[]
  defaultResponse?: MockResponseConfig
  onRequest?: (request: CompletionRequest) => void
}
```

| Field | Description |
|---|---|
| `responses` | Ordered list of responses returned sequentially per call |
| `defaultResponse` | Fallback response used when `responses` is exhausted |
| `onRequest` | Callback invoked on every request (useful for assertions) |

### `MockProvider`

```ts
interface MockProvider extends LLMProvider {
  readonly calls: CompletionRequest[]
  readonly callCount: number
  reset(): void
}
```

Extends the standard `LLMProvider` interface with inspection helpers. `calls` stores every `CompletionRequest` received, `callCount` returns the total, and `reset()` clears both the call log and the response index.

### `mockProvider()`

Creates a mock provider instance.

```ts
function mockProvider(options?: MockProviderOptions): MockProvider
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `options` | `MockProviderOptions` | `{}` | Configuration for responses and callbacks |

**Returns:** `MockProvider`

```ts
import { mockProvider } from '@elsium-ai/testing'

const mock = mockProvider({
  responses: [
    { content: 'Hello!' },
    { content: 'Goodbye!', stopReason: 'end_turn' },
  ],
  defaultResponse: { content: 'Default reply' },
  onRequest: (req) => console.log('Model:', req.model),
})

const first = await mock.complete({ messages: [{ role: 'user', content: 'Hi' }] })
// first.message.content === 'Hello!'

console.log(mock.callCount) // 1
mock.reset()
console.log(mock.callCount) // 0
```

---

## Fixtures

Capture request/response pairs as reusable fixtures that can be serialized to JSON and replayed as mock providers.

### `FixtureEntry`

```ts
interface FixtureEntry {
  request: {
    messages: Array<{ role: string; content: string }>
    model?: string
    system?: string
  }
  response: MockResponseConfig
  timestamp?: string
}
```

### `Fixture`

```ts
interface Fixture {
  readonly name: string
  readonly entries: FixtureEntry[]
  toProvider(options?: { matching?: 'sequential' | 'request-hash' }): MockProvider
  toJSON(): string
}
```

| Method | Description |
|---|---|
| `toProvider()` | Converts the fixture into a `MockProvider`. Pass `{ matching: 'request-hash' }` to match responses by message content hash instead of sequential order. |
| `toJSON()` | Serializes the fixture (with timestamps) to a JSON string. |

### `createFixture()`

Creates a fixture from a name and an array of entries.

```ts
function createFixture(name: string, entries: FixtureEntry[]): Fixture
```

| Parameter | Type | Description |
|---|---|---|
| `name` | `string` | Human-readable fixture name |
| `entries` | `FixtureEntry[]` | Array of request/response pairs |

**Returns:** `Fixture`

```ts
import { createFixture } from '@elsium-ai/testing'

const fixture = createFixture('greeting-flow', [
  {
    request: { messages: [{ role: 'user', content: 'Hello' }] },
    response: { content: 'Hi there!' },
  },
])

const provider = fixture.toProvider()
const res = await provider.complete({
  messages: [{ role: 'user', content: 'Hello' }],
})
// res.message.content === 'Hi there!'
```

### `loadFixture()`

Deserializes a JSON string back into a `Fixture`.

```ts
function loadFixture(json: string): Fixture
```

| Parameter | Type | Description |
|---|---|---|
| `json` | `string` | JSON string previously produced by `fixture.toJSON()` |

**Returns:** `Fixture`

```ts
import { createFixture, loadFixture } from '@elsium-ai/testing'

const original = createFixture('test', [
  {
    request: { messages: [{ role: 'user', content: 'ping' }] },
    response: { content: 'pong' },
  },
])

const json = original.toJSON()
const restored = loadFixture(json)
// restored.name === 'test'
```

### `FixtureRecorder`

```ts
interface FixtureRecorder {
  wrap(provider: MockProvider): MockProvider
  getEntries(): FixtureEntry[]
  toFixture(name: string): Fixture
  clear(): void
}
```

### `createRecorder()`

Creates a recorder that intercepts `complete()` calls and captures request/response pairs.

```ts
function createRecorder(): FixtureRecorder
```

**Returns:** `FixtureRecorder`

```ts
import { mockProvider, createRecorder } from '@elsium-ai/testing'

const recorder = createRecorder()
const mock = mockProvider({ responses: [{ content: 'recorded response' }] })
const wrapped = recorder.wrap(mock)

await wrapped.complete({
  messages: [{ role: 'user', content: 'capture this' }],
})

const fixture = recorder.toFixture('my-fixture')
console.log(fixture.entries.length) // 1
```

---

## Eval

A structured evaluation framework for assessing LLM outputs against configurable criteria.

### `EvalCase`

```ts
interface EvalCase {
  name: string
  input: string
  expected?: string
  criteria?: EvalCriterion[]
  tags?: string[]
}
```

### `EvalCriterion`

A discriminated union of all supported criterion types:

```ts
type EvalCriterion =
  | { type: 'contains'; value: string; caseSensitive?: boolean }
  | { type: 'not_contains'; value: string; caseSensitive?: boolean }
  | { type: 'matches'; pattern: string; flags?: string }
  | { type: 'length_min'; value: number }
  | { type: 'length_max'; value: number }
  | { type: 'json_valid' }
  | { type: 'json_matches'; schema: Record<string, unknown> }
  | { type: 'custom'; name: string; fn: (output: string) => boolean }
  | { type: 'llm_judge'; prompt: string; judge: LLMJudge; threshold?: number }
  | { type: 'semantic_similarity'; reference: string; threshold?: number }
  | { type: 'factual_accuracy'; facts: string[]; threshold?: number }
```

| Criterion | Description |
|---|---|
| `contains` | Output must contain `value` (case-insensitive by default) |
| `not_contains` | Output must not contain `value` |
| `matches` | Output must match the regex `pattern` |
| `length_min` | Output length must be at least `value` characters |
| `length_max` | Output length must be at most `value` characters |
| `json_valid` | Output must be valid JSON |
| `json_matches` | Output must be valid JSON matching `schema` (key presence + type check) |
| `custom` | Output is passed to `fn`; must return `true` to pass |
| `llm_judge` | An LLM judge scores the output; must meet `threshold` (default 0.7) |
| `semantic_similarity` | Word-overlap similarity against `reference`; must meet `threshold` (default 0.7) |
| `factual_accuracy` | Checks how many `facts` appear in the output; must meet `threshold` (default 0.7) |

### `LLMJudge`

```ts
type LLMJudge = (prompt: string) => Promise<{ score: number; reasoning: string }>
```

### `EvalResult`

```ts
interface EvalResult {
  name: string
  passed: boolean
  score: number
  criteria: CriterionResult[]
  input: string
  output: string
  durationMs: number
  tags: string[]
}
```

### `CriterionResult`

```ts
interface CriterionResult {
  type: string
  passed: boolean
  message: string
}
```

### `EvalSuiteConfig`

```ts
interface EvalSuiteConfig {
  name: string
  cases: EvalCase[]
  runner: (input: string) => Promise<string>
  concurrency?: number
}
```

| Field | Description |
|---|---|
| `name` | Suite name for reporting |
| `cases` | Array of eval cases to run |
| `runner` | Function that takes an input string and returns the LLM output |
| `concurrency` | Max parallel eval cases (default `1` for sequential execution) |

### `EvalSuiteResult`

```ts
interface EvalSuiteResult {
  name: string
  total: number
  passed: number
  failed: number
  score: number
  results: EvalResult[]
  durationMs: number
}
```

### `runEvalSuite()`

Runs all eval cases through the runner and evaluates each against its criteria.

```ts
function runEvalSuite(config: EvalSuiteConfig): Promise<EvalSuiteResult>
```

| Parameter | Type | Description |
|---|---|---|
| `config` | `EvalSuiteConfig` | Suite configuration including cases and runner |

**Returns:** `Promise<EvalSuiteResult>`

```ts
import { runEvalSuite, formatEvalReport } from '@elsium-ai/testing'

const result = await runEvalSuite({
  name: 'Sentiment classifier',
  cases: [
    {
      name: 'positive review',
      input: 'This product is amazing!',
      criteria: [
        { type: 'contains', value: 'positive' },
        { type: 'length_max', value: 50 },
      ],
    },
    {
      name: 'negative review',
      input: 'Terrible experience.',
      expected: 'negative',
    },
  ],
  runner: async (input) => {
    // Call your LLM or classifier here
    return input.includes('amazing') ? 'positive' : 'negative'
  },
  concurrency: 2,
})

console.log(result.score)  // 0..1
console.log(result.passed) // number of passing cases
```

### `formatEvalReport()`

Formats an `EvalSuiteResult` into a human-readable string report.

```ts
function formatEvalReport(result: EvalSuiteResult): string
```

| Parameter | Type | Description |
|---|---|---|
| `result` | `EvalSuiteResult` | The result object returned by `runEvalSuite` |

**Returns:** `string`

```ts
import { runEvalSuite, formatEvalReport } from '@elsium-ai/testing'

const result = await runEvalSuite({ /* ... */ })
console.log(formatEvalReport(result))
// Output:
//   Eval Suite: Sentiment classifier
//   --------------------------------------------------
//   [PASS] positive review (3ms)
//   [PASS] negative review (1ms)
//   --------------------------------------------------
//   Score: 100.0% | 2/2 passed | 4ms
```

---

## Snapshot

Hash-based snapshot testing that detects when LLM outputs change between runs.

### `PromptSnapshot`

```ts
interface PromptSnapshot {
  name: string
  request: {
    system?: string
    messages: Array<{ role: string; content: string }>
    model?: string
  }
  outputHash: string
  timestamp: string
}
```

### `SnapshotStore`

```ts
interface SnapshotStore {
  get(name: string): PromptSnapshot | undefined
  set(name: string, snapshot: PromptSnapshot): void
  getAll(): PromptSnapshot[]
  toJSON(): string
}
```

### `createSnapshotStore()`

Creates an in-memory snapshot store, optionally seeded with existing snapshots.

```ts
function createSnapshotStore(existing?: PromptSnapshot[]): SnapshotStore
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `existing` | `PromptSnapshot[]` | `undefined` | Previously saved snapshots to preload |

**Returns:** `SnapshotStore`

```ts
import { createSnapshotStore } from '@elsium-ai/testing'

const store = createSnapshotStore()
console.log(store.getAll().length) // 0
```

### `hashOutput()`

Produces a SHA-256 hex digest of the given string.

```ts
function hashOutput(output: string): string
```

| Parameter | Type | Description |
|---|---|---|
| `output` | `string` | The output string to hash |

**Returns:** `string` -- SHA-256 hex hash

```ts
import { hashOutput } from '@elsium-ai/testing'

const hash = hashOutput('Hello, world!')
// 'dffd6021bb2bd5b0af676290809ec3a53191dd81c7f70a4b28688a362182986f'
```

### `SnapshotTestResult`

```ts
interface SnapshotTestResult {
  name: string
  status: 'new' | 'match' | 'changed'
  previousHash?: string
  currentHash: string
  output: string
}
```

### `testSnapshot()`

Runs the provided function, hashes its output, and compares the hash against the stored snapshot.

```ts
function testSnapshot(
  name: string,
  store: SnapshotStore,
  runner: () => Promise<string>,
  request?: Partial<CompletionRequest>,
): Promise<SnapshotTestResult>
```

| Parameter | Type | Description |
|---|---|---|
| `name` | `string` | Unique snapshot name |
| `store` | `SnapshotStore` | The store to read/write snapshots |
| `runner` | `() => Promise<string>` | Function that produces the output to snapshot |
| `request` | `Partial<CompletionRequest>` | Optional request metadata stored in the snapshot |

**Returns:** `Promise<SnapshotTestResult>` -- status is `'new'` on first run, `'match'` if the hash is unchanged, or `'changed'` if it differs.

```ts
import { createSnapshotStore, testSnapshot } from '@elsium-ai/testing'

const store = createSnapshotStore()

const result = await testSnapshot('greeting', store, async () => {
  return 'Hello, world!'
})

console.log(result.status) // 'new' on first run

const result2 = await testSnapshot('greeting', store, async () => {
  return 'Hello, world!'
})

console.log(result2.status) // 'match'
```

---

## Prompts

A versioned prompt registry for managing, rendering, and diffing prompt templates.

### `PromptDefinition`

```ts
interface PromptDefinition {
  name: string
  version: string
  content: string
  variables: string[]
  metadata?: Record<string, unknown>
}
```

### `PromptDiff`

```ts
interface PromptDiff {
  name: string
  fromVersion: string
  toVersion: string
  changes: DiffLine[]
}
```

### `DiffLine`

```ts
interface DiffLine {
  type: 'added' | 'removed' | 'unchanged'
  lineNumber: number
  content: string
}
```

### `PromptRegistry`

```ts
interface PromptRegistry {
  register(name: string, prompt: PromptDefinition): void
  get(name: string, version?: string): PromptDefinition | undefined
  getLatest(name: string): PromptDefinition | undefined
  list(): Array<{ name: string; versions: string[] }>
  diff(name: string, fromVersion: string, toVersion: string): PromptDiff | null
  render(name: string, variables: Record<string, string>, version?: string): string
  getVersions(name: string): string[]
}
```

| Method | Description |
|---|---|
| `register` | Stores a prompt under its name and version |
| `get` | Retrieves a specific version, or the latest if `version` is omitted |
| `getLatest` | Returns the highest semver version for a prompt |
| `list` | Lists all prompt names with their available versions |
| `diff` | Computes a line-by-line diff between two versions |
| `render` | Replaces `{{variable}}` placeholders in the prompt content |
| `getVersions` | Returns all versions for a prompt sorted by semver |

### `definePrompt()`

A convenience function that returns a shallow copy of the given prompt definition.

```ts
function definePrompt(config: PromptDefinition): PromptDefinition
```

| Parameter | Type | Description |
|---|---|---|
| `config` | `PromptDefinition` | The prompt definition to register |

**Returns:** `PromptDefinition`

```ts
import { definePrompt } from '@elsium-ai/testing'

const prompt = definePrompt({
  name: 'classifier',
  version: '1.0.0',
  content: 'Classify the following text as {{label}}: {{text}}',
  variables: ['label', 'text'],
})
```

### `createPromptRegistry()`

Creates an empty prompt registry.

```ts
function createPromptRegistry(): PromptRegistry
```

**Returns:** `PromptRegistry`

```ts
import { definePrompt, createPromptRegistry } from '@elsium-ai/testing'

const registry = createPromptRegistry()

const v1 = definePrompt({
  name: 'summarizer',
  version: '1.0.0',
  content: 'Summarize: {{text}}',
  variables: ['text'],
})

const v2 = definePrompt({
  name: 'summarizer',
  version: '2.0.0',
  content: 'Provide a concise summary of: {{text}}',
  variables: ['text'],
})

registry.register('summarizer', v1)
registry.register('summarizer', v2)

// Render with the latest version
const output = registry.render('summarizer', { text: 'A long article...' })
// 'Provide a concise summary of: A long article...'

// Diff between versions
const diff = registry.diff('summarizer', '1.0.0', '2.0.0')
// diff.changes includes added/removed/unchanged lines
```

---

## Regression

Baseline-driven regression detection that compares current LLM outputs to previously recorded baselines.

### `RegressionBaseline`

```ts
interface RegressionBaseline {
  name: string
  cases: Array<{
    input: string
    output: string
    score: number
    timestamp: number
  }>
  createdAt: number
  updatedAt: number
}
```

### `RegressionResult`

```ts
interface RegressionResult {
  name: string
  totalCases: number
  regressions: RegressionDetail[]
  improvements: RegressionDetail[]
  unchanged: number
  overallScore: number
  baselineScore: number
}
```

### `RegressionDetail`

```ts
interface RegressionDetail {
  input: string
  baselineOutput: string
  currentOutput: string
  baselineScore: number
  currentScore: number
  delta: number
}
```

### `RegressionSuite`

```ts
interface RegressionSuite {
  load(path: string): Promise<void>
  save(path: string): Promise<void>
  run(
    runner: (input: string) => Promise<string>,
    scorer?: (input: string, output: string) => Promise<number>,
  ): Promise<RegressionResult>
  addCase(input: string, output: string, score: number): void
  readonly baseline: RegressionBaseline | null
}
```

| Method | Description |
|---|---|
| `load` | Reads a baseline JSON file from disk |
| `save` | Writes the current baseline to disk (creates directories as needed) |
| `run` | Runs all baseline cases through `runner`, compares scores, and classifies regressions (delta < -0.1), improvements (delta > 0.1), or unchanged |
| `addCase` | Adds or updates a case in the baseline |
| `baseline` | Read-only access to the current baseline (or `null`) |

### `createRegressionSuite()`

Creates a new regression suite with the given name.

```ts
function createRegressionSuite(name: string): RegressionSuite
```

| Parameter | Type | Description |
|---|---|---|
| `name` | `string` | Name for the regression suite |

**Returns:** `RegressionSuite`

```ts
import { createRegressionSuite } from '@elsium-ai/testing'

const suite = createRegressionSuite('qa-bot')

// Build baseline
suite.addCase('What is 2+2?', '4', 1.0)
suite.addCase('Capital of France?', 'Paris', 1.0)
await suite.save('./baselines/qa-bot.json')

// Later, run against the baseline
await suite.load('./baselines/qa-bot.json')
const result = await suite.run(async (input) => {
  // Call your LLM here
  return 'some answer'
})

console.log(result.regressions.length) // number of regressions detected
console.log(result.overallScore)        // aggregate score across all cases
```

---

## Replay

Record raw `CompletionRequest` / `LLMResponse` pairs and replay them deterministically in tests.

### `ReplayEntry`

```ts
interface ReplayEntry {
  request: CompletionRequest
  response: LLMResponse
  timestamp: number
}
```

### `ReplayRecorder`

```ts
interface ReplayRecorder {
  wrap(
    completeFn: (req: CompletionRequest) => Promise<LLMResponse>,
  ): (req: CompletionRequest) => Promise<LLMResponse>
  getEntries(): ReplayEntry[]
  toJSON(): string
  clear(): void
}
```

### `createReplayRecorder()`

Creates a recorder that wraps a completion function and captures every request/response pair.

```ts
function createReplayRecorder(): ReplayRecorder
```

**Returns:** `ReplayRecorder`

```ts
import { createReplayRecorder } from '@elsium-ai/testing'

const recorder = createReplayRecorder()
const wrappedComplete = recorder.wrap(provider.complete.bind(provider))

// Use wrappedComplete in place of provider.complete — all calls are recorded
const response = await wrappedComplete({
  messages: [{ role: 'user', content: 'Hello' }],
})

// Save for later replay
const json = recorder.toJSON()
```

### `ReplayPlayer`

```ts
interface ReplayPlayer {
  complete(request: CompletionRequest): Promise<LLMResponse>
  readonly remaining: number
}
```

### `createReplayPlayer()`

Creates a player that replays recorded responses sequentially, regardless of the incoming request.

```ts
function createReplayPlayer(entriesOrJson: ReplayEntry[] | string): ReplayPlayer
```

| Parameter | Type | Description |
|---|---|---|
| `entriesOrJson` | `ReplayEntry[] \| string` | An array of replay entries, or a JSON string produced by `recorder.toJSON()` |

**Returns:** `ReplayPlayer`

Throws an error with the message `'Replay exhausted: no more recorded responses'` if `complete()` is called after all entries have been consumed.

```ts
import { createReplayRecorder, createReplayPlayer } from '@elsium-ai/testing'

// Record
const recorder = createReplayRecorder()
const wrapped = recorder.wrap(provider.complete.bind(provider))
await wrapped({ messages: [{ role: 'user', content: 'Hi' }] })

// Replay
const player = createReplayPlayer(recorder.getEntries())
console.log(player.remaining) // 1

const replayed = await player.complete({
  messages: [{ role: 'user', content: 'Hi' }],
})
console.log(player.remaining) // 0
```

---

## Pinning

Pin LLM outputs to specific prompt + config combinations and detect when outputs drift.

### `Pin`

```ts
interface Pin {
  promptHash: string
  configHash: string
  outputHash: string
  outputText: string
  model?: string
  createdAt: number
}
```

### `PinStore`

```ts
interface PinStore {
  get(key: string): Pin | undefined
  set(key: string, pin: Pin): void
  delete(key: string): boolean
  getAll(): Pin[]
  toJSON(): string
}
```

### `PinResult`

```ts
interface PinResult {
  status: 'new' | 'match' | 'mismatch'
  pin: Pin
  previousPin?: Pin
}
```

### `createPinStore()`

Creates an in-memory pin store, optionally preloaded with existing pins.

```ts
function createPinStore(existing?: Pin[]): PinStore
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `existing` | `Pin[]` | `undefined` | Previously saved pins to preload |

**Returns:** `PinStore`

```ts
import { createPinStore } from '@elsium-ai/testing'

const store = createPinStore()
console.log(store.getAll().length) // 0
```

### `pinOutput()`

Runs a function, hashes its output along with the prompt and config, and compares against any previously stored pin.

```ts
function pinOutput(
  name: string,
  store: PinStore,
  runner: () => Promise<string>,
  config: {
    prompt: string
    model?: string
    temperature?: number
    seed?: number
  },
  options?: { assert?: boolean },
): Promise<PinResult>
```

| Parameter | Type | Description |
|---|---|---|
| `name` | `string` | Human-readable name for the pin (used in error messages) |
| `store` | `PinStore` | The store to read/write pins |
| `runner` | `() => Promise<string>` | Function that produces the output to pin |
| `config` | `object` | Prompt text and model config used to generate the hash key |
| `options.assert` | `boolean` | When `true`, throws an `ElsiumError` on mismatch instead of returning |

**Returns:** `Promise<PinResult>` -- status is `'new'` on first run, `'match'` if output is identical, or `'mismatch'` if the output has changed.

```ts
import { createPinStore, pinOutput } from '@elsium-ai/testing'

const store = createPinStore()

const result = await pinOutput(
  'greeting-pin',
  store,
  async () => 'Hello, world!',
  { prompt: 'Say hello', model: 'gpt-4', temperature: 0 },
)

console.log(result.status) // 'new'

// Run again with the same output
const result2 = await pinOutput(
  'greeting-pin',
  store,
  async () => 'Hello, world!',
  { prompt: 'Say hello', model: 'gpt-4', temperature: 0 },
)

console.log(result2.status) // 'match'

// Run with assert mode in CI
await pinOutput(
  'greeting-pin',
  store,
  async () => 'Different output!',
  { prompt: 'Say hello', model: 'gpt-4', temperature: 0 },
  { assert: true }, // throws ElsiumError on mismatch
)
```

---

## Determinism

Verify that an LLM function produces consistent outputs across multiple invocations.

### `DeterminismResult`

```ts
interface DeterminismResult {
  deterministic: boolean
  runs: number
  uniqueOutputs: number
  outputs: string[]
  variance: number
}
```

### `StabilityResult`

```ts
interface StabilityResult {
  stable: boolean
  runs: number
  uniqueOutputs: number
  outputs: Array<{ output: string; timestamp: number }>
  variance: number
}
```

### `assertDeterministic()`

Runs a function multiple times and verifies that all outputs are identical (or within the specified tolerance).

```ts
function assertDeterministic(
  fn: (seed?: number) => Promise<string>,
  options?: {
    runs?: number
    seed?: number
    tolerance?: number
  },
): Promise<DeterminismResult>
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `fn` | `(seed?: number) => Promise<string>` | -- | The function to test for determinism |
| `options.runs` | `number` | `5` | Number of times to invoke `fn` |
| `options.seed` | `number` | `undefined` | Seed passed to `fn` on each invocation |
| `options.tolerance` | `number` | `0` | Maximum allowed variance (0 = strictly deterministic) |

**Returns:** `Promise<DeterminismResult>`

Throws an `ElsiumError` when `tolerance` is `0` (the default) and outputs are not identical.

```ts
import { assertDeterministic } from '@elsium-ai/testing'

const result = await assertDeterministic(
  async (seed) => {
    // Call your LLM with temperature: 0 and the provided seed
    return 'consistent output'
  },
  { runs: 5, seed: 42, tolerance: 0 },
)

console.log(result.deterministic) // true
console.log(result.uniqueOutputs) // 1
console.log(result.variance)      // 0
```

### `assertStable()`

Runs a function multiple times with a delay between invocations to verify temporal stability.

```ts
function assertStable(
  fn: (seed?: number) => Promise<string>,
  options?: {
    intervalMs?: number
    runs?: number
    seed?: number
  },
): Promise<StabilityResult>
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `fn` | `(seed?: number) => Promise<string>` | -- | The function to test for stability |
| `options.intervalMs` | `number` | `100` | Delay in milliseconds between runs |
| `options.runs` | `number` | `3` | Number of times to invoke `fn` |
| `options.seed` | `number` | `undefined` | Seed passed to `fn` on each invocation |

**Returns:** `Promise<StabilityResult>`

```ts
import { assertStable } from '@elsium-ai/testing'

const result = await assertStable(
  async (seed) => {
    return 'same output every time'
  },
  { intervalMs: 200, runs: 3, seed: 42 },
)

console.log(result.stable)        // true
console.log(result.uniqueOutputs) // 1
console.log(result.outputs)       // [{ output: '...', timestamp: ... }, ...]
```

---

## Part of ElsiumAI

This package is the testing layer of the [ElsiumAI](https://github.com/elsium-ai/elsium-ai) framework. See the [full documentation](https://github.com/elsium-ai/elsium-ai) for guides and examples.

## License

[MIT](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE)
