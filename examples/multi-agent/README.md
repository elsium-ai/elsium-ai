# Multi-Agent Example

Demonstrates multi-agent patterns: sequential pipelines, parallel execution, and workflow orchestration.

## Run

```bash
# No API key needed — uses mock providers
bun examples/multi-agent/index.ts
```

## What it demonstrates

- `@elsium-ai/agents` — Specialized agents with different system prompts
- `runSequential()` — Chain agents where output feeds into next input
- `runParallel()` — Run multiple agents concurrently
- `@elsium-ai/workflows` — Structured workflow with named steps
- Cost tracking across multi-agent runs
