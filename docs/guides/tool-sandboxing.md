# Tool Sandboxing

Run tool handlers in an isolated Node Worker thread instead of the host process. Closes the gap between ElsiumAI's Governance pillar (RBAC, audit, policies) and the actual code that tools execute — without sandboxing, every `defineTool` handler runs with full host privileges.

> Sandboxing is **opt-in**. Tools without a `sandbox` config run inline, exactly like before. There is no breaking change for existing code.

## Why this matters

A tool handler is JavaScript that you (or a third-party package, or an LLM-generated snippet) wrote. By default that code runs in your main Node process with full access to:

- `process.env` (your API keys, DB credentials)
- The filesystem (read, write, delete)
- The network (any host, any protocol)
- Other parts of your application's memory
- The ability to `process.exit()` and take down the whole service

Sandboxing moves the handler to a separate Worker thread. The worker has its own V8 heap, its own event loop, and its own `globalThis`. Variables in your main module are invisible to it. A crash inside the worker terminates the worker — your host process keeps running.

See `docs/guides/tool-sandboxing-threat-model.md` for the full attack scenarios this defends against (LLM-generated handlers, supply-chain attacks via npm tools, prompt-injected shell commands, OOM crashes).

## API

```ts
import { defineTool } from '@elsium-ai/tools'
import { z } from 'zod'

const fetchUrl = defineTool({
  name: 'fetch_url',
  description: 'Fetch the contents of a URL',
  input: z.object({ url: z.string().url() }),
  sandbox: {
    mode: 'worker',
    handler: new URL('./handlers/fetch-url.js', import.meta.url),
    timeoutMs: 10_000,
    capabilities: ['network'],
  },
})
```

### Handler module shape

The file referenced by `sandbox.handler` is imported by the worker and must export a default async function (or a named `handler`) that takes the validated input and returns a result.

```js
// handlers/fetch-url.js
export default async function fetchUrl(input) {
  const r = await fetch(input.url)
  return { status: r.status, body: await r.text() }
}
```

Anything passed in or returned must be **structured-clone serializable**: plain objects, arrays, strings, numbers, booleans, `Date`, `Map`, `Set`, `ArrayBuffer`, `TypedArray`. Functions, class instances, DOM nodes, and `Error` objects do not survive the boundary unchanged.

### TypeScript handlers

The Worker thread imports the handler file using Node's native module loader. That loader resolves `.js` and `.mjs` directly. For `.ts` to work natively you need:

- **Bun** runtime (`bun src/index.ts`) — Bun handles `.ts` in workers natively
- **Node 22.6+** with `--experimental-strip-types`
- **Compiled output** — point `handler:` at the compiled `.js` file produced by `tsc`/`bun build`/`esbuild`

The recommended production setup is to compile your handlers to `.js` and reference the compiled artifact. See the example in `examples/sandboxed-tools/`.

### Configuration

| Field | Type | Default | Description |
|---|---|---|---|
| `mode` | `'worker'` | required | The sandbox backend. Currently only Worker thread is supported; `isolated-vm` is on the roadmap. |
| `handler` | `URL \| string` | required | URL or string path to the handler module. The default export is invoked. |
| `timeoutMs` | `number` | inherits `Tool.timeoutMs` | Per-invocation timeout. After this elapses the worker is forcibly terminated. |
| `capabilities` | `Capability[]` | `[]` | Declared capabilities. **Currently typed-only — see "What's enforced" below.** |

### Lifecycle

The worker is **lazy-spawned** on the first invocation and **kept alive** for subsequent calls. Concurrent calls to the same sandboxed tool are **serialized** — they go through the same worker one at a time. (For high-throughput parallelism, run multiple `defineTool` instances or wait for v2 worker-pool support.)

When you're done with a tool, call `tool.dispose()` to terminate its worker:

```ts
const tool = defineTool({ /* ... */, sandbox: { /* ... */ } })
await tool.execute({ url: 'https://example.com' })
await tool.dispose?.()  // optional, only present when sandbox is configured
```

The Worker is created with `unref()`, so an unclean exit (forgotten `dispose`) does **not** prevent the host process from terminating.

## What's enforced today vs. declared

This is the most important part of the threat model. Be precise about what you can rely on.

| Guarantee | v1 status | Mechanism |
|---|---|---|
| Process isolation (separate event loop) | ✅ enforced | Worker thread |
| Memory isolation (separate V8 heap) | ✅ enforced | Worker thread |
| Crash isolation (`process.exit` only kills the worker) | ✅ enforced | Worker thread |
| Closure-state isolation (host module variables invisible) | ✅ enforced | Handler is loaded as a separate module via `await import()` |
| Timeout enforcement (worker terminated after `timeoutMs`) | ✅ enforced | `Worker.terminate()` |
| Network capability allowlist (`capabilities: ['network:host.com']`) | ⚠️ declared, **not enforced in v1** | Will require interceptor over `fetch`/`http`/`https` modules |
| Filesystem capability declarations (`fs:read`, `fs:write`) | ⚠️ declared, **not enforced in v1** | Real FS isolation needs Node's `--permission` flag at the parent process level |
| Subprocess capability (`subprocess`) | ⚠️ declared, **not enforced in v1** | Same as above |

### Why declared-only for v1

Real capability enforcement requires intercepting Node's network and filesystem syscalls inside the worker. Doing this honestly (without leaving holes in `dns`, `tls`, `undici`, `node:http2`, etc.) is non-trivial — half-implementations create false security claims that someone will bypass and write a blog post about. Until that work lands, capability declarations exist as **typed metadata** for documentation, audit logs, and policy engine consumption — but they do not prevent a sandboxed handler from making arbitrary network or filesystem calls.

If you need real network egress control today, run your sandboxed tools behind an outbound proxy at the OS or container level.

## Threat model summary

| Attack | Without sandbox | With sandbox (v1) |
|---|---|---|
| LLM-generated handler exfiltrates `process.env` | Full env exposed | Worker has its own env (you control what `workerData` you pass) — **mitigated** |
| Third-party tool from npm calls `process.exit()` | Whole app crashes | Only the worker dies; host process continues — **mitigated** |
| Tool with prompt-injected shell command (`child_process.exec`) | Shell runs with host's privileges | Same — *not yet enforced via capabilities* — **partially mitigated** |
| Tool with `while(true){}` infinite loop | Host event loop blocked | Worker is terminated on `timeoutMs` — **mitigated** |
| Tool reads files via `fs.readFileSync('/etc/passwd')` | Reads succeed | Same — *not yet enforced via capabilities* — **partially mitigated** |
| Memory leak in tool slowly consumes host RAM | Host OOMs | Worker OOMs alone; host survives — **mitigated** |

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

- (a) Move `db` initialization into the handler file (every worker has its own connection):
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

Option (a) is usually what you want — workers get their own connection pool and behave like independent service instances.
