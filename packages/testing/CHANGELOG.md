# @elsium-ai/testing

## 0.17.0

### Minor Changes

- ef5a689: Add governed, reproducible, auditable evaluation to `@elsium-ai/testing` — evals as proof, not opinion.

  - **Eval attestation** — `attestEvalSuite`, `verifyEvalAttestation`, `formatAttestation`. Produces a signed, hash-chained (HMAC-SHA256) record of an eval run that anyone can verify independently with the shared secret. Records store only the SHA-256 **hashes** of inputs/outputs, so an attestation is shareable as audit evidence without leaking the underlying data, yet provable against the originals. The header (suite, metadata, summary, embedded governance verdict) seeds a genesis signature and each case record chains over the previous one; any tampered record, reordered entry, or swapped metadata field detaches the chain and is pinpointed by `invalidAtIndex`. Reuses the same hash-chain primitives as signed replay.
  - **Eval-as-policy gates** — `runEvalGate`, `toAttestedGovernance`. Turns eval results into governance verdicts wired to the `@elsium-ai/core` policy engine (`PolicySet` denials become violations) and/or custom `GovernanceAssertion`s. A failed gate can be flipped to passed with a recorded sign-off `override` (`{ approver, reason }`), and that verdict can be sealed into the attestation chain.
  - **Compliance mapping** — `buildEvalComplianceReport`, `formatEvalComplianceReport`. Assertions carry regulatory `controls` (e.g. `eu-ai-act:art-10`, `nist-ai-rmf:measure-2.7`); the report aggregates pass/fail per control and flags unmapped violations.

  All additive, re-exported from the `elsium-ai` umbrella. No existing types or APIs change. The package stays backend-agnostic — the attestation secret and approver identity are caller-supplied, with no coupling to a DB, RBAC layer, or cloud service.

- ef5a689: Add three evaluation capabilities to `@elsium-ai/testing`, closing the gaps between the existing reference-free assertions and a full eval stack.

  - **Classification metrics** — `runClassificationEval`, `computeClassificationReport`, `computeConfusionMatrix`, `formatClassificationReport`, `formatConfusionMatrix`. Score categorical outputs against labeled ground truth with precision / recall / F1 (per-label plus macro / micro / weighted averages), accuracy, and a confusion matrix. All divisions are zero-safe.
  - **RAG eval (RAGAS-style)** — `runRagEval`, `faithfulness`, `answerRelevancy`, `contextPrecision`, `contextRecall`, `formatRagEvalReport`. Judge-based groundedness metrics combine with deterministic, reference-based retrieval precision / recall. Judge and reference metrics are independently optional per case.
  - **Structured rubric LLM-as-a-judge** — `createRubricJudge`. Define a weighted multi-criterion rubric; the judge prompts for a per-criterion JSON score, parses it robustly (returning `score: 0` with a diagnostic reason on malformed output instead of throwing), and returns a normalized weighted score with a per-criterion breakdown. The result is a drop-in `LLMJudge`, usable directly in an `llm_judge` eval criterion. `generate` is any `(prompt) => Promise<string>`, keeping the judge backend-agnostic.

  All additions are re-exported from the `elsium-ai` umbrella package. No existing types or APIs change.

### Patch Changes

- Updated dependencies [662d64c]
  - @elsium-ai/tools@0.17.0
  - @elsium-ai/agents@0.17.0
  - @elsium-ai/core@0.17.0
  - @elsium-ai/gateway@0.17.0

## 0.16.1

### Patch Changes

- Updated dependencies [c51a981]
  - @elsium-ai/agents@0.16.1
  - @elsium-ai/core@0.16.1
  - @elsium-ai/gateway@0.16.1
  - @elsium-ai/tools@0.16.1

## 0.16.0

### Patch Changes

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

- Updated dependencies [6c7de04]
- Updated dependencies [d7dd4f7]
  - @elsium-ai/core@0.16.0
  - @elsium-ai/tools@0.16.0
  - @elsium-ai/agents@0.16.0
  - @elsium-ai/gateway@0.16.0

## 0.15.0

### Minor Changes

- dcad45e: Close the operational triad (tool contracts → askHuman → replayFrom) as MVP primitives — three independent additions, shipped together because they share the same goal: make agent execution safe to retry, pause, and rewind.

  **Tool contracts (`@elsium-ai/tools`)** — `ToolConfig` now accepts `sideEffectLevel: 'read' | 'write' | 'destructive'`, `idempotencyKey + idempotencyStore` (with `createInMemoryIdempotencyStore` adapter), `preconditions: Array<{ name, check }>`, and `dryRunHandler`. `execute()` honors `ctx.dryRun` (skips write/destructive handlers, returns the dry-run preview with `dryRun: true`), runs all preconditions and aborts with `preconditionFailures` if any fail, and dedupes calls by `idempotencyKey` against the store (cache hit returns `idempotent: true`). `tool.sideEffectLevel` is exposed on the `Tool` for upstream policy code.

  **`askHuman` (`@elsium-ai/agents`)** — standalone `askHuman({ question, options, context?, timeoutMs?, responder? | store?, requestId? })` consolidates the human-in-the-loop pattern. Two modes: a responder callback (Slack/web UI) raced against a setTimeout deadline, or a store-backed durable mode that polls every 250 ms and is completed out-of-band via `resolveAskHuman(store, id, decision)` — when paired with an AsyncAgent task store, the agent state survives a server restart. `timeoutMs` accepts a number or a string ('5s' / '2m' / '1h' / '7d'); bad suffix throws `CONFIG_ERROR`. `onTimeout: 'reject' | 'timeout'` controls the resulting status. Ships with `createInMemoryAskHumanStore` adapter and typed `AskHumanStore` port.

  **`replayFrom` (`@elsium-ai/testing`)** — `createTraceRecorder` captures every agent step (input/output keyed by name, with timing + metadata). `replayFrom(trace, { fromStep, executor, overrides })` re-feeds steps before `fromStep` from the recording and runs `executor` live for the rest. `overrides` accept `{ kind: 'replace', output }` (skip executor entirely) or `{ kind: 'transform', input?, output? }` (rewrite input or post-process output). Each `ReplayedStep` reports `source: 'replay' | 'live'` and `overridden: boolean` so Studio / xray can render a diff.

  Trade-off note: each of the three was scoped to 1–3 weeks individually. Combined into one PR they ship as production-MVP primitives — happy path + obvious edge cases tested, but not battle-hardened the way α/β were. Follow-up PRs should deepen each (richer idempotency cache eviction policies, askHuman over Slack/Discord adapters, replayFrom integration with `defineAgent` so it captures steps automatically).

### Patch Changes

- 409ab6f: Docs round 2 — close documentation gaps for the six MVP features shipped in 0.12.x. Adds full sections to `docs/fundamentals.md` and `docs/getting-started.md` for thinking/reasoning stream events, `withToolTypes` typed tool-call streams, CARG cost-aware routed generation, tool contracts (`sideEffectLevel` + idempotency + preconditions + `dryRunHandler`), `askHuman` durable human-in-the-loop, and `replayFrom` time-travel replay. Extends the relevant package READMEs (`packages/tools`, `packages/agents`, `packages/testing`) with What's-Inside table rows and standalone sections. Adds runnable examples — `examples/carg-cascade/`, `examples/thinking-stream/`, `examples/typed-tool-stream/`, `examples/tool-contracts/`, `examples/ask-human/`, `examples/replay-from/` — and refreshes `examples/README.md` to index them. Docs/examples only; no runtime behavior change.
- Updated dependencies [9061574]
- Updated dependencies [35bad42]
- Updated dependencies [2445e26]
- Updated dependencies [6a9adac]
- Updated dependencies [a46946f]
- Updated dependencies [409ab6f]
- Updated dependencies [0bfee9e]
- Updated dependencies [61be1c2]
- Updated dependencies [dcad45e]
- Updated dependencies [11126a4]
- Updated dependencies [ea71268]
- Updated dependencies [33c71e1]
- Updated dependencies [09ae00a]
  - @elsium-ai/agents@0.15.0
  - @elsium-ai/core@0.15.0
  - @elsium-ai/gateway@0.15.0
  - @elsium-ai/tools@0.15.0

## 0.14.0

### Patch Changes

- Updated dependencies [b245bf2]
  - @elsium-ai/tools@0.14.0
  - @elsium-ai/agents@0.14.0
  - @elsium-ai/core@0.14.0
  - @elsium-ai/gateway@0.14.0

## 0.13.0

### Minor Changes

- Add audit-grade signed replay (R5): `createSignedReplayRecorder`, `createSignedReplayPlayer`, `verifyReplay` with an HMAC-SHA256 hash chain over recorded entries. Same chain pattern as `audit.ts`. Tamper detection (mutated request, reordered entries, wrong secret) returns the exact `invalidAtIndex`. Minimum 16-char secret enforced. Strict mode default.
- Add streaming replay: `createStreamReplayRecorder` and `createStreamReplayPlayer` for `AsyncIterable<StreamEvent>` sequences. Tests dependent on token-level streaming behavior become deterministic.
- Add per-case regression budgets (O3): `createBudgetedRegressionSuite` with `tolerance` + `maxDelta` per case. Refined outcomes — `unchanged` / `improved` / `regression` / `critical`. Tags for grouped reporting. The legacy `createRegressionSuite` with hardcoded 0.1 threshold continues to work.
- Add trace replay with variable substitution (O4): `applyOverride` + `replayWithOverride` answer "what if this prompt ran on a different model / temperature / system?" against a recorded set of inputs. Side-by-side per-entry deltas (tokens, cost, latency, contentChanged) and aggregated totals.
- Add hash-based replay matching to `createReplayPlayer` via `strategy: 'sequential' | 'hash'` option. Order-independent replay for tests where call ordering varies.

### Breaking Changes

- `verifyReplay(file, secret)` is now async (`Promise<ReplayVerification>`).
- `createSignedReplayPlayer(file, options)` is now async (`Promise<SignedReplayPlayer>`).
- Migration: `await verifyReplay(file, secret)`; `const player = await createSignedReplayPlayer(file, opts)`. Reason: Web Crypto `subtle.sign` is async. Closes #41 for this module.

### Patch Changes

- Updated dependencies — `@elsium-ai/core`, `@elsium-ai/agents`, `@elsium-ai/gateway`, `@elsium-ai/tools`

## 0.12.1

### Patch Changes

- Updated dependencies [6a0eb78]
  - @elsium-ai/tools@0.12.1
  - @elsium-ai/agents@0.12.1
  - @elsium-ai/core@0.12.1
  - @elsium-ai/gateway@0.12.1

## 0.12.0

### Patch Changes

- Updated dependencies [c7c5492]
- Updated dependencies [f37daa1]
  - @elsium-ai/agents@0.12.0
  - @elsium-ai/tools@0.12.0
  - @elsium-ai/core@0.12.0
  - @elsium-ai/gateway@0.12.0

## 0.11.0

### Patch Changes

- Updated dependencies [a1bbd80]
  - @elsium-ai/agents@0.11.0
  - @elsium-ai/core@0.11.0
  - @elsium-ai/gateway@0.11.0
  - @elsium-ai/tools@0.11.0

## 0.2.1

### Patch Changes

- Fix publish pipeline: resolve `workspace:*` to real versions before npm publish. v0.2.0 shipped with unresolved `workspace:*` dependencies making it uninstallable outside the monorepo.
- Updated dependencies
  - @elsium-ai/core@0.2.1
  - @elsium-ai/gateway@0.2.1
  - @elsium-ai/agents@0.2.1
  - @elsium-ai/tools@0.2.1

## 0.2.0

### Minor Changes

- a1af089: Switch build target from `--target bun` to `--target node` for cross-runtime compatibility (Node.js, Bun, Deno). Replace `Bun.serve()` with `@hono/node-server`. Replace `bun-types` with `@types/node`. Remove `priority` field from `ProviderEntry` — array order now determines provider priority.

### Patch Changes

- Updated dependencies [a1af089]
  - @elsium-ai/core@0.2.0
  - @elsium-ai/gateway@0.2.0
  - @elsium-ai/agents@0.2.0
  - @elsium-ai/tools@0.2.0

## 0.1.7

### Patch Changes

- e1eccb4: Add README files to all packages for npm listing
- Updated dependencies [e1eccb4]
  - @elsium-ai/core@0.1.7
  - @elsium-ai/gateway@0.1.7
  - @elsium-ai/agents@0.1.7
  - @elsium-ai/tools@0.1.7
