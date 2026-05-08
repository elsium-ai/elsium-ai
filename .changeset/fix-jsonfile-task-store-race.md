---
'@elsium-ai/agents': patch
---

Fix concurrent-save race in `createJsonFileTaskStore` shipped in 0.11.0.

**The bug:** `save()` used a fixed temp filename per task id (`<id>.json.tmp`). When multiple `save()` calls for the same id ran concurrently, they all wrote to the same `.tmp` file; the first `rename()` consumed it; subsequent renames failed with `ENOENT`. The 0.11.0 release notes for `createAsyncAgent({ taskStore })` advertised "fire-and-forget" persistence of every status transition (`pending → running → completed`), which fires the saves concurrently — so this bug would silently fail to persist task state in production.

Reproduction (pre-fix): three concurrent same-id saves → two rejected with `ENOENT rename ...`, only one survives, last-write-wins is broken because the surviving file was the *first* save's content, not the last submitted.

**The fix:** added a per-id write lock (a `Map<string, Promise<unknown>>` keyed by task id) that serializes `save` and `delete` operations for the same id. Distinct ids still execute in parallel — there's no false serialization.

The pattern mirrors the write-lock already used by `createJsonlSink` in `@elsium-ai/observe`, but per-id instead of global so the store doesn't bottleneck on unrelated tasks.

**No API change.** Existing `createJsonFileTaskStore` callers and `createAsyncAgent({ taskStore })` consumers don't need to change anything.

**Tests:** 4 new regression tests covering the exact same-id concurrent-save scenario, a 25-call high-concurrency burst, mixed save+delete on the same id, and verification that distinct ids do not block each other.
