# @elsium-ai/agents

## 0.15.0

### Minor Changes

- 9061574: Add Confidence-Augmented Generation (CAG) — three pluggable confidence strategies plus a threshold gate. All implement the same `ConfidenceStrategy<T>` contract and return a `CalibratedScore<T>` with `{ value, confidence, strategy, samples?, details? }`. `selfConsistency<T>({ samples, voter, concurrency })` runs N parallel generations and votes (default `createMajorityVoter` with canonical-JSON key matching; or `createSimilarityVoter` with a user-supplied similarity function for semantic clustering). `judgeEnsemble<T>({ judges, aggregator })` runs M judges over a single output and aggregates `mean | median | min`. `logprobScore<T>({ extractLogprobs, aggregator })` extracts per-token logprobs from `LLMResponse.message.metadata.logprobs` (number array or `{ token, logprob }` objects) and aggregates `geometric-mean | mean | min`, falling back to a configurable confidence when the provider does not surface logprobs. `requireConfidence(generate, { strategy, min, below: 'abort' | 'escalate' | callback, onLowConfidence })` is the runtime threshold gate — throws `ConfidenceTooLowError` on abort, returns `{ status: 'escalated' }` for downstream routing, or invokes a user callback (typically upgrade to a stronger model or open a human-review ticket). The existing heuristic `createConfidenceScorer` is untouched.
- 2445e26: Add Verification-Augmented Generation (VAG) — a `generate → validate → repair-or-abort` pipeline as a first-class primitive. `runWithVerification(generate, { validators, maxRepairs?, formatRepairPrompt?, onAttempt?, onAbort? })` loops a user-supplied generate function through composable validators; each retry receives a `RepairContext` with the previous value, the structured failures, and a formatted repair prompt the caller injects into the next generation. Built-in validators: `zodValidator(schema)` (Zod issues become per-path repair hints), `regexValidator(pattern, { mode: 'must-match' | 'must-not-match' })`, `semanticAdapter(semanticValidator, { input, threshold })` (wraps the existing LLM-as-judge `SemanticValidator`), and `externalValidator(fn, { name, repairHint })` for async API/DB checks. `composeValidators([...], { mode: 'all' | 'short-circuit' })` aggregates failures. Outcome is `{ status: 'ok' | 'repaired' | 'aborted', value, attempts, history }` with `history` recording every attempt for audit. The contract decouples generation strategy (agent, gateway, custom) from validation policy, so existing `SemanticValidator`, `OutputGuardrails`, and `gateway.extract()` retry can all be expressed against the same `Validator` interface.
- dcad45e: Close the operational triad (tool contracts → askHuman → replayFrom) as MVP primitives — three independent additions, shipped together because they share the same goal: make agent execution safe to retry, pause, and rewind.

  **Tool contracts (`@elsium-ai/tools`)** — `ToolConfig` now accepts `sideEffectLevel: 'read' | 'write' | 'destructive'`, `idempotencyKey + idempotencyStore` (with `createInMemoryIdempotencyStore` adapter), `preconditions: Array<{ name, check }>`, and `dryRunHandler`. `execute()` honors `ctx.dryRun` (skips write/destructive handlers, returns the dry-run preview with `dryRun: true`), runs all preconditions and aborts with `preconditionFailures` if any fail, and dedupes calls by `idempotencyKey` against the store (cache hit returns `idempotent: true`). `tool.sideEffectLevel` is exposed on the `Tool` for upstream policy code.

  **`askHuman` (`@elsium-ai/agents`)** — standalone `askHuman({ question, options, context?, timeoutMs?, responder? | store?, requestId? })` consolidates the human-in-the-loop pattern. Two modes: a responder callback (Slack/web UI) raced against a setTimeout deadline, or a store-backed durable mode that polls every 250 ms and is completed out-of-band via `resolveAskHuman(store, id, decision)` — when paired with an AsyncAgent task store, the agent state survives a server restart. `timeoutMs` accepts a number or a string ('5s' / '2m' / '1h' / '7d'); bad suffix throws `CONFIG_ERROR`. `onTimeout: 'reject' | 'timeout'` controls the resulting status. Ships with `createInMemoryAskHumanStore` adapter and typed `AskHumanStore` port.

  **`replayFrom` (`@elsium-ai/testing`)** — `createTraceRecorder` captures every agent step (input/output keyed by name, with timing + metadata). `replayFrom(trace, { fromStep, executor, overrides })` re-feeds steps before `fromStep` from the recording and runs `executor` live for the rest. `overrides` accept `{ kind: 'replace', output }` (skip executor entirely) or `{ kind: 'transform', input?, output? }` (rewrite input or post-process output). Each `ReplayedStep` reports `source: 'replay' | 'live'` and `overridden: boolean` so Studio / xray can render a diff.

  Trade-off note: each of the three was scoped to 1–3 weeks individually. Combined into one PR they ship as production-MVP primitives — happy path + obvious edge cases tested, but not battle-hardened the way α/β were. Follow-up PRs should deepen each (richer idempotency cache eviction policies, askHuman over Slack/Discord adapters, replayFrom integration with `defineAgent` so it captures steps automatically).

### Patch Changes

- 409ab6f: Docs round 2 — close documentation gaps for the six MVP features shipped in 0.12.x. Adds full sections to `docs/fundamentals.md` and `docs/getting-started.md` for thinking/reasoning stream events, `withToolTypes` typed tool-call streams, CARG cost-aware routed generation, tool contracts (`sideEffectLevel` + idempotency + preconditions + `dryRunHandler`), `askHuman` durable human-in-the-loop, and `replayFrom` time-travel replay. Extends the relevant package READMEs (`packages/tools`, `packages/agents`, `packages/testing`) with What's-Inside table rows and standalone sections. Adds runnable examples — `examples/carg-cascade/`, `examples/thinking-stream/`, `examples/typed-tool-stream/`, `examples/tool-contracts/`, `examples/ask-human/`, `examples/replay-from/` — and refreshes `examples/README.md` to index them. Docs/examples only; no runtime behavior change.
- 33c71e1: Replace hardcoded magic numbers in the VAG and CAG modules with named constants in two new `defaults.ts` files. `verification/defaults.ts` exposes `DEFAULT_MAX_REPAIRS` (3) and `REPAIR_PROMPT_PREVIEW_CHARS` (500). `confidence-strategies/defaults.ts` exposes `DEFAULT_SELF_CONSISTENCY_SAMPLES` (5 — aligned with the Wang et al. 2022 self-consistency paper), `DEFAULT_SELF_CONSISTENCY_CONCURRENCY` (5), `DEFAULT_JUDGE_AGGREGATOR` (`'mean'`), `DEFAULT_LOGPROB_AGGREGATOR` (`'geometric-mean'` — perplexity-calibrated), `DEFAULT_LOGPROB_FALLBACK_CONFIDENCE` (0.5 — neutral midpoint), and `DEFAULT_SIMILARITY_VOTER_THRESHOLD` (0.85). The runtime behavior is unchanged; this is documentation-via-naming so the defaults are easy to find, override, and audit.
- Updated dependencies [35bad42]
- Updated dependencies [6491511]
- Updated dependencies [6a9adac]
- Updated dependencies [a46946f]
- Updated dependencies [409ab6f]
- Updated dependencies [0bfee9e]
- Updated dependencies [61be1c2]
- Updated dependencies [dcad45e]
- Updated dependencies [11126a4]
- Updated dependencies [dabe46d]
- Updated dependencies [ea71268]
- Updated dependencies [09ae00a]
  - @elsium-ai/core@0.15.0
  - @elsium-ai/observe@0.15.0
  - @elsium-ai/gateway@0.15.0
  - @elsium-ai/tools@0.15.0

## 0.14.0

### Patch Changes

- Updated dependencies [b245bf2]
  - @elsium-ai/tools@0.14.0
  - @elsium-ai/core@0.14.0
  - @elsium-ai/gateway@0.14.0
  - @elsium-ai/observe@0.14.0

## 0.13.0

### Minor Changes

- Add multi-stage approval chain (G4): `createApprovalChain`, `createInMemoryApprovalStore`, with per-stage `enter` conditions, role / user / callback approvers, `timeoutMs` with `onTimeout` of `deny` / `escalate` / `allow`, and an optional `ApprovalNotifier`. Only the in-memory store ships; persistent adapters (SQLite, Postgres, Redis, …) are the user's call — copy-paste templates in `docs/guides/persistent-stores.md`.

### Breaking Changes

- `createAgentIdentity(config)` is now async, returning `Promise<AgentIdentity>`. The `sign` and `verify` methods on the returned identity, as well as `IdentityRegistry.verifySignedPayload`, are now async. Migration:

  ```ts
  // Before
  const id = createAgentIdentity({ agentId, secret });
  const signed = id.sign(payload);
  const ok = id.verify(signed);

  // After
  const id = await createAgentIdentity({ agentId, secret });
  const signed = await id.sign(payload);
  const ok = await id.verify(signed);
  ```

  Reason: Web Crypto `subtle.*` is async on every cross-runtime target. Closes #41 for this module.

- `computeMessageHash` and `verifyMessageChain` (exported via `@elsium-ai/agents/stores`) are now async (`Promise<string>` / `Promise<MemoryIntegrityResult>`). Direct callers must `await`. The `SecureMemoryStore.load` / `save` / `clear` / `verifyIntegrity` methods were already async — no callsite change there.

### Patch Changes

- Updated dependencies — `@elsium-ai/core`

## 0.12.1

### Patch Changes

- Updated dependencies [6a0eb78]
  - @elsium-ai/tools@0.12.1
  - @elsium-ai/core@0.12.1
  - @elsium-ai/gateway@0.12.1
  - @elsium-ai/observe@0.12.1

## 0.12.0

### Patch Changes

- c7c5492: Fix concurrent-save race in `createJsonFileTaskStore` shipped in 0.11.0.

  **The bug:** `save()` used a fixed temp filename per task id (`<id>.json.tmp`). When multiple `save()` calls for the same id ran concurrently, they all wrote to the same `.tmp` file; the first `rename()` consumed it; subsequent renames failed with `ENOENT`. The 0.11.0 release notes for `createAsyncAgent({ taskStore })` advertised "fire-and-forget" persistence of every status transition (`pending → running → completed`), which fires the saves concurrently — so this bug would silently fail to persist task state in production.

  Reproduction (pre-fix): three concurrent same-id saves → two rejected with `ENOENT rename ...`, only one survives, last-write-wins is broken because the surviving file was the _first_ save's content, not the last submitted.

  **The fix:** added a per-id write lock (a `Map<string, Promise<unknown>>` keyed by task id) that serializes `save` and `delete` operations for the same id. Distinct ids still execute in parallel — there's no false serialization.

  The pattern mirrors the write-lock already used by `createJsonlSink` in `@elsium-ai/observe`, but per-id instead of global so the store doesn't bottleneck on unrelated tasks.

  **No API change.** Existing `createJsonFileTaskStore` callers and `createAsyncAgent({ taskStore })` consumers don't need to change anything.

  **Tests:** 4 new regression tests covering the exact same-id concurrent-save scenario, a 25-call high-concurrency burst, mixed save+delete on the same id, and verification that distinct ids do not block each other.

- Updated dependencies [f37daa1]
  - @elsium-ai/tools@0.12.0
  - @elsium-ai/core@0.12.0
  - @elsium-ai/gateway@0.12.0
  - @elsium-ai/observe@0.12.0

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

- Updated dependencies [a1bbd80]
  - @elsium-ai/observe@0.11.0
  - @elsium-ai/core@0.11.0
  - @elsium-ai/gateway@0.11.0
  - @elsium-ai/tools@0.11.0

## 0.2.1

### Patch Changes

- Fix publish pipeline: resolve `workspace:*` to real versions before npm publish. v0.2.0 shipped with unresolved `workspace:*` dependencies making it uninstallable outside the monorepo.
- Updated dependencies
  - @elsium-ai/core@0.2.1
  - @elsium-ai/tools@0.2.1
  - @elsium-ai/observe@0.2.1

## 0.2.0

### Minor Changes

- a1af089: Switch build target from `--target bun` to `--target node` for cross-runtime compatibility (Node.js, Bun, Deno). Replace `Bun.serve()` with `@hono/node-server`. Replace `bun-types` with `@types/node`. Remove `priority` field from `ProviderEntry` — array order now determines provider priority.

### Patch Changes

- Updated dependencies [a1af089]
  - @elsium-ai/core@0.2.0
  - @elsium-ai/tools@0.2.0
  - @elsium-ai/observe@0.2.0

## 0.1.7

### Patch Changes

- e1eccb4: Add README files to all packages for npm listing
- Updated dependencies [e1eccb4]
  - @elsium-ai/core@0.1.7
  - @elsium-ai/tools@0.1.7
  - @elsium-ai/observe@0.1.7
