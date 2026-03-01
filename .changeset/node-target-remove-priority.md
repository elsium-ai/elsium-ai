---
"@elsium-ai/core": minor
"@elsium-ai/gateway": minor
"@elsium-ai/agents": minor
"@elsium-ai/tools": minor
"@elsium-ai/workflows": minor
"@elsium-ai/observe": minor
"@elsium-ai/rag": minor
"@elsium-ai/testing": minor
"@elsium-ai/app": minor
"@elsium-ai/cli": minor
"@elsium-ai/mcp": minor
"elsium-ai": minor
---

Switch build target from `--target bun` to `--target node` for cross-runtime compatibility (Node.js, Bun, Deno). Replace `Bun.serve()` with `@hono/node-server`. Replace `bun-types` with `@types/node`. Remove `priority` field from `ProviderEntry` — array order now determines provider priority.
