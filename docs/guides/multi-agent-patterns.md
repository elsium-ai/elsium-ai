# Multi-Agent Patterns

A guide to composing agents into systems that collaborate, delegate, and share state.

> This guide assumes familiarity with single-agent setup. See [Fundamentals](../fundamentals.md) for agent basics.

---

## Overview

A single agent handles one task well. Real applications need multiple agents working together: researching, analyzing, routing, and summarizing. ElsiumAI provides composable primitives for multi-agent orchestration:

| Pattern           | Use case                                                            |
| ----------------- | ------------------------------------------------------------------- |
| **Sequential**    | Pipeline where each agent's output feeds the next                   |
| **Parallel**      | Fan-out where agents run concurrently and results are collected     |
| **Supervisor**    | Routing prompt where a coordinator reasons over worker descriptions |
| **Shared memory** | Cross-agent data sharing without tight coupling                     |
| **State machine** | Typed state transitions for complex workflows                       |

---

## Sequential Pattern

Agents execute in order. Each receives the previous agent's output as input. Use this for multi-step processing pipelines.

```ts
import {
  defineAgent,
  runSequential,
  type AgentDependencies,
} from "@elsium-ai/agents";
import { gateway } from "@elsium-ai/gateway";

const llm = gateway({
  provider: "anthropic",
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const deps: AgentDependencies = {
  complete: (request) => llm.complete(request),
  stream: (request) => llm.stream(request),
};

const researcher = defineAgent(
  {
    name: "researcher",
    system: "Find key facts about the given topic.",
  },
  deps,
);

const analyst = defineAgent(
  {
    name: "analyst",
    system: "Identify trends and insights from research notes.",
  },
  deps,
);

const writer = defineAgent(
  {
    name: "writer",
    system: "Produce a concise summary from the analysis.",
  },
  deps,
);

const results = await runSequential(
  [researcher, analyst, writer],
  "The current state of open-source AI frameworks",
);

// results[0] is the researcher result, results[1] is the analyst result,
// and results[2] is the writer's final result.
```

---

## Parallel Pattern

Agents run concurrently and their results are collected. Use this when tasks are independent and you want lower latency or diverse perspectives.

```ts
import {
  defineAgent,
  runParallel,
  type AgentDependencies,
} from "@elsium-ai/agents";
import { gateway } from "@elsium-ai/gateway";

const llm = gateway({
  provider: "anthropic",
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const deps: AgentDependencies = {
  complete: (request) => llm.complete(request),
  stream: (request) => llm.stream(request),
};

const factChecker = defineAgent(
  {
    name: "fact-checker",
    system: "Verify the factual accuracy of the given claims.",
  },
  deps,
);

const sentimentAnalyzer = defineAgent(
  {
    name: "sentiment",
    system: "Analyze the sentiment and tone of the given text.",
  },
  deps,
);

const topicClassifier = defineAgent(
  {
    name: "classifier",
    system: "Classify the text into relevant topic categories.",
  },
  deps,
);

const results = await runParallel(
  [factChecker, sentimentAnalyzer, topicClassifier],
  "ElsiumAI provides enterprise-grade reliability for AI applications.",
);

// results is an array with one entry per agent.
```

---

## Supervisor Pattern

A supervisor agent receives the user's request plus descriptions of the available workers, then produces the response itself. The helper does not execute the worker agents; use it for lightweight routing, triage, and planning prompts where worker names and responsibilities are enough context.

```ts
import {
  defineAgent,
  runSupervisor,
  type AgentDependencies,
} from "@elsium-ai/agents";
import { gateway } from "@elsium-ai/gateway";

const llm = gateway({
  provider: "anthropic",
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const deps: AgentDependencies = {
  complete: (request) => llm.complete(request),
  stream: (request) => llm.stream(request),
};

const supervisor = defineAgent(
  {
    name: "support-router",
    system:
      "Route support requests by choosing the best worker description and explaining the next step.",
  },
  deps,
);

const billingAgent = defineAgent(
  {
    name: "billing",
    system: "Handle billing questions: invoices, payments, and refunds.",
  },
  deps,
);

const technicalAgent = defineAgent(
  {
    name: "technical",
    system: "Handle technical support: bugs, configuration, and integrations.",
  },
  deps,
);

const generalAgent = defineAgent(
  {
    name: "general",
    system: "Handle general inquiries that do not fit billing or technical.",
  },
  deps,
);

const result = await runSupervisor(
  supervisor,
  [billingAgent, technicalAgent, generalAgent],
  "I was charged twice for my last invoice.",
);

// result is produced by the supervisor agent after seeing the worker descriptions.
```

---

## Shared Memory

When agents need to read and write shared state without direct coupling, use `createSharedMemory`. Multi-agent helpers write each agent's output into shared memory under that agent's name.

```ts
import {
  createSharedMemory,
  defineAgent,
  runSequential,
  type AgentDependencies,
} from "@elsium-ai/agents";
import { gateway } from "@elsium-ai/gateway";

const llm = gateway({
  provider: "anthropic",
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const deps: AgentDependencies = {
  complete: (request) => llm.complete(request),
  stream: (request) => llm.stream(request),
};

const memory = createSharedMemory();

const researcher = defineAgent(
  {
    name: "researcher",
    system: "Extract key facts from the input.",
  },
  deps,
);

const analyst = defineAgent(
  {
    name: "analyst",
    system: "Analyze the sentiment of the facts provided.",
  },
  deps,
);

await runSequential(
  [researcher, analyst],
  "Review of the Q4 earnings report...",
  { sharedMemory: memory },
);

const researcherOutput = memory.get("researcher");
const analystOutput = memory.get("analyst");
```

---

## State Machines

For workflows with branching logic and typed state transitions, run an agent through `executeStateMachine`. Each state supplies its own prompt and transition function.

```ts
import { executeStateMachine, type AgentResult } from "@elsium-ai/agents";
import type { CompletionRequest } from "@elsium-ai/core";
import { gateway } from "@elsium-ai/gateway";

const llm = gateway({
  provider: "anthropic",
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const deps = {
  complete: (request: CompletionRequest) => llm.complete(request),
  stream: (request: CompletionRequest) => llm.stream(request),
};

const result = await executeStateMachine(
  {
    name: "order-flow",
    system: "Process customer orders safely.",
  },
  {
    initialState: "validate",
    states: {
      validate: {
        system:
          'Validate the order details. Respond with "valid" or "invalid".',
        transition: (stateResult: AgentResult) => {
          const output = String(stateResult.message.content)
            .trim()
            .toLowerCase();
          return output.startsWith("valid") ? "approve" : "reject";
        },
      },
      approve: {
        system: "Check whether the order can be approved.",
        transition: () => "fulfill",
      },
      fulfill: {
        system: "Summarize fulfillment steps.",
        terminal: true,
        transition: () => "fulfill",
      },
      reject: {
        system: "Explain why the order cannot proceed.",
        terminal: true,
        transition: () => "reject",
      },
    },
  },
  deps,
  "Order ORD-1234 contains two widgets and totals $299.99.",
);

// result.finalState is "fulfill" or "reject".
// result.stateHistory contains the state transitions taken.
```

---

## Combining Patterns

Patterns compose naturally. A common setup uses shared memory with both parallel and sequential stages:

```ts
import {
  createSharedMemory,
  defineAgent,
  runParallel,
  runSequential,
  type AgentResult,
  type AgentDependencies,
} from "@elsium-ai/agents";
import { gateway } from "@elsium-ai/gateway";

const llm = gateway({
  provider: "anthropic",
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const deps: AgentDependencies = {
  complete: (request) => llm.complete(request),
  stream: (request) => llm.stream(request),
};

const memory = createSharedMemory();

const technicalResearcher = defineAgent(
  {
    name: "technical-researcher",
    system: "Evaluate technical risks.",
  },
  deps,
);

const businessResearcher = defineAgent(
  {
    name: "business-researcher",
    system: "Evaluate business risks.",
  },
  deps,
);

const synthesizer = defineAgent(
  {
    name: "synthesizer",
    system: "Combine research findings into a decision brief.",
  },
  deps,
);

const editor = defineAgent(
  {
    name: "editor",
    system: "Polish the decision brief for executives.",
  },
  deps,
);

const perspectives = await runParallel(
  [technicalResearcher, businessResearcher],
  "Evaluate the migration to a new database",
  { sharedMemory: memory },
);

const report = await runSequential(
  [synthesizer, editor],
  JSON.stringify(
    perspectives.map((result: AgentResult) => result.message.content),
  ),
  { sharedMemory: memory },
);
```

---

## Best Practices

1. **Keep agents focused.** Each agent should have a single, clear responsibility. A "do everything" agent is harder to debug and optimize than a pipeline of specialists.

2. **Use shared memory for coordination.** Prefer shared memory over passing large payloads between agents. It decouples agents and makes the data flow explicit.

3. **Handle failures around the pattern.** Wrap `runSequential`, `runParallel`, or `runSupervisor` in your own retry, fallback, or partial-result policy.

4. **Set budgets per agent.** In multi-agent systems, costs can compound quickly. Assign per-agent token and cost budgets to stay within limits.

5. **Trace across agents.** Use `xrayMiddleware` on the gateway so all agent calls share a trace ID. This makes debugging multi-agent flows straightforward.

6. **Test with mock providers.** Use `@elsium-ai/testing` to mock LLM responses and test your orchestration logic without real API calls.

```ts
import { mockProvider } from "@elsium-ai/testing";

const mock = mockProvider({
  responses: [
    { content: "Fact 1, Fact 2, Fact 3" },
    { content: "Positive trend detected" },
  ],
});
```
