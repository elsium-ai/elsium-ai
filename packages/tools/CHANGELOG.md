# @elsium-ai/tools

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
