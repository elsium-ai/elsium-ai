# elsium-ai

## 0.2.1

### Patch Changes

- Fix publish pipeline: resolve `workspace:*` to real versions before npm publish. v0.2.0 shipped with unresolved `workspace:*` dependencies making it uninstallable outside the monorepo.
- Updated dependencies
  - @elsium-ai/core@0.2.1
  - @elsium-ai/gateway@0.2.1
  - @elsium-ai/agents@0.2.1
  - @elsium-ai/tools@0.2.1
  - @elsium-ai/workflows@0.2.1
  - @elsium-ai/observe@0.2.1
  - @elsium-ai/rag@0.2.1
  - @elsium-ai/testing@0.2.1
  - @elsium-ai/app@0.2.1
  - @elsium-ai/mcp@0.2.1

## 0.2.0

### Minor Changes

- a1af089: Switch build target from `--target bun` to `--target node` for cross-runtime compatibility (Node.js, Bun, Deno). Replace `Bun.serve()` with `@hono/node-server`. Replace `bun-types` with `@types/node`. Remove `priority` field from `ProviderEntry` — array order now determines provider priority.

### Patch Changes

- Updated dependencies [a1af089]
  - @elsium-ai/core@0.2.0
  - @elsium-ai/gateway@0.2.0
  - @elsium-ai/agents@0.2.0
  - @elsium-ai/tools@0.2.0
  - @elsium-ai/workflows@0.2.0
  - @elsium-ai/observe@0.2.0
  - @elsium-ai/rag@0.2.0
  - @elsium-ai/testing@0.2.0
  - @elsium-ai/app@0.2.0
  - @elsium-ai/mcp@0.2.0

## 0.1.7

### Patch Changes

- e1eccb4: Add README files to all packages for npm listing
- Updated dependencies [e1eccb4]
  - @elsium-ai/core@0.1.7
  - @elsium-ai/gateway@0.1.7
  - @elsium-ai/agents@0.1.7
  - @elsium-ai/tools@0.1.7
  - @elsium-ai/rag@0.1.7
  - @elsium-ai/workflows@0.1.7
  - @elsium-ai/observe@0.1.7
  - @elsium-ai/mcp@0.1.7
  - @elsium-ai/app@0.1.7
  - @elsium-ai/testing@0.1.7
