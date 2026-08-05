# @elsium-ai/observe

## 0.20.0

### Minor Changes

- 5d32579: Add policy simulation — `terraform plan` for governance.

  Governance controls fail on adoption, not on design. Nobody enables a security
  rule in production without knowing what it breaks, so policies sit in
  monitor-only mode indefinitely and protect nothing. The gap was never a better
  policy engine; it was the missing answer to "what will this block?".

  Recorded `ExecutionProof`s already hold what actually happened. Replaying a
  candidate policy over them answers the question with traceIds attached.

  - `simulatePolicy(traces, probe)` — what a policy would have decided across
    recorded runs: totals, denials with their trace and sequence, a per-rule
    breakdown, and `affectedTraceRatio` (runs touched, not decision points —
    one run breaking is what a user experiences).
  - `comparePolicies(traces, { baseline, candidate })` — the plan.
    `newlyDenied` is the blast radius everyone asks about; `newlyAllowed` is the
    one people forget, since a relaxed policy quietly permitting what used to be
    blocked is how controls erode.
  - `flowPolicyProbe({ policy, classify, initial })` — replays information flow
    over a recording, accumulating provenance exactly as the live tracker does.
    Tools are checked before their own output joins the context, or every tool
    would appear to taint itself.
  - `formatSimulation` / `formatComparison` — plan-style output for a terminal
    or a CI comment.

  `PolicyProbe` is a port: a function from a recorded run to the decisions a
  policy would make over it. Capability tokens, declarative policy documents or a
  custom engine plug in the same way.

  Simulation is read-only — nothing is executed, no side effect replayed. And
  because proofs are hash-chained and signed, the corpus cannot be edited into a
  friendlier plan.

  The example is the argument: `lethalTrifectaRule()` with default sinks would
  have blocked 100% of a 100-run corpus, because its defaults cover `tool:*` and
  that includes read-only tools. Narrowed to genuine egress it blocks 3 runs —
  and names them.

### Patch Changes

- @elsium-ai/core@0.20.0

## 0.19.0

### Minor Changes

- c80ee8c: Add the AI-BOM — a signed declaration of what an agent is made of.

  A lockfile pins `zod@3.24.0` and says nothing about which model answers, which
  prompt steers it, or what the agent may execute. Those are the real dependencies
  of an AI system, and until now nothing pinned them.

  New in `@elsium-ai/observe`:

  - `generateAiBom(input, { signer })` — collects models (provider, snapshot,
    region), prompts, tools (schema hash, sandbox capabilities, side-effect level,
    approval requirement), MCP servers, eval datasets, policy bundles, thresholds
    and runtime into one Ed25519-signed manifest. Deterministic and
    order-independent: the same composition always yields the same
    `componentsHash`.
  - `verifyAiBom(bom, registry)` — offline verification of the component hash, the
    header digest, and the signature. Returns `checked` alongside the verdicts, so
    a check that never ran is never reported as a failed one.
  - `diffAiBom(approved, current)` + `passesGate(diff, failOn)` — composition drift
    ranked by whether the blast radius grew. Adding a tool, widening a sandbox
    capability, dropping an approval gate, moving a model across regions or
    demoting a policy to monitor-only are `critical`; a prompt revision or a
    retuned threshold is `major`; a framework bump is `minor`.

  New in `@elsium-ai/cli`:

  - `elsium bom verify <bom.json> --public-key <pem>` — offline verification.
  - `elsium bom diff <approved.json> <current.json> --fail-on critical` — the
    release gate. Exits non-zero when the shipped agent is not the agent that was
    signed off on.

  Component sources are accepted structurally, so a real `Tool` or `DatasetManifest`
  can be passed directly while `observe` keeps depending on `core` alone.

  Where a proof records one run, a BOM records the composition every run inherits.

### Patch Changes

- Updated dependencies [8bf8ecb]
  - @elsium-ai/core@0.19.0

## 0.18.0

### Patch Changes

- @elsium-ai/core@0.18.0

## 0.17.0

### Patch Changes

- @elsium-ai/core@0.17.0

## 0.16.1

### Patch Changes

- c51a981: Fix four critical bugs landed in 0.16.0:

  - **`elsium-ai` umbrella**: re-export 12 public symbols that were already shipped by `@elsium-ai/core` and `@elsium-ai/agents` but missing from the umbrella barrel: `pauseAgent`, `AgentPauseSignal`, `isAgentPauseSignal`, `createInMemoryStateStore`, `askHuman`, `createInMemoryAskHumanStore`, `resolveAskHuman`, `runResumable`, `resumeAgent`, `schemaValidator`, `judgeValidator`, `withVerifiers` (plus their accompanying types). Code that imported these from `'elsium-ai'` was receiving `undefined` at runtime.

  - **`@elsium-ai/app` rate limiter**: the rate-limit middleware fell back to the `X-Real-IP` header when `CF-Connecting-IP` was absent. Because `X-Real-IP` is set by the client when no validated proxy stripped it, an attacker could vary the header per request to bypass the limit entirely. `X-Real-IP` is removed from the default trusted-header list; a new `trustedProxyHeaders` config option lets deployments behind other proxies opt into specific headers explicitly. Anonymous traffic now shares the `anonymous` bucket (which still rate-limits in aggregate) instead of splintering by a forgeable header.

  - **`@elsium-ai/observe` cost engine**: `trackCall()` accumulated `response.cost.totalCost` and `response.usage.totalTokens` without guarding for `undefined`/`NaN`. A single response without pricing data poisoned `totalSpend` to `NaN` permanently, breaking every subsequent budget alert and cost report on that engine. Reads are now guarded with `Number.isFinite` and missing values count as zero.

  - **`@elsium-ai/agents` cost accumulators**: same NaN-propagation guard added to `agent.ts`, `state-machine.ts`, and `react.ts`, which were each independently summing `response.cost.totalCost` / `response.usage.{input,output}Tokens` without validation.
  - @elsium-ai/core@0.16.1

## 0.16.0

### Patch Changes

- Updated dependencies [6c7de04]
- Updated dependencies [d7dd4f7]
  - @elsium-ai/core@0.16.0

## 0.15.0

### Minor Changes

- 6491511: Add Verifiable Agent Execution (α-2) — offline CLI verification and proof comparison. New `compareProofs(a, b, { strategy })` in `@elsium-ai/observe` diffs two `ExecutionProof`s under `bit-exact` (every event's `hashSelf` must match — requires `temperature: 0` + `seed`) or `structural` (same event order/types; `tool.call`/`rag.retrieve`/`policy.evaluated` data must match exactly, `llm.call` compared by `model`+`provider` only). New `elsium verify <proof.json> [--public-key|--trust-roots]` recomputes the chain and verifies the Ed25519 signature offline using only the trusted public key; supports `--json` and `--quiet`. New `elsium replay <a.json> <b.json> [--strategy]` compares two proofs and exits non-zero when they diverge. Together these let any third party download a proof from another machine and verify what an agent did without API keys or network access.
- dabe46d: Add Verifiable Agent Execution (α-1) — `createProofRecorder` produces signed `ExecutionProof` documents for each agent run, with hash-chained events (LLM calls, tool calls, RAG retrievals, policy decisions, agent input/output). A new `verifyProof(proof, keyRegistry)` standalone lets any third party verify the full chain and signature offline using only the public key. Optional persistence to a `WriteOnceStore` makes the artifact tamper-evident at rest. Includes a gateway `Middleware` that auto-records LLM calls when `metadata.proofSessionId` is set on the request.

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

### Minor Changes

- Add `CostStore` port + `createLocalCostStore` reference adapter (O2b). Async-first contract for cost attribution across processes / instances. Eight attribution dimensions: model, agent, user, feature, tenant, workflow, workflowStep, traceId. Reserve / commit / release semantics for racing concurrent writers. Backend persistence is the user's call — `docs/guides/persistent-stores.md` provides copy-paste SQLite, Postgres, and Redis templates. No DB drivers shipped.
- Add drift detection (O5): `detectDrift` with pluggable `SimilarityProvider` port. Reports `exactMatchRate`, mean / mean-absolute length delta, tool-call Jaccard divergence, semantic similarity when a provider is supplied, and a weighted composite drift score. Designed to run in production against sampled traffic, not only in CI.

### Patch Changes

- Audit trail (`createAuditTrail`) internal hash chain migrated to Web Crypto (closes #41 for this module). `auditTrail.log()` stays sync fire-and-forget; an internal `chainPromise` serializes the SHA-256 computation. `query`, `verifyIntegrity`, `flush`, and `dispose` now `await` the chain so observers see a consistent state. `count` includes inflight events. No public API break — existing call sites continue to work.
- Updated dependencies — `@elsium-ai/core`

## 0.12.1

### Patch Changes

- @elsium-ai/core@0.12.1

## 0.12.0

### Patch Changes

- @elsium-ai/core@0.12.0

## 0.11.0

### Minor Changes

- a1bbd80: Critical durability fixes for production claims, plus security dependency updates.

  **`@elsium-ai/observe` — durable JSONL audit sink (G3):**

  - Add `createJsonlSink({ path, fsync })` — append-only file sink with fsync-per-batch and a write lock to prevent line interleaving under concurrent dispatch. Closes the gap where the README's "tamper-proof" hash-chained audit could lose events on crash because no existing sink (webhook, splunk, datadog) provided atomic-append durability.

  **`@elsium-ai/agents` — `AsyncAgent` durability via opt-in `taskStore` (G2):**

  - Add new `TaskStore` interface plus two implementations: `createInMemoryTaskStore` (default behaviour, no change for existing callers) and `createJsonFileTaskStore({ dir })` (durable, atomic write-tmp+rename, path-traversal guarded).
  - `createAsyncAgent({ taskStore })` now persists every status transition (pending/running/completed/failed/cancelled) fire-and-forget when a store is provided. Without `taskStore`, behaviour is unchanged.
  - New `AsyncAgent.recover(): Promise<PersistedTask[]>` — loads tasks left in pending/running state from a prior process, marks them failed in the store with a "Process restart" reason, and returns them so the operator can decide whether to resubmit. Brings async agents to parity with `defineResumableWorkflow`.
  - Note: `AsyncAgent.recover()` is a new required method on the `AsyncAgent` interface. Mocks of this interface in TS test code need to add `async recover() { return [] }` to keep compiling. No runtime breakage.

  **`@elsium-ai/app` — security update:**

  - Bump `hono` to `^4.12.18` to pick up fixes for GHSA-458j-xx4x-4375 (JSX attribute HTML injection), GHSA-9vqf-7f2p-gf9v (bodyLimit bypass on chunked requests), and GHSA-69xw-7hcm-h432 (unvalidated JSX tag names).

  **`elsium-ai` umbrella:**

  - Re-exports the new sink and task-store APIs.

  **README — honest reproducibility scope (G4):**

  - Soften the "Reproducible AI" pillar to reflect what `seed` actually delivers against hosted providers: forwarded where supported (OpenAI, Google), absent on Anthropic; OpenAI's `system_fingerprint` rotation breaks bit-exactness across deploys; `assertDeterministic` measures variance, it does not enforce it. New "Reproducibility caveats" callout points users at `mockProvider` / replay fixtures for true bit-exact testing.

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
