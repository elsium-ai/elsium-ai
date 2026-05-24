# Capability Tokens — OAuth-style scoped tokens for AI agents

Mint a signed token that declares exactly which **tools**, **LLM providers**, **MCP servers**, **RAG stores**, and **data classes** an agent run is allowed to touch. Every guarded execution point verifies the token before doing work — signature + validity window + scope check.

## What this example shows

- **Mint** a token from an organization issuer (Ed25519).
- **Gate a tool**: `withCapability(tool, { token })` refuses execution outside the token's scope.
- **Gate an LLM call**: `capabilityMiddleware({ token })` rejects when the token's LLM capability doesn't cover the request.
- **Delegate** a strict-subset child token (cheaper budget, narrower scope).
- **Revoke** a token and watch the verifier reject it on the next async check.

## Run

```bash
bun examples/capability-tokens/index.ts
```

No API key required — uses mock providers to keep the example deterministic.

## API surface used

| Surface | Wrapper | Refusal mode |
|---|---|---|
| Tools | `withCapability(tool, opts)` | Returns `ToolExecutionResult { success: false }` |
| Gateway LLM | `capabilityMiddleware(opts)` | Throws `ElsiumError(AUTH_ERROR)` |
| MCP | `createCapabilityGuardedMCPClient(client, opts)` | Throws `ElsiumError(AUTH_ERROR)` (only `callTool` is gated) |
| RAG | `withRagCapability(pipeline, opts)` | Throws `ElsiumError(AUTH_ERROR)` (only `query` is gated) |

All four wrappers accept `{ token, verifier?, onDeny? }`.
