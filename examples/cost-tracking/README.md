# Cost Tracking Example

Demonstrates cost intelligence with budget tracking, loop detection, and model suggestions.

## Run

```bash
export OPENAI_API_KEY=your-key    # or ANTHROPIC_API_KEY
bun run examples/cost-tracking/index.ts
```

## What it demonstrates

- `elsium-ai/observe` — cost engine, budget enforcement, model suggestions
- `elsium-ai/gateway` — pricing calculation, multi-model cost comparison
- Per-user and per-agent budget tracking
- Cost projection and optimization recommendations
