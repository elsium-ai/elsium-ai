# @elsium-ai/workflows

## 0.16.0

### Patch Changes

- Updated dependencies [6c7de04]
- Updated dependencies [d7dd4f7]
  - @elsium-ai/core@0.16.0

## 0.15.0

### Patch Changes

- Updated dependencies [35bad42]
- Updated dependencies [6a9adac]
- Updated dependencies [409ab6f]
- Updated dependencies [0bfee9e]
- Updated dependencies [11126a4]
- Updated dependencies [ea71268]
- Updated dependencies [09ae00a]
  - @elsium-ai/core@0.15.0

## 0.14.0

### Patch Changes

- @elsium-ai/core@0.14.0

## 0.13.0

### Minor Changes

- Add `IdempotentCheckpointStore` (R1): extends `CheckpointStore` with `getStepResult` / `recordStepResult` / `listStepHistory`, keyed by `(workflowId, stepName, idempotencyKey)`. Ships only the in-memory adapter (`createInMemoryIdempotentCheckpointStore`); persistent adapters are the user's call. `executeIdempotentStep` checks the store before invoking the step handler so side-effectful steps (POST to external APIs, DB writes, email sends) no longer re-run when a workflow resumes from a checkpoint after a crash. Failures are cached and replayed verbatim.
- New `IdempotentStepConfig<TInput, TOutput>` extension with `idempotent: true` opt-in and optional `idempotencyKey: (input) => string` (defaults to a stable SHA-256 over the input JSON).

### Breaking Changes

- `defaultIdempotencyKey(input)` is now async (`Promise<string>`).
- `resolveIdempotencyKey(step, input)` is now async (`Promise<string | null>`).
- Migration: `await defaultIdempotencyKey(input)`; `await resolveIdempotencyKey(step, input)`. Reason: backed by Web Crypto SHA-256 to support edge runtimes. Closes #41 for this module. `executeIdempotentStep` was already async — no callsite change there.

### Patch Changes

- Updated dependencies — `@elsium-ai/core`

## 0.12.1

### Patch Changes

- @elsium-ai/core@0.12.1

## 0.12.0

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
