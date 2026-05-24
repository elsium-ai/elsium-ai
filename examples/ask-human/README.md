# askHuman — durable human-in-the-loop

`askHuman` lets a tool or agent pause and request input from a human. Two modes:

- **Responder mode** — a function resolves the question synchronously (good for tests, CLI prompts, in-process workflows).
- **Store mode** — the question is persisted to a durable store, the call awaits until something writes the answer back (good for long-running agents, queued review by a human reviewer over hours/days).

## What this example shows

- A `requestRefund` tool that escalates anything `>$500` via `askHuman`.
- **Responder mode** — auto-approve / auto-deny branches.
- **Store mode** — the agent issues a question and the example simulates a human resolving it from a separate code path after a delay.

## Run

```bash
bun examples/ask-human/index.ts
```

No API key needed — example is a self-contained simulation of the responder + store flows.
