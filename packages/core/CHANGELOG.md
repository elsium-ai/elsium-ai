# @elsium-ai/core

## 0.15.0

### Minor Changes

- 35bad42: Add `withToolTypes(stream, schemas)` — a stream wrapper that accumulates the raw `tool_call_delta` JSON fragments per `toolCallId`, parses + validates them against a per-tool Zod schema on `tool_call_end`, and emits a new typed `tool_call_complete` event whose `toolCall.arguments` is narrowed by the tool name. The wrapper closes the second half of the "streaming estructurado tipado" critical (Fase B of #2): callers branch on `event.toolCall.name` and get full Zod inference for the arguments per branch. On parse failure (invalid JSON or schema mismatch), an `UnknownToolCallComplete` variant is emitted with `parseError.{ reason, raw }` so callers can branch. The original `StreamEvent` union is unchanged — this is purely additive and opt-in. Lives in `@elsium-ai/core` so any package (gateway, agents, app) can use it.
- 6a9adac: Add Capability Tokens β-2 — delegation, revocation, and guards for LLM/MCP/RAG. `CapabilityIssuer.delegate(parent, opts)` mints child tokens whose capabilities are a strict subset of the parent (tool deniedFields inherited, LLM maxCost/maxTokens ≤ parent, MCP tool allowlists ⊆ parent, budgets shrink, denied data classes propagate, expiresAt ≤ parent). New `RevocationStore` port with an in-memory adapter; `createCapabilityVerifier({ revocationStore })` plus `verifyTokenAsync` consult it and return `reason: 'revoked'`. New guards complete the surface: `capabilityMiddleware(opts)` in `@elsium-ai/gateway` gates LLM completions and applies the cost budget at request time using `calculateCost`; `createCapabilityGuardedMCPClient(client, opts)` in `@elsium-ai/mcp` gates `callTool` against the token's MCP allowlist; `withRagCapability(pipeline, opts)` in `@elsium-ai/rag` gates queries against allowed stores and `maxResults`. All wrappers accept `{ token, verifier?, onDeny? }`; denials surface as typed events through `onDeny` and either throw `ElsiumError` (LLM/MCP/RAG) or return `ToolExecutionResult { success: false }` (tools).
- 0bfee9e: Add Capability Tokens for Agents (β-1) — Ed25519-signed, scoped, time-bound tokens that gate what an agent run is allowed to do. `createCapabilityIssuer({ signer, orgId })` mints `CapabilityToken`s with capabilities for tools (allow/deny field constraints), LLMs (provider+model whitelist, maxCost/maxTokens), MCP servers (server+tool allowlist), RAG stores (store whitelist, maxResults), and workflows; plus data class allow/deny lists and TTL. `createCapabilityVerifier({ resolver })` validates signature, validity window, and version offline using a `KeyRegistry`. Pure scope checks ship as `canCallTool`, `canCallLLM`, `canQueryRag`, `canUseMcp`, `checkDataClass`, all returning a typed `CapabilityCheckResult` with `reason` codes (`no-matching-capability`, `denied-field`, `allowed-fields-violation`, `denied-data-class`, `budget-exceeded`, `expired`, `not-yet-valid`, `bad-signature`, `unknown-key`, `malformed`). New `withCapability(tool, { token, verifier?, dataClasses?, onDeny? })` in `@elsium-ai/tools` wraps any `Tool` so execution refuses (with a typed denial result + optional `onDeny` callback) when the token does not authorize the call. The token's `Capability` union is exported as `AgentCapability` to avoid colliding with the existing sandbox `Capability` type in tools.
- ea71268: Add typed thinking / reasoning stream events. The `StreamEvent` discriminated union now includes `thinking_start`, `thinking_delta` (with `text`), and `thinking_end`, so consumers narrow on `event.type` and get full autocompletion for the model's internal reasoning the same way they already do for `text_delta` and `tool_call_*`. `TokenUsage` gains `reasoningTokens?` for OpenAI o-series billing visibility. `CompletionRequest` gains a `thinking?: { enabled?, budgetTokens?, effort? }` config that the Anthropic provider translates to `thinking: { type: 'enabled', budget_tokens }` (deriving the budget from `effort: 'low' | 'medium' | 'high'` when `budgetTokens` is omitted), and the OpenAI provider translates to `reasoning_effort`. The Anthropic stream parser maps the `content_block_start/delta/stop` events whose blocks are of type `thinking` into the new typed events; the OpenAI stream parser captures `completion_tokens_details.reasoning_tokens` into `state.usage.reasoningTokens` so the final `message_end` event surfaces it. Documented in the gateway README with a full event table.
- 09ae00a: Add a low-level cryptographic foundation under `@elsium-ai/core/crypto`: Ed25519 `Signer`/`Verifier` using `node:crypto` with PKCS#8 PEM input and base64url signatures; `KeyRegistry` with named keys, validity windows, prototype-pollution-safe `keyId` validation, and an injectable clock; `WriteOnceStore` port with in-memory and file-system adapters (the file adapter uses `O_EXCL` for atomic write-once semantics, throwing `WriteOnceConflictError` on duplicates). These primitives are the substrate for upcoming verifiable agent execution (signed proofs) and capability tokens.

### Patch Changes

- 409ab6f: Docs round 2 — close documentation gaps for the six MVP features shipped in 0.12.x. Adds full sections to `docs/fundamentals.md` and `docs/getting-started.md` for thinking/reasoning stream events, `withToolTypes` typed tool-call streams, CARG cost-aware routed generation, tool contracts (`sideEffectLevel` + idempotency + preconditions + `dryRunHandler`), `askHuman` durable human-in-the-loop, and `replayFrom` time-travel replay. Extends the relevant package READMEs (`packages/tools`, `packages/agents`, `packages/testing`) with What's-Inside table rows and standalone sections. Adds runnable examples — `examples/carg-cascade/`, `examples/thinking-stream/`, `examples/typed-tool-stream/`, `examples/tool-contracts/`, `examples/ask-human/`, `examples/replay-from/` — and refreshes `examples/README.md` to index them. Docs/examples only; no runtime behavior change.
- 11126a4: zodToJsonSchema: ZodDefault now emits the default value in JSON Schema output (e.g. `{ type: 'string', default: 'hello' }`) instead of omitting it. This makes default values visible to LLM tool-calling schemas.

## 0.14.0

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
