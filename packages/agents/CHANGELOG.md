# @elsium-ai/agents

## 0.12.0

### Patch Changes

- c7c5492: Fix concurrent-save race in `createJsonFileTaskStore` shipped in 0.11.0.

  **The bug:** `save()` used a fixed temp filename per task id (`<id>.json.tmp`). When multiple `save()` calls for the same id ran concurrently, they all wrote to the same `.tmp` file; the first `rename()` consumed it; subsequent renames failed with `ENOENT`. The 0.11.0 release notes for `createAsyncAgent({ taskStore })` advertised "fire-and-forget" persistence of every status transition (`pending → running → completed`), which fires the saves concurrently — so this bug would silently fail to persist task state in production.

  Reproduction (pre-fix): three concurrent same-id saves → two rejected with `ENOENT rename ...`, only one survives, last-write-wins is broken because the surviving file was the _first_ save's content, not the last submitted.

  **The fix:** added a per-id write lock (a `Map<string, Promise<unknown>>` keyed by task id) that serializes `save` and `delete` operations for the same id. Distinct ids still execute in parallel — there's no false serialization.

  The pattern mirrors the write-lock already used by `createJsonlSink` in `@elsium-ai/observe`, but per-id instead of global so the store doesn't bottleneck on unrelated tasks.

  **No API change.** Existing `createJsonFileTaskStore` callers and `createAsyncAgent({ taskStore })` consumers don't need to change anything.

  **Tests:** 4 new regression tests covering the exact same-id concurrent-save scenario, a 25-call high-concurrency burst, mixed save+delete on the same id, and verification that distinct ids do not block each other.

- Updated dependencies [f37daa1]
  - @elsium-ai/tools@0.12.0
  - @elsium-ai/core@0.12.0
  - @elsium-ai/gateway@0.12.0
  - @elsium-ai/observe@0.12.0

## 0.11.0

### Minor Changes

- a1bbd80: Critical durability fixes for production claims, plus security dependency updates.

  **`@elsium-ai/observe` — durable JSONL audit sink (G3):**

  - Add `createJsonlSink({ path, fsync })` — append-only file sink with fsync-per-batch and a write lock to prevent line interleaving under concurrent dispatch. Closes the gap where the README's "tamper-proof" hash-chained audit could lose events on crash because no existing sink (webhook, splunk, datadog) provided atomic-append durability.

  **`@elsium-ai/agents` — `AsyncAgent` durability via opt-in `taskStore` (G2):**

  - Add new `TaskStore` interface plus two implementations: `createInMemoryTaskStore` (default behaviour, no change for existing callers) and `createJsonFileTaskStore({ dir })` (durable, atomic write-tmp+rename, path-traversal guarded).
  - `createAsyncAgent({ taskStore })` now persists every status transition (pending/running/completed/failed/cancelled) fire-and-forget when a store is provided. Without `taskStore`, behaviour is unchanged.
  - New `AsyncAgent.recover(): Promise<PersistedTask[]>` — loads tasks left in pending/running state from a prior process, marks them failed in the store with a "Process restart" reason, and returns them so the operator can decide whether to resubmit. Brings async agents to parity with `defineResumableWorkflow`.
  - Note: `AsyncAgent.recover()` is a new required method on the `AsyncAgent` interface. Mocks of this interface in TS test code need to add `async recover() { return [] }` to keep compiling. No runtime breakage.

  **`@elsium-ai/app` — security update:**

  - Bump `hono` to `^4.12.18` to pick up fixes for GHSA-458j-xx4x-4375 (JSX attribute HTML injection), GHSA-9vqf-7f2p-gf9v (bodyLimit bypass on chunked requests), and GHSA-69xw-7hcm-h432 (unvalidated JSX tag names).

  **`elsium-ai` umbrella:**

  - Re-exports the new sink and task-store APIs.

  **README — honest reproducibility scope (G4):**

  - Soften the "Reproducible AI" pillar to reflect what `seed` actually delivers against hosted providers: forwarded where supported (OpenAI, Google), absent on Anthropic; OpenAI's `system_fingerprint` rotation breaks bit-exactness across deploys; `assertDeterministic` measures variance, it does not enforce it. New "Reproducibility caveats" callout points users at `mockProvider` / replay fixtures for true bit-exact testing.

### Patch Changes

- Updated dependencies [a1bbd80]
  - @elsium-ai/observe@0.11.0
  - @elsium-ai/core@0.11.0
  - @elsium-ai/gateway@0.11.0
  - @elsium-ai/tools@0.11.0

## 0.2.1

### Patch Changes

- Fix publish pipeline: resolve `workspace:*` to real versions before npm publish. v0.2.0 shipped with unresolved `workspace:*` dependencies making it uninstallable outside the monorepo.
- Updated dependencies
  - @elsium-ai/core@0.2.1
  - @elsium-ai/tools@0.2.1
  - @elsium-ai/observe@0.2.1

## 0.2.0

### Minor Changes

- a1af089: Switch build target from `--target bun` to `--target node` for cross-runtime compatibility (Node.js, Bun, Deno). Replace `Bun.serve()` with `@hono/node-server`. Replace `bun-types` with `@types/node`. Remove `priority` field from `ProviderEntry` — array order now determines provider priority.

### Patch Changes

- Updated dependencies [a1af089]
  - @elsium-ai/core@0.2.0
  - @elsium-ai/tools@0.2.0
  - @elsium-ai/observe@0.2.0

## 0.1.7

### Patch Changes

- e1eccb4: Add README files to all packages for npm listing
- Updated dependencies [e1eccb4]
  - @elsium-ai/core@0.1.7
  - @elsium-ai/tools@0.1.7
  - @elsium-ai/observe@0.1.7
