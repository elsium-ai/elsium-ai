---
'@elsium-ai/agents': minor
'@elsium-ai/observe': minor
'@elsium-ai/app': minor
'elsium-ai': minor
---

Critical durability fixes for production claims, plus security dependency updates.

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
