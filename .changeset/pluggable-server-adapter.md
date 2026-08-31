---
"@elsium-ai/app": minor
---

Isolate the HTTP framework behind a pluggable server adapter.

All Hono-specific code — middleware wiring, route mounting, and the
`@hono/node-server` bridge — now lives behind a framework-neutral
`ServerAdapter` contract. `createApp` builds the gateway,
tracer, and agents into an `AppRuntime` and hands it to `adapter.bind()`; at
runtime, none of this touches an HTTP-framework type. (`AppConfig` and
`ElsiumApp`'s generic parameter still defaults to the built-in adapter's
`HonoServerInstance` purely for type-level ergonomics — pass a different
`ServerAdapter` and that default is overridden with no runtime coupling.)
This is the first step toward moving the adapter into its own package, after
which any web-server implementation plugs into the same `server` field.

New API:

```ts
const app = createApp({
  gateway: { providers: { openai: { apiKey: process.env.OPENAI_API_KEY! } }, defaultModel: 'gpt-4o' },
  server: createServer({ port: 3000, cors: {...}, auth: {...}, rateLimit: {...} }),
})
```

New exports: `createServer`, `isServerAdapter`, and the `ServerAdapter`,
`ServerInstance`, `ServerHandle`, `AppRuntime`, and `HonoServerInstance` types.

**Breaking:** `ElsiumApp` no longer exposes a `hono` property. Use `app.fetch`
for the web-standard request handler, or `app.server` for the bound instance
(the Hono adapter's instance still exposes `.hono`). The `server` field of
`AppConfig` now accepts a `ServerAdapter`; a bare `HonoServerConfig` object is
still accepted and wrapped in the default adapter, so existing config-object
callers keep working.
