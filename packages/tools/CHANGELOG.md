# @elsium-ai/tools

## 0.17.0

### Minor Changes

- 662d64c: Harden the tool sandbox so it no longer forwards the host `process.env` to sandboxed handlers. Both `worker` and `process` modes now run with a minimal allow-listed environment, preventing tool code (including LLM-generated or third-party handlers) from reading host secrets such as API keys and tokens via `process.env`.

  A new optional `sandbox.env` config explicitly passes through only the variables a handler genuinely needs:

  ```ts
  defineTool({
    name: "fetch-data",
    sandbox: { mode: "process", handler, env: { MY_FLAG: "on" } },
  });
  ```

  This makes the previously documented "sandbox has its own env" guarantee actually hold. Tools that relied on inheriting the full host environment must now declare the variables they need via `sandbox.env`.

### Patch Changes

- @elsium-ai/core@0.17.0

## 0.16.1

### Patch Changes

- @elsium-ai/core@0.16.1

## 0.16.0

### Minor Changes

- 6c7de04: Five critical features that close the gap between the 0.15.0 building blocks and the ergonomic, fluent, ReAct-integrated experience users expect from a production AI framework.

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

### Patch Changes

- d7dd4f7: Documentation coverage for the 0.16.0 surface — closes the gap between shipped APIs and user-facing docs. No runtime changes; docs and READMEs only.

  - `docs/getting-started.md`: new subsections for `schemaValidator` / `judgeValidator`, `agent.askHuman({ timeout })` method, agent stream event aliases (`token`, `final`, `thinking`, `tool_call` alongside the granular variants), bare-function preconditions, and the `{ prompt }` shorthand in `agent.replayFrom` overrides.
  - `docs/fundamentals.md`: full coverage of `agent.withVerifier` / `withRetryPolicy`, `agent.runResumable` / `resume`, `agent.askHuman({...})` as method, `agent.getTrace` / `listTraces` / `replayFrom`, tool auto-approval gate (`requireApproval`), and the simple stream event aliases mapped against the granular ones.
  - `packages/agents/README.md`: fluent verification row updated to mention `schemaValidator` + `judgeValidator` + `JudgeValidatorOptions`; new `agent.askHuman({...})` row.
  - `packages/tools/README.md`: tool contracts row updated to note bare-function precondition support.
  - `packages/core/README.md`: new rows for `StateStore` + `createInMemoryStateStore`, `AgentPauseSignal` + `pauseAgent`, and the replay primitives moved into core.

- Updated dependencies [6c7de04]
- Updated dependencies [d7dd4f7]
  - @elsium-ai/core@0.16.0

## 0.15.0

### Minor Changes

- 0bfee9e: Add Capability Tokens for Agents (β-1) — Ed25519-signed, scoped, time-bound tokens that gate what an agent run is allowed to do. `createCapabilityIssuer({ signer, orgId })` mints `CapabilityToken`s with capabilities for tools (allow/deny field constraints), LLMs (provider+model whitelist, maxCost/maxTokens), MCP servers (server+tool allowlist), RAG stores (store whitelist, maxResults), and workflows; plus data class allow/deny lists and TTL. `createCapabilityVerifier({ resolver })` validates signature, validity window, and version offline using a `KeyRegistry`. Pure scope checks ship as `canCallTool`, `canCallLLM`, `canQueryRag`, `canUseMcp`, `checkDataClass`, all returning a typed `CapabilityCheckResult` with `reason` codes (`no-matching-capability`, `denied-field`, `allowed-fields-violation`, `denied-data-class`, `budget-exceeded`, `expired`, `not-yet-valid`, `bad-signature`, `unknown-key`, `malformed`). New `withCapability(tool, { token, verifier?, dataClasses?, onDeny? })` in `@elsium-ai/tools` wraps any `Tool` so execution refuses (with a typed denial result + optional `onDeny` callback) when the token does not authorize the call. The token's `Capability` union is exported as `AgentCapability` to avoid colliding with the existing sandbox `Capability` type in tools.
- dcad45e: Close the operational triad (tool contracts → askHuman → replayFrom) as MVP primitives — three independent additions, shipped together because they share the same goal: make agent execution safe to retry, pause, and rewind.

  **Tool contracts (`@elsium-ai/tools`)** — `ToolConfig` now accepts `sideEffectLevel: 'read' | 'write' | 'destructive'`, `idempotencyKey + idempotencyStore` (with `createInMemoryIdempotencyStore` adapter), `preconditions: Array<{ name, check }>`, and `dryRunHandler`. `execute()` honors `ctx.dryRun` (skips write/destructive handlers, returns the dry-run preview with `dryRun: true`), runs all preconditions and aborts with `preconditionFailures` if any fail, and dedupes calls by `idempotencyKey` against the store (cache hit returns `idempotent: true`). `tool.sideEffectLevel` is exposed on the `Tool` for upstream policy code.

  **`askHuman` (`@elsium-ai/agents`)** — standalone `askHuman({ question, options, context?, timeoutMs?, responder? | store?, requestId? })` consolidates the human-in-the-loop pattern. Two modes: a responder callback (Slack/web UI) raced against a setTimeout deadline, or a store-backed durable mode that polls every 250 ms and is completed out-of-band via `resolveAskHuman(store, id, decision)` — when paired with an AsyncAgent task store, the agent state survives a server restart. `timeoutMs` accepts a number or a string ('5s' / '2m' / '1h' / '7d'); bad suffix throws `CONFIG_ERROR`. `onTimeout: 'reject' | 'timeout'` controls the resulting status. Ships with `createInMemoryAskHumanStore` adapter and typed `AskHumanStore` port.

  **`replayFrom` (`@elsium-ai/testing`)** — `createTraceRecorder` captures every agent step (input/output keyed by name, with timing + metadata). `replayFrom(trace, { fromStep, executor, overrides })` re-feeds steps before `fromStep` from the recording and runs `executor` live for the rest. `overrides` accept `{ kind: 'replace', output }` (skip executor entirely) or `{ kind: 'transform', input?, output? }` (rewrite input or post-process output). Each `ReplayedStep` reports `source: 'replay' | 'live'` and `overridden: boolean` so Studio / xray can render a diff.

  Trade-off note: each of the three was scoped to 1–3 weeks individually. Combined into one PR they ship as production-MVP primitives — happy path + obvious edge cases tested, but not battle-hardened the way α/β were. Follow-up PRs should deepen each (richer idempotency cache eviction policies, askHuman over Slack/Discord adapters, replayFrom integration with `defineAgent` so it captures steps automatically).

### Patch Changes

- 409ab6f: Docs round 2 — close documentation gaps for the six MVP features shipped in 0.12.x. Adds full sections to `docs/fundamentals.md` and `docs/getting-started.md` for thinking/reasoning stream events, `withToolTypes` typed tool-call streams, CARG cost-aware routed generation, tool contracts (`sideEffectLevel` + idempotency + preconditions + `dryRunHandler`), `askHuman` durable human-in-the-loop, and `replayFrom` time-travel replay. Extends the relevant package READMEs (`packages/tools`, `packages/agents`, `packages/testing`) with What's-Inside table rows and standalone sections. Adds runnable examples — `examples/carg-cascade/`, `examples/thinking-stream/`, `examples/typed-tool-stream/`, `examples/tool-contracts/`, `examples/ask-human/`, `examples/replay-from/` — and refreshes `examples/README.md` to index them. Docs/examples only; no runtime behavior change.
- Updated dependencies [35bad42]
- Updated dependencies [6a9adac]
- Updated dependencies [409ab6f]
- Updated dependencies [0bfee9e]
- Updated dependencies [11126a4]
- Updated dependencies [ea71268]
- Updated dependencies [09ae00a]
  - @elsium-ai/core@0.15.0

## 0.14.0

### Minor Changes

- b245bf2: Add mode:'process' sandbox runner with child_process.fork for OS-level process isolation

  New `createProcessSandboxRunner` and `mode: 'process'` support in `createSandboxRunner`:

  - Spawns an isolated Node.js child process via `child_process.fork()`
  - IPC-based communication with the sandbox handler
  - Timeout, abort, and dispose semantics matching existing worker runner
  - Handles `process.exit()` in sandbox without affecting the host
  - `unref()` behavior prevents orphan processes
  - `fork-entry.mjs` is bundled into the published package for production use

### Patch Changes

- @elsium-ai/core@0.14.0

## 0.13.0

### Patch Changes

- Fixed-group version bump in lockstep with the 0.13.0 framework release. No source changes in this package.
- Updated dependencies — `@elsium-ai/core`

## 0.12.1

### Patch Changes

- 6a0eb78: Fix two issues found during QA testing of the sandbox feature.

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

  - @elsium-ai/core@0.12.1

## 0.12.0

### Minor Changes

- f37daa1: Add opt-in tool execution sandboxing — closes the gap between the Governance pillar and what tool handlers actually do at runtime.

  **New: `defineTool({ sandbox })` opt-in worker isolation:**

  ```ts
  defineTool({
    name: "fetch_url",
    input: z.object({ url: z.string().url() }),
    sandbox: {
      mode: "worker",
      handler: new URL("./handlers/fetch.js", import.meta.url),
      timeoutMs: 10_000,
      capabilities: ["network"], // declarative in v1
    },
  });
  ```

  Tools without `sandbox` keep their current inline-handler behaviour. **No breaking change for existing callers.**

  **Guarantees enforced today (real, not declared):**

  - Process isolation — handler runs in a Node Worker thread, separate event loop and V8 heap
  - Crash isolation — `process.exit()` or unhandled exception in the handler kills only the worker; host stays alive
  - Closure-state isolation — handler is loaded as a separate module via `await import()`; host module variables and `globalThis` mutations are invisible
  - Timeout enforcement — worker is forcibly terminated when `timeoutMs` elapses; subsequent calls spawn a fresh worker
  - AbortSignal propagation — external abort terminates the worker

  **Declared but not yet enforced (documented gap, v2 follow-up):**

  - `capabilities: ['network', 'fs:read', ...]` — typed metadata only. Real network/filesystem enforcement requires interceptor work over `fetch`/`http`/`https`/`dns`/`fs` and is tracked separately. The fields exist now so callers can audit-log and policy-engine against intent.

  **API additions:**

  - `defineTool` accepts a new optional `sandbox: SandboxConfig` field
  - `Tool` gains an optional `sandbox?: SandboxConfig` field exposing the config
  - `Tool` gains an optional `dispose?(): Promise<void>` method that terminates the sandbox worker
  - New exported types: `Capability`, `SandboxConfig`, `SandboxRunner` (also re-exported from the `elsium-ai` umbrella)

  **Subtle TS change:**

  `ToolConfig.handler` is now typed as **optional** (was required). Existing `defineTool({ ..., handler })` call sites are unaffected. Code that pulls `handler` out of a `ToolConfig` reference and uses it directly without a check will get a TS narrowing error — fix is `if (config.handler) ...`.

  **Documentation:**

  New guide at `docs/guides/tool-sandboxing.md` covering the threat model, lifecycle, TypeScript handler resolution, migration steps for existing inline tools, and an explicit table of "enforced today vs. declared for later".

### Patch Changes

- @elsium-ai/core@0.12.0

## 0.11.0

### Patch Changes

- @elsium-ai/core@0.11.0

## 0.2.1

### Patch Changes

- Fix publish pipeline: resolve `workspace:*` to real versions before npm publish. v0.2.0 shipped with unresolved `workspace:*` dependencies making it uninstallable outside the monorepo.
- Updated dependencies
  - @elsium-ai/core@0.2.1

## 0.2.0

### Minor Changes

- a1af089: Switch build target from `--target bun` to `--target node` for cross-runtime compatibility (Node.js, Bun, Deno). Replace `Bun.serve()` with `@hono/node-server`. Replace `bun-types` with `@types/node`. Remove `priority` field from `ProviderEntry` — array order now determines provider priority.

### Patch Changes

- Updated dependencies [a1af089]
  - @elsium-ai/core@0.2.0

## 0.1.7

### Patch Changes

- e1eccb4: Add README files to all packages for npm listing
- Updated dependencies [e1eccb4]
  - @elsium-ai/core@0.1.7
