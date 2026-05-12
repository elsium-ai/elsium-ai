# @elsium-ai/gateway

## 0.13.0

### Minor Changes

- Add declarative `RoutingPolicy` (R3): `createDeclarativeRouter` over a `RoutingPolicy` data shape with SLO eligibility (`maxLatencyMs`, `maxCost`, `requireCapabilities`). Reuses `evaluateCondition` from `@elsium-ai/core` so the same eight-operator vocabulary drives both authorization and routing decisions. Composes with the existing provider mesh executor.
- Add PII classification + jurisdiction routing (G5): `createPiiClassifier` with built-in patterns for email / phone / ssn / credit_card / passport / ip_address plus user-registrable custom classes; `createJurisdictionRouter` with class → providers intersection semantics and `'*'` fallback. Class-to-providers mapping is the user's regulatory call — the framework provides the engine, not the rules.
- Add per-agent fair queuing (R6): `createFairQueue` token-bucket rate limiter with per-agent overrides, pluggable `identifyAgent`, configurable timeout behavior (`throw` / `proceed`). In-process only; distributed fairness across instances is explicitly out of scope.

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
