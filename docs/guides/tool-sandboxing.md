# Tool Sandboxing

Run tool handlers in an isolated execution context instead of the host process. Closes the gap between ElsiumAI's Governance pillar (RBAC, audit, policies) and the actual code that tools execute — without sandboxing, every `defineTool` handler runs with full host privileges.

> Sandboxing is **opt-in**. Tools without a `sandbox` config run inline, exactly like before. There is no breaking change for existing code.

## Why this matters

A tool handler is JavaScript that you (or a third-party package, or an LLM-generated snippet) wrote. By default that code runs in your main Node process with full access to:

- `process.env` (your API keys, DB credentials)
- The filesystem (read, write, delete)
- The network (any host, any protocol)
- Other parts of your application's memory
- The ability to `process.exit()` and take down the whole service

Sandboxing moves the handler to a separate execution context. The sandbox has its own V8 heap, its own event loop, and its own `globalThis`. Variables in your main module are invisible to it. A crash inside the sandbox terminates the sandbox — your host process keeps running.

See `docs/guides/tool-sandboxing-threat-model.md` for the full attack scenarios this defends against (LLM-generated handlers, supply-chain attacks via npm tools, prompt-injected shell commands, OOM crashes).

## Sandbox modes

Two sandbox backends are available:

| Mode | Backend | Isolation level | Runtime support |
|------|---------|-----------------|-----------------|
| `'worker'` (default) | `worker_threads` | Thread-level | Node & Bun |
| `'process'` | `child_process.fork` | OS process-level | Node & Bun |

### `mode: 'worker'` (default)

Uses Node's `worker_threads` (or Bun's polyfill). Lightweight — no process spawn overhead. Suitable for most use cases.

**Known limitation:** Under Bun, `process.exit()` inside a worker does NOT terminate the worker (it does on Node). See "Runtime caveat" below.

### `mode: 'process'`

Uses `child_process.fork` to run the handler in a separate OS process. Provides the strongest crash isolation: `process.exit()` inside the handler kills only the child process, not the host.

**When to use `'process'`:**

- You deploy under Bun and need bullet-proof `process.exit()` crash isolation
- You run untrusted or LLM-generated handler code and want true OS-level process boundaries
- You need the most robust isolation guarantees regardless of runtime

**Trade-offs:**

- **Cold start:** The first invocation spawns a new Node/Bun process (~50-100ms). Subsequent invocations reuse the same child process (no additional overhead).
- **IPC serialization:** `child_process.fork` uses JSON serialization for IPC. Values that are structured-clone-safe but not JSON-safe (`Map`, `Set`, `Date`, `BigInt`, `Buffer`, `ArrayBuffer`) are **not** supported across process boundaries. Only plain objects, arrays, strings, numbers, booleans, and `null` survive correctly. If your handler input/output contains non-JSON-safe types, either coerce them to plain values (e.g. `[...map.entries()]`, `date.toISOString()`, `Number(n)`) or use `'worker'` mode which supports structured-clone.
- **Memory:** Each child process has its own heap, so per-tool memory overhead is higher than worker threads.

## API

```ts
import { defineTool } from '@elsium-ai/tools'
import { z } from 'zod'

const fetchUrl = defineTool({
  name: 'fetch_url',
  description: 'Fetch the contents of a URL',
  input: z.object({ url: z.string().url() }),
  sandbox: {
    mode: 'worker',       // or 'process'
    handler: new URL('./handlers/fetch-url.js', import.meta.url),
    timeoutMs: 10_000,
    capabilities: ['network'],
  },
})
```

### Handler module shape

The file referenced by `sandbox.handler` is imported by the sandbox and must export a default async function (or a named `handler`) that takes the validated input and returns a result.

```js
// handlers/fetch-url.js
export default async function fetchUrl(input) {
  const r = await fetch(input.url)
  return { status: r.status, body: await r.text() }
}
```

### IPC serialization by mode

| Type | `mode: 'worker'` | `mode: 'process'` |
|------|------------------|-------------------|
| Plain objects, arrays, strings, numbers, booleans | ✅ | ✅ |
| `Date` | ✅ (survives as Date) | ⚠️ survives as ISO string, use `new Date(val)` on receipt |
| `Map`, `Set` | ✅ | ❌ — serialize manually (e.g. `[...map]` / `[...set]`) |
| `BigInt` | ✅ | ❌ — coerce to `Number` or `String` |
| `Buffer`, `ArrayBuffer`, `TypedArray` | ✅ | ❌ — use `Uint8Array` or base64 encoding |
| `Error` instances | ❌ (plain objects in both modes — reconstructed with `name`, `message`, `stack`) |

### Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `mode` | `'worker' \| 'process'` | `'worker'` | The sandbox backend. `'worker'` uses `worker_threads`; `'process'` uses `child_process.fork`. |
| `handler` | `URL \| string` | required | URL or string path to the handler module. The default export is invoked. |
| `timeoutMs` | `number` | inherits `Tool.timeoutMs` | Per-invocation timeout. After this elapses the sandbox is forcibly terminated. |
| `capabilities` | `Capability[]` | `[]` | Declared capabilities. **Currently typed-only — see "What's enforced" below.** |

### Lifecycle

The sandbox runner is **lazy-spawned** on the first invocation and **kept alive** for subsequent calls. Concurrent calls to the same sandboxed tool are **serialized** — they go through the same runner one at a time. (For high-throughput parallelism, run multiple `defineTool` instances or wait for v2 worker-pool support.)

- `mode: 'worker'` — lazy-spawns a single `Worker` thread
- `mode: 'process'` — lazy-spawns a single child process via `child_process.fork`

When you're done with a tool, call `tool.dispose()` to terminate its sandbox runner:

```ts
const tool = defineTool({ /* ... */, sandbox: { /* ... */ } })
await tool.execute({ url: 'https://example.com' })
await tool.dispose?.()  // optional, only present when sandbox is configured
```

Both backends use `unref()`, so an unclean exit (forgotten `dispose`) does **not** prevent the host process from terminating.

## Runtime caveat: Bun and `process.exit()`

The `mode: 'worker'` backend is implemented on top of `node:worker_threads`. Most isolation guarantees behave identically across Node and Bun (Bun ships a `worker_threads` polyfill on top of its `Worker` primitive). One exception:

> **Under Bun, `process.exit()` inside a sandboxed handler does NOT terminate the worker.** The handler keeps running and may return a normal-looking value that the framework records as `success: true`. Under Node, `process.exit()` correctly terminates the worker thread and the framework reports the failure.

Other guarantees (process isolation, memory isolation, closure-state isolation, timeout enforcement, abort propagation) hold under both runtimes. Only the `process.exit()` death path is different.

The framework emits a one-time `log.warn` on construction of any `sandbox: { mode: 'worker' }` tool when running under Bun, so this isn't silent.

**For crash-isolation parity under Bun, switch to `mode: 'process'`.** The `child_process.fork` backend honours `process.exit()` consistently across both runtimes — the child process terminates and the framework correctly reports the failure, same as it does under Node with `mode: 'worker'`.

The cold-start cost of `mode: 'process'` (~50-100ms on first invocation) is a one-time penalty per tool. After the first call, subsequent invocations reuse the same child process with no additional overhead.

## What's enforced today vs. declared

This is the most important part of the threat model. Be precise about what you can rely on.

| Guarantee | v1 status | Mechanism |
|-----------|-----------|-----------|
| Process isolation (separate event loop) | ✅ enforced | Worker thread (`'worker'`) or child process (`'process'`) |
| Memory isolation (separate V8 heap) | ✅ enforced | Worker thread or child process |
| Crash isolation (`process.exit` only kills the sandbox) | ✅ enforced under **Node** for `'worker'`; ✅ enforced under **both runtimes** for `'process'`; ⚠️ under Bun `'worker'` mode `process.exit()` does not terminate (see "Runtime caveat") | Worker thread / child process |
| Closure-state isolation (host module variables invisible) | ✅ enforced | Handler is loaded as a separate module via `await import()` |
| Timeout enforcement (sandbox terminated after `timeoutMs`) | ✅ enforced | `Worker.terminate()` / `child.kill()` |
| Network capability allowlist (`capabilities: ['network:host.com']`) | ⚠️ declared, **not enforced in v1** | Will require interceptor over `fetch`/`http`/`https` modules |
| Filesystem capability declarations (`fs:read`, `fs:write`) | ⚠️ declared, **not enforced in v1** | Real FS isolation needs Node's `--permission` flag at the parent process level |
| Subprocess capability (`subprocess`) | ⚠️ declared, **not enforced in v1** | Same as above |

### Why declared-only for v1

Real capability enforcement requires intercepting Node's network and filesystem syscalls inside the worker. Doing this honestly (without leaving holes in `dns`, `tls`, `undici`, `node:http2`, etc.) is non-trivial — half-implementations create false security claims that someone will bypass and write a blog post about. Until that work lands, capability declarations exist as **typed metadata** for documentation, audit logs, and policy engine consumption — but they do not prevent a sandboxed handler from making arbitrary network or filesystem calls.

If you need real network egress control today, run your sandboxed tools behind an outbound proxy at the OS or container level.

## Threat model summary

| Attack | Without sandbox | With sandbox (v1) |
|--------|-----------------|-------------------|
| LLM-generated handler exfiltrates `process.env` | Full env exposed | Sandbox has its own env (you control what `workerData` you pass) — **mitigated** |
| Third-party tool from npm calls `process.exit()` | Whole app crashes | Only the sandbox dies; host process continues — **mitigated under `'worker'` on Node and `'process'` on both runtimes**; under Bun `'worker'` mode the call is reported as `success: true` (see "Runtime caveat" above) |
| Tool with prompt-injected shell command (`child_process.exec`) | Shell runs with host's privileges | Same — *not yet enforced via capabilities* — **partially mitigated** |
| Tool with `while(true){}` infinite loop | Host event loop blocked | Sandbox is terminated on `timeoutMs` — **mitigated** |
| Tool reads files via `fs.readFileSync('/etc/passwd')` | Reads succeed | Same — *not yet enforced via capabilities* — **partially mitigated** |
| Memory leak in tool slowly consumes host RAM | Host OOMs | Sandbox OOMs alone; host survives — **mitigated** |

The honest summary: **sandboxing closes process-level attack vectors today.** Capability-level attack vectors (network and filesystem) need v2 work to fully close.

## Roadmap

Tracked in [issue #40](https://github.com/elsium-ai/elsium-ai/issues/40):

- **v2** — Network egress allowlist enforced at the worker boundary (intercept `fetch`/`http`/`https`/`dns`)
- **v2** — Filesystem read/write enforcement (uses Node `--permission` flag at parent level)
- **v3** — `isolated-vm` mode for true V8 isolate isolation (heaver weight, defends against more sophisticated escape attempts)
- **v3** — Worker pool with configurable size for higher concurrency

## Migration

Existing tools that pass `handler` inline keep working. Adopt sandboxing for tools that:

1. Run code generated by an LLM
2. Use third-party tool packages from npm
3. Execute code from untrusted user input
4. You'd prefer to fail-isolated rather than take down the host on a bug

For each one:

1. Move the handler body into its own module file
2. Replace the inline `handler:` field with `sandbox: { mode: 'worker', handler: new URL('./your-handler.js', import.meta.url) }`
3. Verify the handler doesn't capture closure state from the parent module — if it does, pass that state explicitly via the `input` object instead

If your handler currently looks like:

```ts
// Before — closure capture
const db = createDbClient()
defineTool({
  name: 'lookup',
  input: z.object({ q: z.string() }),
  handler: async ({ q }) => db.query(q),
})
```

You'll need to either:

- (a) Move `db` initialization into the handler file (every sandbox has its own connection):
  ```ts
  // handlers/lookup.js
  import { createDbClient } from '../db.js'
  const db = createDbClient()
  export default async function lookup(input) { return db.query(input.q) }
  ```
- (b) Pass the connection details via input:
  ```ts
  // handlers/lookup.js
  import { createDbClient } from '../db.js'
  export default async function lookup({ q, dbUrl }) {
    const db = createDbClient(dbUrl)
    return db.query(q)
  }
  ```

Option (a) is usually what you want — sandboxed runners get their own connection pool and behave like independent service instances.
