# @elsium-ai/agents

Agent orchestration, memory, and multi-agent patterns for [ElsiumAI](https://github.com/elsium-ai/elsium-ai).

[![npm](https://img.shields.io/npm/v/@elsium-ai/agents.svg)](https://www.npmjs.com/package/@elsium-ai/agents)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE)

## Install

```bash
npm install @elsium-ai/agents @elsium-ai/core
```

## What's Inside

- **Agent Definition** — Declarative agent creation with system prompts and tool bindings
- **Memory** — Conversation history and context management
- **Semantic Guardrails** — Content filtering and safety boundaries
- **Confidence Scoring** — Measure and threshold agent output confidence
- **Approval Gates** — Human-in-the-loop for high-stakes tool calls
- **State Machines** — FSM-based agent behavior control
- **Multi-Agent** — Orchestrate multiple agents with delegation patterns

## Usage

```typescript
import { defineAgent } from '@elsium-ai/agents'
import { gateway } from '@elsium-ai/gateway'
import { env } from '@elsium-ai/core'

const llm = gateway({
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  apiKey: env('ANTHROPIC_API_KEY'),
})

const agent = defineAgent(
  { name: 'assistant', system: 'You are a helpful assistant.' },
  { complete: (req) => llm.complete(req) },
)

const result = await agent.run('Explain circuit breakers in distributed systems.')
```

## Part of ElsiumAI

This package is the agent layer of the [ElsiumAI](https://github.com/elsium-ai/elsium-ai) framework. See the [full documentation](https://github.com/elsium-ai/elsium-ai) for guides and examples.

## License

[MIT](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE)
