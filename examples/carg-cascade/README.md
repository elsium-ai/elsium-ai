# CARG — Cost-Aware Routed Generation (cascade router)

`createCascadeRouter` routes a request to the cheapest tier first and **escalates** on provider error, validator failure, low confidence, or a classifier-decided difficulty cap. With VAG and CAG plugged in, it closes the operational triad: VAG says wrong → escalate; CAG says uncertain → escalate; classifier says too hard for tier X → skip tier X.

## What this example shows

- Three tiers (`haiku` → `sonnet` → `opus`) with `maxDifficulty` caps.
- Heuristic classifier (zero-cost, keyword + size scoring).
- Custom `escalateOnFailure` hooks for `onProviderError` + `validator`.
- Audit stream of every `tier-attempt` / `tier-escalation` / `cascade-success` event.

## Run

```bash
export ANTHROPIC_API_KEY=your-key
bun examples/carg-cascade/index.ts
```

## When to use

- Most requests are easy and shouldn't pay Opus prices.
- A small fraction need the smarter model — let the cascade make the call.
- You want a single audit stream that says exactly **why** each escalation happened (provider error vs validator failure vs low confidence vs difficulty cap).
