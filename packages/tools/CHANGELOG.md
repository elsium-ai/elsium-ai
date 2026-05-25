# @elsium-ai/tools

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
