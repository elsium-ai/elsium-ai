# replayFrom — time-travel replay with overrides

`createTraceRecorder` captures the inputs/outputs of every step in an agent run into an `AgentTrace`. `replayFrom(trace, { fromStep, executor, overrides })` re-runs the agent: steps **before** `fromStep` are replayed verbatim from the trace, and steps **at and after** `fromStep` are executed live by your `executor`.

Use it for:

- **Cheap iteration on prompts** — replay the first 80% of a workflow from cache; only the last steps hit the LLM.
- **What-if analysis** — `transform` the input of a specific step to simulate a corrected user message and see how the rest of the workflow changes.
- **Pin a regression** — `replace` a step's output to lock in a known value and isolate which downstream step is misbehaving.

## What this example shows

- Recording a 3-step "research → summarize → tweet" pipeline.
- Full re-execution from step 0 with `transform` swapping the initial query.
- Mid-run replay (`fromStep: 'summarize'`) — `research` is replayed from cache, only `summarize` and `tweet` execute live.
- Hard pinning a step's output via `{ kind: 'replace', output: ... }`.

## Run

```bash
bun examples/replay-from/index.ts
```

No API key needed — the example uses a stubbed executor so the replay semantics are the focus.
