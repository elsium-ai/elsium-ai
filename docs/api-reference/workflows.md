# elsium-ai/workflows

Workflow orchestration module for defining and executing multi-step pipelines. Supports sequential, parallel, and conditional branching execution patterns.

```ts
import { step, defineWorkflow, defineParallelWorkflow, defineBranchWorkflow } from 'elsium-ai/workflows'
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
import { step } from 'elsium-ai/workflows'

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
import { step, executeStep } from 'elsium-ai/workflows'

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
import { step, defineWorkflow } from 'elsium-ai/workflows'

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
import { step, defineParallelWorkflow } from 'elsium-ai/workflows'

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
import { defineWorkflow, defineBranchWorkflow } from 'elsium-ai/workflows'

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
  status: WorkflowStatus            // 'pending' | 'running' | 'completed' | 'failed'
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
| `WorkflowStatus` | `'pending'` \| `'running'` \| `'completed'` \| `'failed'` |
| `WorkflowRunOptions` | Run options: `signal?` |
| `Workflow` | Workflow instance: `name`, `run(input, options?)` |

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
