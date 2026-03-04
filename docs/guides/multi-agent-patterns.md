# Multi-Agent Patterns

A guide to composing agents into systems that collaborate, delegate, and share state.

> This guide assumes familiarity with single-agent setup. See [Fundamentals](../fundamentals.md) for agent basics.

---

## Overview

A single agent handles one task well. Real applications need multiple agents working together — researching, analyzing, routing, and summarizing. ElsiumAI provides composable primitives for multi-agent orchestration:

| Pattern | Use case |
|---------|----------|
| **Sequential** | Pipeline — each agent's output feeds the next |
| **Parallel** | Fan-out — run agents concurrently, collect results |
| **Supervisor** | Delegation — a coordinator routes to specialized workers |
| **Shared memory** | Cross-agent data sharing without tight coupling |
| **State machine** | Typed state transitions for complex workflows |

---

## Sequential Pattern

Agents execute in order. Each receives the previous agent's output as input. Use this for multi-step processing pipelines.

```ts
import { createAgent, runSequential } from 'elsium-ai/agents'
import { createGateway } from 'elsium-ai/gateway'

const gateway = createGateway({
  providers: { anthropic: { apiKey: process.env.ANTHROPIC_API_KEY! } },
})

const researcher = createAgent({
  name: 'researcher',
  gateway,
  systemPrompt: 'You are a research assistant. Find key facts about the given topic.',
})

const analyst = createAgent({
  name: 'analyst',
  gateway,
  systemPrompt: 'You are an analyst. Given research notes, identify trends and insights.',
})

const writer = createAgent({
  name: 'writer',
  gateway,
  systemPrompt: 'You are a technical writer. Produce a concise summary from the analysis.',
})

const result = await runSequential({
  agents: [researcher, analyst, writer],
  input: 'The current state of open-source AI frameworks',
})

// result.output contains the writer's final summary
// result.steps contains each agent's individual output
```

---

## Parallel Pattern

Agents run concurrently and their results are collected. Use this when tasks are independent and you want lower latency or diverse perspectives.

```ts
import { createAgent, runParallel } from 'elsium-ai/agents'

const factChecker = createAgent({
  name: 'fact-checker',
  gateway,
  systemPrompt: 'Verify the factual accuracy of the given claims.',
})

const sentimentAnalyzer = createAgent({
  name: 'sentiment',
  gateway,
  systemPrompt: 'Analyze the sentiment and tone of the given text.',
})

const topicClassifier = createAgent({
  name: 'classifier',
  gateway,
  systemPrompt: 'Classify the text into relevant topic categories.',
})

const results = await runParallel({
  agents: [factChecker, sentimentAnalyzer, topicClassifier],
  input: 'ElsiumAI provides enterprise-grade reliability for AI applications.',
})

// results is an array — one entry per agent, in the same order
// results[0].output — fact-checker's assessment
// results[1].output — sentiment analysis
// results[2].output — topic classification
```

---

## Supervisor Pattern

A supervisor agent receives the user's request, decides which specialized worker should handle it, and delegates. Use this for routing, triage, and customer support flows.

```ts
import { createAgent, createSupervisor } from 'elsium-ai/agents'

const billingAgent = createAgent({
  name: 'billing',
  gateway,
  systemPrompt: 'You handle billing questions: invoices, payments, refunds.',
})

const technicalAgent = createAgent({
  name: 'technical',
  gateway,
  systemPrompt: 'You handle technical support: bugs, configuration, integrations.',
})

const generalAgent = createAgent({
  name: 'general',
  gateway,
  systemPrompt: 'You handle general inquiries that do not fit billing or technical.',
})

const supervisor = createSupervisor({
  name: 'support-router',
  gateway,
  workers: {
    billing: billingAgent,
    technical: technicalAgent,
    general: generalAgent,
  },
  routingPrompt: `You are a customer support router. Based on the user's message,
    delegate to the appropriate worker: "billing", "technical", or "general".
    Respond with only the worker name.`,
})

const result = await supervisor.run('I was charged twice for my last invoice.')
// result.delegatedTo — "billing"
// result.output — billing agent's response
```

---

## Shared Memory

When agents need to read and write shared state without direct coupling, use `createSharedMemory`. This is a typed key-value store accessible by all agents in a group.

```ts
import { createAgent, runSequential, createSharedMemory } from 'elsium-ai/agents'

const memory = createSharedMemory<{
  facts: string[]
  sentiment: string
  finalReport: string
}>()

const researcher = createAgent({
  name: 'researcher',
  gateway,
  systemPrompt: 'Extract key facts from the input. Store them as a list.',
  onComplete: async (output, ctx) => {
    ctx.sharedMemory.set('facts', JSON.parse(output))
  },
})

const analyst = createAgent({
  name: 'analyst',
  gateway,
  systemPrompt: 'Analyze sentiment of the facts provided.',
  onStart: async (ctx) => {
    const facts = ctx.sharedMemory.get('facts')
    return `Analyze these facts: ${JSON.stringify(facts)}`
  },
  onComplete: async (output, ctx) => {
    ctx.sharedMemory.set('sentiment', output)
  },
})

const result = await runSequential({
  agents: [researcher, analyst],
  input: 'Review of the Q4 earnings report...',
  sharedMemory: memory,
})

// memory.get('facts') — researcher's extracted facts
// memory.get('sentiment') — analyst's sentiment assessment
```

---

## State Machines

For workflows with branching logic and typed state transitions, define a state machine. Each state maps to an agent, and transitions are determined by the agent's output or custom logic.

```ts
import { createStateMachine } from 'elsium-ai/agents'

interface OrderContext {
  orderId: string
  items: string[]
  total: number
  approved: boolean
}

const orderFlow = createStateMachine<OrderContext>({
  initial: 'validate',
  context: { orderId: '', items: [], total: 0, approved: false },
  states: {
    validate: {
      agent: createAgent({
        name: 'validator',
        gateway,
        systemPrompt: 'Validate the order details. Respond "valid" or "invalid:<reason>".',
      }),
      transitions: {
        valid: 'approve',
        invalid: 'reject',
      },
    },
    approve: {
      agent: createAgent({
        name: 'approver',
        gateway,
        systemPrompt: 'Check if the order total is within budget. Respond "approved" or "needs_review".',
      }),
      transitions: {
        approved: 'fulfill',
        needs_review: 'review',
      },
    },
    review: {
      agent: createAgent({
        name: 'reviewer',
        gateway,
        systemPrompt: 'Review the flagged order and make a final decision.',
      }),
      transitions: {
        approved: 'fulfill',
        rejected: 'reject',
      },
    },
    fulfill: { type: 'final' },
    reject: { type: 'final' },
  },
})

const result = await orderFlow.run({
  orderId: 'ORD-1234',
  items: ['Widget A', 'Widget B'],
  total: 299.99,
  approved: false,
})

// result.finalState — "fulfill" or "reject"
// result.context — updated OrderContext
// result.history — array of state transitions taken
```

---

## Combining Patterns

Patterns compose naturally. A common setup uses shared memory with both sequential and parallel stages:

```ts
import {
  createAgent,
  runSequential,
  runParallel,
  createSharedMemory,
} from 'elsium-ai/agents'

const memory = createSharedMemory()

// Stage 1: Parallel research from multiple perspectives
const perspectives = await runParallel({
  agents: [technicalResearcher, businessResearcher, userResearcher],
  input: 'Evaluate the migration to a new database',
  sharedMemory: memory,
})

// Stage 2: Sequential synthesis
const report = await runSequential({
  agents: [synthesizer, editor],
  input: JSON.stringify(perspectives.map(p => p.output)),
  sharedMemory: memory,
})
```

---

## Best Practices

1. **Keep agents focused.** Each agent should have a single, clear responsibility. A "do everything" agent is harder to debug and optimize than a pipeline of specialists.

2. **Use shared memory for coordination.** Prefer shared memory over passing large payloads between agents. It decouples agents and makes the data flow explicit.

3. **Handle failures at the pattern level.** Use `onError` callbacks on `runSequential` and `runParallel` to decide whether to retry, skip, or abort.

4. **Set budgets per agent.** In multi-agent systems, costs can compound quickly. Assign per-agent token and cost budgets to stay within limits.

5. **Trace across agents.** Use `xrayMiddleware` on the gateway so all agent calls share a trace ID. This makes debugging multi-agent flows straightforward.

6. **Test with mock providers.** Use `@elsium-ai/testing` to mock LLM responses and test your orchestration logic without real API calls.

```ts
import { createMockGateway } from '@elsium-ai/testing'

const mockGateway = createMockGateway({
  responses: {
    researcher: 'Fact 1, Fact 2, Fact 3',
    analyst: 'Positive trend detected',
  },
})
```
