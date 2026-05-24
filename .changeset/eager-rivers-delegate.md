---
'@elsium-ai/core': minor
'@elsium-ai/gateway': minor
'@elsium-ai/mcp': minor
'@elsium-ai/rag': minor
---

Add Capability Tokens β-2 — delegation, revocation, and guards for LLM/MCP/RAG. `CapabilityIssuer.delegate(parent, opts)` mints child tokens whose capabilities are a strict subset of the parent (tool deniedFields inherited, LLM maxCost/maxTokens ≤ parent, MCP tool allowlists ⊆ parent, budgets shrink, denied data classes propagate, expiresAt ≤ parent). New `RevocationStore` port with an in-memory adapter; `createCapabilityVerifier({ revocationStore })` plus `verifyTokenAsync` consult it and return `reason: 'revoked'`. New guards complete the surface: `capabilityMiddleware(opts)` in `@elsium-ai/gateway` gates LLM completions and applies the cost budget at request time using `calculateCost`; `createCapabilityGuardedMCPClient(client, opts)` in `@elsium-ai/mcp` gates `callTool` against the token's MCP allowlist; `withRagCapability(pipeline, opts)` in `@elsium-ai/rag` gates queries against allowed stores and `maxResults`. All wrappers accept `{ token, verifier?, onDeny? }`; denials surface as typed events through `onDeny` and either throw `ElsiumError` (LLM/MCP/RAG) or return `ToolExecutionResult { success: false }` (tools).
