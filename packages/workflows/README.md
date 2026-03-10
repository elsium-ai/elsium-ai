# @elsium-ai/workflows

Multi-step workflow pipelines and DAG execution for [ElsiumAI](https://github.com/elsium-ai/elsium-ai).

[![npm](https://img.shields.io/npm/v/@elsium-ai/workflows.svg)](https://www.npmjs.com/package/@elsium-ai/workflows)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE)

## Install

```bash
npm install @elsium-ai/workflows @elsium-ai/core
```

## What's Inside

| Category | Export | Kind |
| --- | --- | --- |
| **Types** | `StepConfig` | interface |
| | `StepContext` | interface |
| | `StepResult` | interface |
| | `StepStatus` | type alias |
| | `RetryConfig` | interface |
| | `WorkflowConfig` | interface |
| | `WorkflowResult` | interface |
| | `WorkflowStatus` | type alias |
| | `WorkflowRunOptions` | interface |
| **Steps** | `step` | function |
| | `executeStep` | function |
| **Workflow** | `defineWorkflow` | function |
| | `defineParallelWorkflow` | function |
| | `defineBranchWorkflow` | function |
| | `Workflow` | interface |
| | `ParallelWorkflowConfig` | interface |
| | `BranchConfig` | interface |

---

## Types

### `StepStatus`

Union type representing the possible states of a step during execution.

```ts
type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
```

### `StepConfig<TInput, TOutput>`

Configuration object that defines a single step's behavior, including its handler, optional input validation, retry policy, conditional execution, fallback logic, and timeout.

```ts
interface StepConfig<TInput = unknown, TOutput = unknown> {
  name: string
  input?: z.ZodType<TInput>
  handler: (input: TInput, context: StepContext) => Promise<TOutput>
  retry?: RetryConfig
  condition?: (input: TInput, context: StepContext) => boolean
  fallback?: (error: Error, input: TInput) => Promise<TOutput>
  timeoutMs?: number
}
```

| Field | Type | Description |
| --- | --- | --- |
| `name` | `string` | Unique identifier for the step within a workflow. |
| `input` | `z.ZodType<TInput>` | Optional Zod schema used to validate the step's input before the handler runs. |
| `handler` | `(input: TInput, context: StepContext) => Promise<TOutput>` | Async function that performs the step's work. |
| `retry` | `RetryConfig` | Optional retry policy applied when the handler throws. |
| `condition` | `(input: TInput, context: StepContext) => boolean` | Optional guard; when it returns `false` the step is skipped. |
| `fallback` | `(error: Error, input: TInput) => Promise<TOutput>` | Optional async function invoked when all retries are exhausted. |
| `timeoutMs` | `number` | Optional per-step timeout in milliseconds. |

### `StepContext`

Runtime context passed to every step handler and condition function.

```ts
interface StepContext {
  workflowName: string
  stepIndex: number
  previousOutputs: Record<string, unknown>
  signal?: AbortSignal
}
```

| Field | Type | Description |
| --- | --- | --- |
| `workflowName` | `string` | Name of the workflow that owns this step. |
| `stepIndex` | `number` | Zero-based position of the step within the workflow. |
| `previousOutputs` | `Record<string, unknown>` | Map of step name to output for all previously completed steps. |
| `signal` | `AbortSignal` | Optional abort signal forwarded from `WorkflowRunOptions`. |

### `StepResult<T>`

Outcome returned after a step finishes (or is skipped/fails).

```ts
interface StepResult<T = unknown> {
  name: string
  status: StepStatus
  data?: T
  error?: string
  durationMs: number
  retryCount: number
}
```

| Field | Type | Description |
| --- | --- | --- |
| `name` | `string` | Name of the step that produced this result. |
| `status` | `StepStatus` | Final status of the step. |
| `data` | `T` | Output data, present when `status` is `'completed'`. |
| `error` | `string` | Error message, present when `status` is `'failed'`. |
| `durationMs` | `number` | Wall-clock time spent on the step in milliseconds. |
| `retryCount` | `number` | Number of retries that were attempted before the final outcome. |

### `RetryConfig`

Per-step retry policy with exponential backoff and jitter.

```ts
interface RetryConfig {
  maxRetries: number
  baseDelayMs?: number
  maxDelayMs?: number
  shouldRetry?: (error: Error) => boolean
}
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `maxRetries` | `number` | -- | Maximum number of retry attempts. |
| `baseDelayMs` | `number` | `1000` | Base delay for exponential backoff in milliseconds. |
| `maxDelayMs` | `number` | `30000` | Upper bound for the computed delay in milliseconds. |
| `shouldRetry` | `(error: Error) => boolean` | -- | Optional predicate; when omitted, all errors except non-retryable `ElsiumError` instances are retried. |

Backoff formula: `min(baseDelayMs * 2^(attempt-1), maxDelayMs) * random(0.5, 1.0)`.

### `WorkflowStatus`

Union type representing the possible states of a workflow.

```ts
type WorkflowStatus = 'pending' | 'running' | 'completed' | 'failed'
```

### `WorkflowConfig`

Configuration for a sequential workflow created via `defineWorkflow`.

```ts
interface WorkflowConfig {
  name: string
  steps: StepConfig[]
  onStepComplete?: (result: StepResult) => void | Promise<void>
  onStepError?: (error: Error, stepName: string) => void | Promise<void>
  onComplete?: (result: WorkflowResult) => void | Promise<void>
}
```

| Field | Type | Description |
| --- | --- | --- |
| `name` | `string` | Identifier for the workflow. |
| `steps` | `StepConfig[]` | Ordered list of steps to execute sequentially. |
| `onStepComplete` | `(result: StepResult) => void \| Promise<void>` | Optional callback fired after each step completes. |
| `onStepError` | `(error: Error, stepName: string) => void \| Promise<void>` | Optional callback fired when a step fails. |
| `onComplete` | `(result: WorkflowResult) => void \| Promise<void>` | Optional callback fired when the workflow finishes (success or failure). |

### `WorkflowResult`

Final output returned by `workflow.run()`.

```ts
interface WorkflowResult {
  name: string
  status: WorkflowStatus
  steps: StepResult[]
  totalDurationMs: number
  outputs: Record<string, unknown>
}
```

| Field | Type | Description |
| --- | --- | --- |
| `name` | `string` | Name of the workflow. |
| `status` | `WorkflowStatus` | Overall status of the workflow. |
| `steps` | `StepResult[]` | Results for each step in execution order. |
| `totalDurationMs` | `number` | Total wall-clock time for the entire workflow in milliseconds. |
| `outputs` | `Record<string, unknown>` | Map of step name to output for every completed step. |

### `WorkflowRunOptions`

Options passed to `workflow.run()`.

```ts
interface WorkflowRunOptions {
  signal?: AbortSignal
}
```

| Field | Type | Description |
| --- | --- | --- |
| `signal` | `AbortSignal` | Optional abort signal; forwarded to each step's `StepContext`. |

---

## Steps

### `step`

Factory function that creates a `StepConfig` by combining a name with the rest of the configuration, providing a concise shorthand for inline step definitions.

```ts
function step<TInput, TOutput>(
  name: string,
  config: Omit<StepConfig<TInput, TOutput>, 'name'>,
): StepConfig<TInput, TOutput>
```

| Parameter | Type | Description |
| --- | --- | --- |
| `name` | `string` | Unique name for the step. |
| `config` | `Omit<StepConfig<TInput, TOutput>, 'name'>` | Step configuration without the `name` field. |

**Returns:** `StepConfig<TInput, TOutput>`

```ts
import { step } from '@elsium-ai/workflows'
import { z } from 'zod'

const fetchPage = step('fetch-page', {
  input: z.object({ url: z.string().url() }),
  handler: async (input) => {
    const res = await fetch(input.url)
    return res.text()
  },
  retry: { maxRetries: 3, baseDelayMs: 500 },
  timeoutMs: 10_000,
})
```

### `executeStep`

Runs a single step to completion, handling input validation, condition checks, retries with exponential backoff, timeout enforcement, and fallback execution.

```ts
function executeStep<TInput, TOutput>(
  stepConfig: StepConfig<TInput, TOutput>,
  rawInput: unknown,
  context: StepContext,
): Promise<StepResult<TOutput>>
```

| Parameter | Type | Description |
| --- | --- | --- |
| `stepConfig` | `StepConfig<TInput, TOutput>` | The step definition to execute. |
| `rawInput` | `unknown` | Raw input value; validated against `stepConfig.input` if a schema is provided. |
| `context` | `StepContext` | Runtime context for the step. |

**Returns:** `Promise<StepResult<TOutput>>`

The execution order is:
1. Validate `rawInput` against the Zod schema (if provided). Return `'failed'` on validation error.
2. Evaluate the `condition` guard (if provided). Return `'skipped'` when `false`.
3. Run the `handler`, retrying on failure up to `retry.maxRetries` times with backoff.
4. On final failure, invoke `fallback` (if provided). If the fallback also fails, return `'failed'`.

```ts
import { step, executeStep } from '@elsium-ai/workflows'
import type { StepContext } from '@elsium-ai/workflows'

const myStep = step('greet', {
  handler: async (input: { name: string }) => `Hello, ${input.name}!`,
})

const context: StepContext = {
  workflowName: 'demo',
  stepIndex: 0,
  previousOutputs: {},
}

const result = await executeStep(myStep, { name: 'World' }, context)
console.log(result.data) // "Hello, World!"
```

---

## Workflow

### `Workflow`

Interface implemented by all workflow variants (sequential, parallel, and branch).

```ts
interface Workflow {
  readonly name: string
  run(input: unknown, options?: WorkflowRunOptions): Promise<WorkflowResult>
}
```

| Member | Type | Description |
| --- | --- | --- |
| `name` | `string` (readonly) | The workflow identifier. |
| `run` | `(input: unknown, options?: WorkflowRunOptions) => Promise<WorkflowResult>` | Executes the workflow with the given input and returns the aggregated result. |

### `defineWorkflow`

Creates a sequential workflow that executes steps one after another, piping each step's output as the next step's input.

```ts
function defineWorkflow(config: WorkflowConfig): Workflow
```

| Parameter | Type | Description |
| --- | --- | --- |
| `config` | `WorkflowConfig` | Workflow configuration including steps and lifecycle callbacks. |

**Returns:** `Workflow`

When a step completes, its output is stored in `outputs` under the step's name and becomes the input for the next step. If any step fails, the workflow short-circuits and returns with `status: 'failed'`.

```ts
import { defineWorkflow, step } from '@elsium-ai/workflows'

const pipeline = defineWorkflow({
  name: 'etl-pipeline',
  steps: [
    step('extract', {
      handler: async (input: { source: string }) => {
        return await extractData(input.source)
      },
    }),
    step('transform', {
      handler: async (rawData: RawData) => {
        return transformData(rawData)
      },
    }),
    step('load', {
      handler: async (transformed: TransformedData) => {
        await loadData(transformed)
        return { loaded: true }
      },
    }),
  ],
  onStepComplete: (result) => {
    console.log(`Step "${result.name}" finished in ${result.durationMs}ms`)
  },
  onComplete: (result) => {
    console.log(`Workflow "${result.name}" ${result.status}`)
  },
})

const result = await pipeline.run({ source: 'database' })
```

### `ParallelWorkflowConfig`

Configuration for a parallel workflow created via `defineParallelWorkflow`.

```ts
interface ParallelWorkflowConfig {
  name: string
  steps: StepConfig[]
  onComplete?: (result: WorkflowResult) => void | Promise<void>
}
```

| Field | Type | Description |
| --- | --- | --- |
| `name` | `string` | Identifier for the parallel workflow. |
| `steps` | `StepConfig[]` | Steps to execute concurrently; all receive the same input. |
| `onComplete` | `(result: WorkflowResult) => void \| Promise<void>` | Optional callback fired when all steps have settled. |

### `defineParallelWorkflow`

Creates a parallel workflow that executes all steps concurrently using `Promise.all`, where every step receives the same input.

```ts
function defineParallelWorkflow(config: ParallelWorkflowConfig): Workflow
```

| Parameter | Type | Description |
| --- | --- | --- |
| `config` | `ParallelWorkflowConfig` | Parallel workflow configuration. |

**Returns:** `Workflow`

Each step's output is stored in `outputs` under its name. The workflow status is `'failed'` if any step fails, `'completed'` otherwise.

```ts
import { defineParallelWorkflow, step } from '@elsium-ai/workflows'

const enrichment = defineParallelWorkflow({
  name: 'enrich-profile',
  steps: [
    step('fetch-social', {
      handler: async (input: { userId: string }) => {
        return await fetchSocialProfile(input.userId)
      },
    }),
    step('fetch-activity', {
      handler: async (input: { userId: string }) => {
        return await fetchActivityLog(input.userId)
      },
    }),
    step('fetch-preferences', {
      handler: async (input: { userId: string }) => {
        return await fetchPreferences(input.userId)
      },
    }),
  ],
})

const result = await enrichment.run({ userId: 'u_123' })
// result.outputs['fetch-social'], result.outputs['fetch-activity'], etc.
```

### `BranchConfig`

Defines a single branch in a branching workflow, pairing a condition with the workflow to execute when the condition is met.

```ts
interface BranchConfig {
  condition: (input: unknown) => boolean
  workflow: Workflow
}
```

| Field | Type | Description |
| --- | --- | --- |
| `condition` | `(input: unknown) => boolean` | Predicate evaluated against the workflow input. |
| `workflow` | `Workflow` | Workflow to run when `condition` returns `true`. |

### `defineBranchWorkflow`

Creates a branching workflow that evaluates conditions in order and delegates to the first matching branch's workflow, with an optional fallback.

```ts
function defineBranchWorkflow(
  name: string,
  branches: BranchConfig[],
  fallback?: Workflow,
): Workflow
```

| Parameter | Type | Description |
| --- | --- | --- |
| `name` | `string` | Identifier for the branch workflow. |
| `branches` | `BranchConfig[]` | Ordered list of condition/workflow pairs; the first match wins. |
| `fallback` | `Workflow` | Optional workflow to run when no branch condition matches. |

**Returns:** `Workflow`

If no branch matches and no fallback is provided, the workflow returns immediately with `status: 'completed'`, an empty `steps` array, and empty `outputs`.

```ts
import { defineBranchWorkflow, defineWorkflow, step } from '@elsium-ai/workflows'

const textWorkflow = defineWorkflow({
  name: 'process-text',
  steps: [
    step('analyze-text', {
      handler: async (input: { content: string }) => {
        return await analyzeText(input.content)
      },
    }),
  ],
})

const imageWorkflow = defineWorkflow({
  name: 'process-image',
  steps: [
    step('analyze-image', {
      handler: async (input: { content: string }) => {
        return await analyzeImage(input.content)
      },
    }),
  ],
})

const router = defineBranchWorkflow(
  'content-router',
  [
    { condition: (input: any) => input.type === 'text', workflow: textWorkflow },
    { condition: (input: any) => input.type === 'image', workflow: imageWorkflow },
  ],
)

const result = await router.run({ type: 'text', content: 'Hello world' })
```

---

## Resumable Workflows

### `defineResumableWorkflow`

Creates a workflow that persists its progress to a checkpoint store after each step. If the process crashes or is interrupted, the workflow can be resumed from the last successful checkpoint.

```ts
function defineResumableWorkflow(config: {
	name: string
	checkpointStore: CheckpointStore
	steps: StepConfig[]
	onStepComplete?: (result: StepResult) => void | Promise<void>
	onComplete?: (result: WorkflowResult) => void | Promise<void>
}): ResumableWorkflow
```

| Parameter | Type | Description |
| --- | --- | --- |
| `config.name` | `string` | Identifier for the workflow. |
| `config.checkpointStore` | `CheckpointStore` | Storage backend for persisting step results. |
| `config.steps` | `StepConfig[]` | Ordered list of steps to execute sequentially. |
| `config.onStepComplete` | `(result: StepResult) => void \| Promise<void>` | Optional callback fired after each step completes. |
| `config.onComplete` | `(result: WorkflowResult) => void \| Promise<void>` | Optional callback fired when the workflow finishes. |

**Returns:** `ResumableWorkflow`

```ts
interface ResumableWorkflow extends Workflow {
	resume(workflowId: string, options?: WorkflowRunOptions): Promise<WorkflowResult>
}
```

The `resume(workflowId)` method reloads the checkpoint for the given workflow run and continues execution from the first incomplete step, reusing outputs from previously completed steps.

### `createInMemoryCheckpointStore`

Creates an in-memory checkpoint store for development and testing.

```ts
function createInMemoryCheckpointStore(): CheckpointStore
```

```ts
import { defineResumableWorkflow, createInMemoryCheckpointStore, step } from '@elsium-ai/workflows'

const checkpointStore = createInMemoryCheckpointStore()

const workflow = defineResumableWorkflow({
	name: 'data-pipeline',
	checkpointStore,
	steps: [
		step('fetch', {
			handler: async (input: { url: string }) => {
				return await fetch(input.url).then((r) => r.json())
			},
		}),
		step('transform', {
			handler: async (data: unknown) => {
				return transformData(data)
			},
		}),
		step('store', {
			handler: async (transformed: unknown) => {
				await saveToDatabase(transformed)
				return { stored: true }
			},
		}),
	],
})

const result = await workflow.run({ url: 'https://api.example.com/data' })

const resumed = await workflow.resume(result.name)
```

---

## Part of ElsiumAI

This package is the workflow layer of the [ElsiumAI](https://github.com/elsium-ai/elsium-ai) framework. See the [full documentation](https://github.com/elsium-ai/elsium-ai) for guides and examples.

## License

[MIT](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE)
