# @elsium-ai/testing

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
