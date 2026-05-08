---
'@elsium-ai/tools': patch
'elsium-ai': patch
---

Fix two issues found during QA testing of the sandbox feature.

**Bug fix — abort error message reported as timeout:**

When a tool execution was cancelled by an external `AbortSignal` (e.g. `AsyncAgent.cancel()` propagating to a tool call), the `ToolExecutionResult.error` reported `"Request to <tool> timed out after 30000ms"`. The cancel path and the timeout path shared a single `ElsiumError.timeout(...)` rejection. Fixed by tracking which signal aborted (timer vs. user signal) and emitting a distinct `TOOL_ERROR`-coded `ElsiumError` with message `Tool "<name>" was aborted` for the cancellation case. Timeout messages are unchanged.

This also fixes a related regression where `timeoutMs` did not actually fire when the caller passed their own `AbortSignal` — the previous code stored the user's signal in `ctx` and aborted a different controller, so the framework timeout was effectively dead. Now both share one controller, so timeouts fire even with a user signal.

**Documentation + runtime warning — Bun crash isolation gap:**

The Worker-thread sandbox backend has one runtime-specific behaviour gap: under Bun, `process.exit()` inside a sandboxed handler does **not** terminate the worker (it does on Node). The handler keeps running and may return a normal-looking value that the framework records as `success: true`. Other isolation guarantees (process, memory, closure-state, timeout, abort) hold under both runtimes — only the `process.exit()` death path differs.

- New "Runtime caveat" section in `docs/guides/tool-sandboxing.md`.
- Updated the threat-model and "what's enforced" tables to clarify the Bun caveat instead of claiming unconditional `process.exit` mitigation.
- New runtime warning: when `defineTool` is called with a `sandbox` config under Bun, the framework emits a one-time `log.warn` so users learn about the gap at construction time, not after a `process.exit` slips through.

A future `mode: 'process'` (using `child_process.fork`) is on the roadmap and will give true OS-level process isolation with consistent `process.exit()` semantics across runtimes.

**Tests:** 2 new regression tests covering the abort message bug and the timeout-with-user-signal regression.
