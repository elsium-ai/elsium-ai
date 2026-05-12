# @elsium-ai/core

## 0.13.0

### Minor Changes

- Add Web Crypto utility module (`web-crypto.ts`) exposing `sha256Hex`, `hmacSha256Hex`, `randomHexString`, `timingSafeEqualHex`, `timingSafeEqualString`. Cross-runtime primitives backed by `globalThis.crypto`; zero `node:crypto` dependency. Used by the governance pillar (audit, identity, integrity, signed replay, idempotent checkpoints) to unlock edge runtime support — Cloudflare Workers, Vercel Edge, Deno Deploy, browsers. Closes #41.
- Add declarative policy engine (G3): `PolicyDocument`, `PolicyBundle`, `createBuiltinEvaluator`, `createDeclarativePolicySet`, `declarativePolicyMiddleware`, `verifyBundle`, `evaluateCondition`. Eight condition operators (`eq` / `ne` / `gt` / `lt` / `gte` / `lte` / `in` / `matches`). Strategy port `PolicyEvaluator` is swappable — ADR-0002 picked the built-in TypeScript evaluator over Cedar WASM.

### Patch Changes

- `generateId` and `generateTraceId` migrated internally from `node:crypto.randomBytes` to `globalThis.crypto.getRandomValues`. Same sync signature, no breaking change. Enables edge-runtime support throughout the framework.

## 0.12.1

## 0.12.0

## 0.11.0

## 0.2.1

### Patch Changes

- Fix publish pipeline: resolve `workspace:*` to real versions before npm publish. v0.2.0 shipped with unresolved `workspace:*` dependencies making it uninstallable outside the monorepo.

## 0.2.0

### Minor Changes

- a1af089: Switch build target from `--target bun` to `--target node` for cross-runtime compatibility (Node.js, Bun, Deno). Replace `Bun.serve()` with `@hono/node-server`. Replace `bun-types` with `@types/node`. Remove `priority` field from `ProviderEntry` — array order now determines provider priority.

## 0.1.7

### Patch Changes

- e1eccb4: Add README files to all packages for npm listing
