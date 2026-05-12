---
'@elsium-ai/tools': minor
---

Add mode:'process' sandbox runner with child_process.fork for OS-level process isolation

New `createProcessSandboxRunner` and `mode: 'process'` support in `createSandboxRunner`:
- Spawns an isolated Node.js child process via `child_process.fork()`
- IPC-based communication with the sandbox handler
- Timeout, abort, and dispose semantics matching existing worker runner
- Handles `process.exit()` in sandbox without affecting the host
- `unref()` behavior prevents orphan processes
- `fork-entry.mjs` is bundled into the published package for production use
