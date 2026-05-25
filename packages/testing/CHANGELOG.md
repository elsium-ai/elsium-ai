# @elsium-ai/testing

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
