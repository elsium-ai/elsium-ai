---
'elsium-ai': patch
'@elsium-ai/core': patch
'@elsium-ai/tools': patch
'@elsium-ai/agents': patch
---

Documentation coverage for the 0.16.0 surface — closes the gap between shipped APIs and user-facing docs. No runtime changes; docs and READMEs only.

- `docs/getting-started.md`: new subsections for `schemaValidator` / `judgeValidator`, `agent.askHuman({ timeout })` method, agent stream event aliases (`token`, `final`, `thinking`, `tool_call` alongside the granular variants), bare-function preconditions, and the `{ prompt }` shorthand in `agent.replayFrom` overrides.
- `docs/fundamentals.md`: full coverage of `agent.withVerifier` / `withRetryPolicy`, `agent.runResumable` / `resume`, `agent.askHuman({...})` as method, `agent.getTrace` / `listTraces` / `replayFrom`, tool auto-approval gate (`requireApproval`), and the simple stream event aliases mapped against the granular ones.
- `packages/agents/README.md`: fluent verification row updated to mention `schemaValidator` + `judgeValidator` + `JudgeValidatorOptions`; new `agent.askHuman({...})` row.
- `packages/tools/README.md`: tool contracts row updated to note bare-function precondition support.
- `packages/core/README.md`: new rows for `StateStore` + `createInMemoryStateStore`, `AgentPauseSignal` + `pauseAgent`, and the replay primitives moved into core.
