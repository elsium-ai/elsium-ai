# @elsium-ai/gateway

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
- a46946f: Add Cost-Aware Routed Generation (CARG) — an opt-in cascade router that routes to the cheapest tier first and escalates on provider error, validator failure, or low confidence. `createCascadeRouter({ tiers, classifier?, escalateOnFailure?, onAudit? }, { apiKeys? | makeGateway? })` takes an ordered list of `Tier`s (`name`, `provider`, `model`, optional `maxDifficulty`) and runs through them in order. Two built-in classifiers: `createHeuristicClassifier()` (zero-cost, keyword + size scoring) and `createLLMClassifier({ complete, model? })` (asks a cheap model to classify difficulty + domain). When a classifier is configured, tiers whose `maxDifficulty` cap is below the classified difficulty are skipped without a call. `escalateOnFailure` accepts a boolean or `{ onProviderError, validator, confidence, maxEscalations }` — the `validator` and `confidence` hooks accept any function returning the right shape (zero dependency on `@elsium-ai/agents` so the gateway stays decoupled while VAG/CAG plug in cleanly). Every cascade returns `{ response, tier, totalCost, totalLatencyMs, attempts, classification? }` with per-tier `CascadeAttempt` audit records (`ok | failed | validation-failed | low-confidence | skipped-by-classifier`). `onAudit` streams `tier-attempt | tier-escalation | cascade-success | cascade-exhausted` events. Exhausting all eligible tiers throws `CascadeExhaustedError` carrying the full attempt history.
- 61be1c2: Add `generateObject<T>()` as the canonical typed structured-output API, aligned with the rest of the AI ecosystem (Vercel AI SDK, Mastra). Two forms ship: a gateway method `gw.generateObject(request)` returning `{ object, response }`, and a standalone `generateObject(options)` function for one-shot calls that accepts either `messages` or a `prompt` shorthand. `gw.generate()` is retained as a deprecated alias returning `{ data, response }` so existing callers keep working unchanged.
- ea71268: Add typed thinking / reasoning stream events. The `StreamEvent` discriminated union now includes `thinking_start`, `thinking_delta` (with `text`), and `thinking_end`, so consumers narrow on `event.type` and get full autocompletion for the model's internal reasoning the same way they already do for `text_delta` and `tool_call_*`. `TokenUsage` gains `reasoningTokens?` for OpenAI o-series billing visibility. `CompletionRequest` gains a `thinking?: { enabled?, budgetTokens?, effort? }` config that the Anthropic provider translates to `thinking: { type: 'enabled', budget_tokens }` (deriving the budget from `effort: 'low' | 'medium' | 'high'` when `budgetTokens` is omitted), and the OpenAI provider translates to `reasoning_effort`. The Anthropic stream parser maps the `content_block_start/delta/stop` events whose blocks are of type `thinking` into the new typed events; the OpenAI stream parser captures `completion_tokens_details.reasoning_tokens` into `state.usage.reasoningTokens` so the final `message_end` event surfaces it. Documented in the gateway README with a full event table.

### Patch Changes

- 409ab6f: Docs round 2 — close documentation gaps for the six MVP features shipped in 0.12.x. Adds full sections to `docs/fundamentals.md` and `docs/getting-started.md` for thinking/reasoning stream events, `withToolTypes` typed tool-call streams, CARG cost-aware routed generation, tool contracts (`sideEffectLevel` + idempotency + preconditions + `dryRunHandler`), `askHuman` durable human-in-the-loop, and `replayFrom` time-travel replay. Extends the relevant package READMEs (`packages/tools`, `packages/agents`, `packages/testing`) with What's-Inside table rows and standalone sections. Adds runnable examples — `examples/carg-cascade/`, `examples/thinking-stream/`, `examples/typed-tool-stream/`, `examples/tool-contracts/`, `examples/ask-human/`, `examples/replay-from/` — and refreshes `examples/README.md` to index them. Docs/examples only; no runtime behavior change.
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
