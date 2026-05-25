# @elsium-ai/rag

## 0.16.1

### Patch Changes

- @elsium-ai/core@0.16.1

## 0.16.0

### Patch Changes

- Updated dependencies [6c7de04]
- Updated dependencies [d7dd4f7]
  - @elsium-ai/core@0.16.0

## 0.15.0

### Minor Changes

- 6a9adac: Add Capability Tokens β-2 — delegation, revocation, and guards for LLM/MCP/RAG. `CapabilityIssuer.delegate(parent, opts)` mints child tokens whose capabilities are a strict subset of the parent (tool deniedFields inherited, LLM maxCost/maxTokens ≤ parent, MCP tool allowlists ⊆ parent, budgets shrink, denied data classes propagate, expiresAt ≤ parent). New `RevocationStore` port with an in-memory adapter; `createCapabilityVerifier({ revocationStore })` plus `verifyTokenAsync` consult it and return `reason: 'revoked'`. New guards complete the surface: `capabilityMiddleware(opts)` in `@elsium-ai/gateway` gates LLM completions and applies the cost budget at request time using `calculateCost`; `createCapabilityGuardedMCPClient(client, opts)` in `@elsium-ai/mcp` gates `callTool` against the token's MCP allowlist; `withRagCapability(pipeline, opts)` in `@elsium-ai/rag` gates queries against allowed stores and `maxResults`. All wrappers accept `{ token, verifier?, onDeny? }`; denials surface as typed events through `onDeny` and either throw `ElsiumError` (LLM/MCP/RAG) or return `ToolExecutionResult { success: false }` (tools).

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

### Patch Changes

- Fixed-group version bump in lockstep with the 0.13.0 framework release. No source changes in this package.
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
