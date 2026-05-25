---
'elsium-ai': minor
'@elsium-ai/core': minor
'@elsium-ai/tools': minor
'@elsium-ai/agents': minor
'@elsium-ai/testing': patch
---

Five critical features that close the gap between the 0.15.0 building blocks and the ergonomic, fluent, ReAct-integrated experience users expect from a production AI framework.

**C — Fluent verification on the agent.** `defineAgent(...).withVerifier(zodValidator(schema)).withRetryPolicy({ maxAttempts: 3 })` returns an immutable new agent whose `run()` and `generate()` automatically loop generate → validate → repair-or-abort using the existing `runWithVerification` engine. Validators operate on `AgentResult` so they can inspect the message, tool calls, or any aggregated state. Without verifiers attached the agent behaves identically to before — zero overhead for users who don't opt in.

**D — Complete streaming wrap-up.** The `agent_end` stream event now carries `stopReason` alongside `result`, making it a true terminal "final" event with everything a consumer needs to close out the run (message, usage, toolCalls, traceId, stopReason). `tool_result` and the full `thinking_*` / `tool_call_*` discriminated union were already in place from 0.15.0; this completes the spec.

**E — Auto-approval gate for destructive tools.** `defineTool` accepts a new `requireApproval: 'auto' | 'always' | 'never'` option (default `'auto'`). When set to `'auto'`, destructive-level tools call `context.requestApproval` (if provided) before the handler runs — denials are returned as `{ success: false, approvalDenied: true, approvalReason }` and the handler is never invoked. Approval is skipped automatically when `dryRun: true`. Tools without a `requestApproval` handler log a warning and proceed (back-compat). Three new exported types: `ApprovalRequest`, `ApprovalDecision`, `ApprovalHandler`.

**A (MVP) — Pause + resume around explicit pause signals.** Adds `AgentPauseSignal` + `pauseAgent(reason, context)` in `@elsium-ai/core`. A tool handler calling `pauseAgent(...)` throws a signal that propagates through `tool.execute()` (which now re-throws pause signals instead of wrapping them as failures). `agent.runResumable(input, options, { stateStore })` catches the signal, snapshots `{ messages, originalInput, pausedAt, options }` to a `StateStore`, and returns `{ status: 'paused', resumeToken }`. `agent.resume(resumeToken, { followUpMessage })` loads the snapshot and continues the run via `agent.chat()`. Ships a `createInMemoryStateStore<TSnapshot>` adapter — production durability requires a user-supplied store (Redis, Postgres, SQLite, S3). **MVP scope:** snapshot only at explicit pause points, not on every iteration; full crash-recovery across restarts is a follow-up ticket.

**B (MVP) — Replay integrated into the agent.** Every `agent.run()` automatically attaches a `TraceRecorder` and records each LLM iteration as a step (`llm:iter_N`). The trace is kept in an in-memory ring buffer (cap 100 per agent) and accessible via `agent.getTrace(traceId)` and `agent.listTraces()`. `agent.replayFrom(traceId, { fromStep, overrides })` calls the core `replayFrom` with an executor that re-runs the LLM step with the recorded (or overridden) request — perfect for "agent failed in prod → swap a prompt → see the downstream change without re-paying for upstream calls". Replay primitives (`createTraceRecorder`, `replayFrom`, all related types) moved from `@elsium-ai/testing` to `@elsium-ai/core` so the agent runtime can use them without breaking the package DAG; `@elsium-ai/testing` keeps the same exports via re-export (no breaking change). **MVP scope:** records only LLM steps, not tool calls; in-memory store only.

**Spec-compliance polish.** Closes six remaining ergonomic gaps so the public 60-second demos match the published spec verbatim:

- `schemaValidator` is exported as an alias for `zodValidator` so `agent.withVerifier(schemaValidator(MySchema))` matches the spec.
- `judgeValidator({ rubric, judge, threshold? })` is new — wraps any user-supplied LLM-as-judge function around a rubric string. Returns a `Validator<T>` that fails with the judge's score/reason as the repair hint.
- `AgentStreamEvent` gains four spec-named variants emitted alongside the granular ones: `token` (after every `text_delta`), `thinking` (after a complete `thinking_start → ... → thinking_end` cycle, carrying the full reasoning text), `tool_call` (after `tool_call_end`, carrying the parsed final arguments), and `final` (alongside `agent_end`, carrying message + usage + toolCalls + stopReason). The granular events still fire — consumers pick whichever style they prefer. Zero breaking changes.
- `defineTool({ preconditions: [...] })` now accepts bare `PreconditionFn` entries alongside the `{ name, check }` form. Bare functions are auto-named from `fn.name` or fall back to `precondition_N`.
- `agent.askHuman({ question, options, context, timeout })` is now a method on every agent — delegates to the standalone `askHuman` and accepts `timeout` as a duration string (`'24h'`, `'5m'`) or a number.
- `agent.replayFrom(traceId, { fromStep, overrides })` accepts a `{ prompt: newPrompt }` shorthand inside `overrides`. The shorthand is translated to a `kind: 'transform'` override that swaps the request's `system` field, so spec demos like `overrides: { 'llm:iter_1': { prompt: '...' } }` work directly.
