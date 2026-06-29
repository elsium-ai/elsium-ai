# elsium-ai/workflows

Workflow orchestration module for defining and executing multi-step pipelines. Supports sequential, parallel, and conditional branching execution patterns.

```ts
import { step, defineWorkflow, defineParallelWorkflow, defineBranchWorkflow } from '@elsium-ai/workflows'
```

---

## Step Definition

| Export | Signature | Description |
|---|---|---|
| `step` | `step<TInput, TOutput>(name, config): StepConfig` | Define a named workflow step |
| `executeStep` | `executeStep<TInput, TOutput>(stepConfig, rawInput, context): Promise<StepResult>` | Execute a single step directly |

### step

Creates a step configuration with a name and handler function.

```ts
import { step } from '@elsium-ai/workflows'

const fetchData = step('fetch-data', {
  handler: async (input: { url: string }, ctx) => {
    const response = await fetch(input.url)
    return response.json()
  },
  retry: { maxRetries: 3, baseDelayMs: 1000 },
  timeoutMs: 10000,
})
```

### executeStep

Runs a single step outside of a workflow context.

```ts
import { step, executeStep } from '@elsium-ai/workflows'

const result = await executeStep(fetchData, { url: 'https://api.example.com/data' }, {
  workflowName: 'manual',
  stepIndex: 0,
  previousOutputs: {},
})
// => { name: 'fetch-data', status: 'completed', data: {...}, durationMs: 142, retryCount: 0 }
```

---

## Sequential Workflow

| Export | Signature | Description |
|---|---|---|
| `defineWorkflow` | `defineWorkflow(config: WorkflowConfig): Workflow` | Define a linear step-by-step workflow |

Steps execute in order. Each step receives the previous step's output as input.

```ts
import { step, defineWorkflow } from '@elsium-ai/workflows'

const pipeline = defineWorkflow({
  name: 'data-pipeline',
  steps: [
    step('fetch', {
      handler: async (input: { url: string }) => {
        const res = await fetch(input.url)
        return res.json()
      },
    }),
    step('transform', {
      handler: async (data: unknown) => {
        return processData(data)
      },
    }),
    step('save', {
      handler: async (processed: unknown) => {
        await db.insert(processed)
        return { saved: true }
      },
    }),
  ],
  onStepComplete: (result) => {
    console.log(`Step ${result.name}: ${result.status} (${result.durationMs}ms)`)
  },
  onStepError: (error, stepName) => {
    console.error(`Step ${stepName} failed:`, error.message)
  },
})

const result = await pipeline.run({ url: 'https://api.example.com/data' })
```

---

## Parallel Workflow

| Export | Signature | Description |
|---|---|---|
| `defineParallelWorkflow` | `defineParallelWorkflow(config: ParallelWorkflowConfig): Workflow` | Run all steps concurrently |

All steps receive the same initial input and execute in parallel.

```ts
import { step, defineParallelWorkflow } from '@elsium-ai/workflows'

const fanOut = defineParallelWorkflow({
  name: 'multi-search',
  steps: [
    step('search-web', {
      handler: async (query: { text: string }) => searchWeb(query.text),
    }),
    step('search-db', {
      handler: async (query: { text: string }) => searchDB(query.text),
    }),
    step('search-cache', {
      handler: async (query: { text: string }) => searchCache(query.text),
    }),
  ],
  onComplete: (result) => {
    console.log(`All searches completed in ${result.totalDurationMs}ms`)
  },
})

const result = await fanOut.run({ text: 'ElsiumAI documentation' })
// result.outputs contains each step's output keyed by step name
```

---

## Branch Workflow

| Export | Signature | Description |
|---|---|---|
| `defineBranchWorkflow` | `defineBranchWorkflow(name, branches, fallback?): Workflow` | Conditional branching based on input |

Routes input to the first branch whose condition returns `true`. An optional fallback workflow handles unmatched inputs.

```ts
import { defineWorkflow, defineBranchWorkflow } from '@elsium-ai/workflows'

const textPipeline = defineWorkflow({ name: 'text', steps: [/* ... */] })
const imagePipeline = defineWorkflow({ name: 'image', steps: [/* ... */] })
const defaultPipeline = defineWorkflow({ name: 'default', steps: [/* ... */] })

const router = defineBranchWorkflow('content-router', [
  {
    condition: (input: unknown) => (input as any).type === 'text',
    workflow: textPipeline,
  },
  {
    condition: (input: unknown) => (input as any).type === 'image',
    workflow: imagePipeline,
  },
], defaultPipeline)

const result = await router.run({ type: 'text', data: '...' })
```

---

## DAG Workflow

| Export | Signature | Description |
|---|---|---|
| `defineDagWorkflow` | `defineDagWorkflow(config: DagWorkflowConfig): Workflow` | Run steps as a dependency graph |

Steps declare their dependencies via `dependsOn`. The workflow computes a topological order and executes independent steps concurrently in waves. A step receives the output of its first declared dependency as input (falling back to the workflow input when it has none). Execution stops after the first wave that contains a failed step. Unknown dependencies and cycles throw at run time.

```ts
import { step, defineDagWorkflow } from '@elsium-ai/workflows'

const build = defineDagWorkflow({
  name: 'build-pipeline',
  steps: [
    step('compile', { handler: async (src: { files: string[] }) => compile(src) }),
    { ...step('test', { handler: async (artifact) => runTests(artifact) }), dependsOn: ['compile'] },
    { ...step('lint', { handler: async (artifact) => runLint(artifact) }), dependsOn: ['compile'] },
    { ...step('package', { handler: async (artifact) => bundle(artifact) }), dependsOn: ['test', 'lint'] },
  ],
  onStepComplete: (result) => console.log(`${result.name}: ${result.status}`),
})

const result = await build.run({ files: ['a.ts', 'b.ts'] })
// 'compile' runs first; 'test' and 'lint' run in parallel; 'package' runs last.
```

### DagWorkflowConfig

```ts
interface DagWorkflowConfig {
  name: string
  steps: DagStepConfig[]
  onStepComplete?: (result: StepResult) => void | Promise<void>
  onStepError?: (error: Error, stepName: string) => void | Promise<void>
  onComplete?: (result: WorkflowResult) => void | Promise<void>
}
```

### DagStepConfig

Extends `StepConfig` with a dependency list.

```ts
interface DagStepConfig<TInput, TOutput> extends StepConfig<TInput, TOutput> {
  dependsOn?: string[]  // names of steps that must complete first
}
```

---

## Resumable Workflows

| Export | Signature | Description |
|---|---|---|
| `defineResumableWorkflow` | `defineResumableWorkflow(config: ResumableWorkflowConfig): ResumableWorkflow` | Sequential workflow that checkpoints progress and can resume after a failure |
| `createInMemoryCheckpointStore` | `createInMemoryCheckpointStore(): CheckpointStore` | In-memory checkpoint store (reference adapter) |

A resumable workflow saves a `WorkflowCheckpoint` before each step. If a step fails, the checkpoint is persisted with `status: 'failed'` and the run returns. Calling `resume(workflowId)` reloads the checkpoint and continues from the step that failed; resuming an already-completed workflow returns its stored result. Provide your own `CheckpointStore` implementation for durable persistence — the package ships only the in-memory adapter.

```ts
import { step, defineResumableWorkflow, createInMemoryCheckpointStore } from '@elsium-ai/workflows'

const store = createInMemoryCheckpointStore()

const order = defineResumableWorkflow({
  name: 'process-order',
  checkpointStore: store,
  steps: [
    step('reserve', { handler: async (o: { id: string }) => reserveStock(o) }),
    step('charge', { handler: async (o) => chargeCard(o) }),
    step('ship', { handler: async (o) => createShipment(o) }),
  ],
})

const first = await order.run({ id: 'ord-42' }, { workflowId: 'ord-42' })

if (first.status === 'failed') {
  // ...fix the underlying issue, then continue from the failed step
  const final = await order.resume('ord-42')
}

const checkpoint = await order.getCheckpoint('ord-42')
const all = await order.listCheckpoints()
```

### ResumableWorkflowConfig

Extends `WorkflowConfig` with a checkpoint store.

```ts
interface ResumableWorkflowConfig extends WorkflowConfig {
  checkpointStore: CheckpointStore
}
```

### ResumableWorkflowRunOptions

Extends `WorkflowRunOptions`. Pass a `workflowId` to use a stable identifier (so the run can be resumed by that id); one is generated when omitted.

```ts
interface ResumableWorkflowRunOptions extends WorkflowRunOptions {
  workflowId?: string  // defaults to a generated id
}
```

### ResumableWorkflow

```ts
interface ResumableWorkflow {
  readonly name: string
  run(input: unknown, options?: ResumableWorkflowRunOptions): Promise<WorkflowResult>
  resume(workflowId: string, options?: WorkflowRunOptions): Promise<WorkflowResult>
  getCheckpoint(workflowId: string): Promise<WorkflowCheckpoint | null>
  listCheckpoints(): Promise<WorkflowCheckpoint[]>
}
```

### CheckpointStore

The port a backend must implement to persist checkpoints.

```ts
interface CheckpointStore {
  save(checkpoint: WorkflowCheckpoint): Promise<void>
  load(workflowId: string): Promise<WorkflowCheckpoint | null>
  delete(workflowId: string): Promise<void>
  list(workflowName?: string): Promise<WorkflowCheckpoint[]>
}
```

### WorkflowCheckpoint

```ts
interface WorkflowCheckpoint {
  workflowId: string
  workflowName: string
  status: 'running' | 'completed' | 'failed' | 'paused'
  input: unknown
  currentStepIndex: number
  stepResults: StepResult[]
  outputs: Record<string, unknown>
  createdAt: number
  updatedAt: number
}
```

---

## Idempotent Steps

Step-level deduplication for side-effectful workflows (POST to an external API, DB writes, sending email). When a workflow is resumed after a crash, an idempotent step that already ran is served from the store instead of re-executing. The package ships only the in-memory adapter; implement `IdempotentCheckpointStore` against your backend for durability.

| Export | Signature | Description |
|---|---|---|
| `createInMemoryIdempotentCheckpointStore` | `createInMemoryIdempotentCheckpointStore(): IdempotentCheckpointStore` | In-memory store extending `CheckpointStore` with per-step records |
| `executeIdempotentStep` | `executeIdempotentStep<TInput, TOutput>(args): Promise<StepResult<TOutput>>` | Run a step, returning the cached result if one exists for its idempotency key |
| `resolveIdempotencyKey` | `resolveIdempotencyKey<TInput>(step, input): Promise<string \| null>` | Compute a step's idempotency key, or `null` when the step is not idempotent |
| `defaultIdempotencyKey` | `defaultIdempotencyKey(input): Promise<string>` | Default key: a stable SHA-256 over the input JSON |

A step opts in by setting `idempotent: true` (see `IdempotentStepConfig`). `executeIdempotentStep` resolves the key; if the step is not idempotent it falls through to a normal `executeStep`. Otherwise it checks the store for an existing record under `(workflowId, stepName, idempotencyKey)` and returns it as a `StepResult` (with `durationMs: 0`) on a hit, or runs the step and records the outcome on a miss.

```ts
import {
  step,
  executeIdempotentStep,
  createInMemoryIdempotentCheckpointStore,
} from '@elsium-ai/workflows'

const store = createInMemoryIdempotentCheckpointStore()

const charge: IdempotentStepConfig<{ orderId: string }, { receiptId: string }> = {
  ...step('charge', { handler: async (o) => chargeCard(o) }),
  idempotent: true,
  idempotencyKey: (o) => o.orderId,  // optional; defaults to a hash of the input
}

const result = await executeIdempotentStep({
  workflowId: 'ord-42',
  step: charge,
  input: { orderId: 'ord-42' },
  context: { workflowName: 'process-order', stepIndex: 1, previousOutputs: {} },
  store,
})
// A second call with the same input returns the recorded result without re-charging.
```

### IdempotentStepConfig

Extends `StepConfig` with idempotency opt-in.

```ts
interface IdempotentStepConfig<TInput, TOutput> extends StepConfig<TInput, TOutput> {
  readonly idempotent?: boolean
  readonly idempotencyKey?: (input: TInput) => string  // defaults to defaultIdempotencyKey
}
```

---

## Workflow Interface

All workflow types return a `Workflow` instance.

```ts
interface Workflow {
  readonly name: string
  run(input: unknown, options?: WorkflowRunOptions): Promise<WorkflowResult>
}
```

### WorkflowRunOptions

```ts
interface WorkflowRunOptions {
  signal?: AbortSignal  // Abort signal for cancellation
}
```

### WorkflowResult

```ts
interface WorkflowResult {
  name: string
  status: WorkflowStatus            // 'pending' | 'running' | 'completed' | 'failed' | 'paused'
  steps: StepResult[]               // Results for each step
  totalDurationMs: number
  outputs: Record<string, unknown>  // Step outputs keyed by step name
}
```

---

## Types

| Export | Description |
|---|---|
| `StepConfig` | Step definition: `name`, `handler`, `retry?`, `condition?`, `fallback?`, `timeoutMs?`, `input?` (Zod schema) |
| `StepContext` | Context passed to handlers: `workflowName`, `stepIndex`, `previousOutputs`, `signal?` |
| `StepResult` | Step outcome: `name`, `status`, `data?`, `error?`, `durationMs`, `retryCount` |
| `StepStatus` | `'pending'` \| `'running'` \| `'completed'` \| `'failed'` \| `'skipped'` |
| `RetryConfig` | Retry options: `maxRetries`, `baseDelayMs?`, `maxDelayMs?`, `shouldRetry?` |
| `WorkflowConfig` | Sequential config: `name`, `steps[]`, `onStepComplete?`, `onStepError?`, `onComplete?` |
| `ParallelWorkflowConfig` | Parallel config: `name`, `steps[]`, `onComplete?` |
| `BranchConfig` | Branch definition: `condition` function and `workflow` |
| `WorkflowResult` | Workflow outcome: `name`, `status`, `steps[]`, `totalDurationMs`, `outputs` |
| `WorkflowStatus` | `'pending'` \| `'running'` \| `'completed'` \| `'failed'` \| `'paused'` |
| `WorkflowRunOptions` | Run options: `signal?` |
| `Workflow` | Workflow instance: `name`, `run(input, options?)` |
| `DagWorkflowConfig` | DAG config: `name`, `steps[]`, `onStepComplete?`, `onStepError?`, `onComplete?` |
| `DagStepConfig` | DAG step: `StepConfig` plus `dependsOn?` (dependency step names) |
| `ResumableWorkflowConfig` | Resumable config: `WorkflowConfig` plus `checkpointStore` |
| `ResumableWorkflowRunOptions` | Run options: `signal?`, `workflowId?` |
| `ResumableWorkflow` | Resumable instance: `name`, `run`, `resume`, `getCheckpoint`, `listCheckpoints` |
| `CheckpointStore` | Checkpoint persistence port: `save`, `load`, `delete`, `list` |
| `WorkflowCheckpoint` | Saved progress: `workflowId`, `workflowName`, `status`, `input`, `currentStepIndex`, `stepResults[]`, `outputs`, `createdAt`, `updatedAt` |
| `IdempotentStepConfig` | Step: `StepConfig` plus `idempotent?`, `idempotencyKey?` |

---

## Step Configuration Details

### Retry

Automatic retry with exponential backoff.

```ts
step('unreliable-api', {
  handler: async (input) => callExternalAPI(input),
  retry: {
    maxRetries: 3,
    baseDelayMs: 500,
    maxDelayMs: 5000,
    shouldRetry: (error) => error.message.includes('timeout'),
  },
})
```

### Conditional Execution

Skip a step based on input or prior context.

```ts
step('optional-enrichment', {
  condition: (input, ctx) => input.needsEnrichment === true,
  handler: async (input) => enrichData(input),
})
```

### Fallback

Provide a fallback value when a step fails.

```ts
step('fetch-with-fallback', {
  handler: async (input) => fetchFromPrimary(input),
  fallback: async (error, input) => {
    return { data: null, source: 'fallback' }
  },
})
```

### Input Validation

Validate step input with a Zod schema.

```ts
import { z } from 'zod'

step('validated-step', {
  input: z.object({ url: z.string().url(), limit: z.number().positive() }),
  handler: async (input) => {
    // input is typed as { url: string, limit: number }
    return fetch(input.url)
  },
})
```
