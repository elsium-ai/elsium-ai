# @elsium-ai/app

App bootstrap, HTTP server, and API routes for [ElsiumAI](https://github.com/elsium-ai/elsium-ai).

[![npm](https://img.shields.io/npm/v/@elsium-ai/app.svg)](https://www.npmjs.com/package/@elsium-ai/app)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE)

## Install

```bash
npm install @elsium-ai/app
```

## How this package is put together

`createApp` builds the parts that have nothing to do with HTTP -- the gateway, tracer, and agent registry -- and hands them to a **server adapter**, which is the only piece that knows how to turn that into a running web server. The app core never imports an HTTP framework directly.

This package ships one adapter out of the box, built on [Hono](https://hono.dev), so `createApp` works immediately without any extra setup. But it's just the default: the adapter contract (`ServerAdapter`) is small and documented below, so you can write your own for Express, Fastify, a Cloudflare Worker, or anything else that speaks HTTP, without needing any of the built-in adapter's CORS, auth, or rate-limiting code.

This README follows that split: [App](#app) and [Server Adapters](#server-adapters) cover the framework-neutral core and how to bring your own adapter, and everything under [Built-in Hono Adapter](#built-in-hono-adapter) documents the specifics of the default one.

## What's Inside

**Framework-neutral core**

| Export | Kind |
| --- | --- |
| `createApp` | Function |
| `ElsiumApp` | Interface |
| `AppConfig` | Interface |
| `ServerAdapter` | Interface |
| `ServerInstance` | Interface |
| `ServerHandle` | Interface |
| `AppRuntime` | Interface |
| `isServerAdapter` | Function |
| `ChatRequest` | Interface |
| `ChatResponse` | Interface |
| `CompleteRequest` | Interface |
| `HealthResponse` | Interface |
| `MetricsResponse` | Interface |

**Built-in Hono adapter**

| Export | Kind |
| --- | --- |
| `createServer` | Function |
| `HonoServerInstance` | Interface |
| `HonoServerConfig` | Interface |
| `CorsConfig` | Interface |
| `AuthConfig` | Interface |
| `RateLimitConfig` | Interface |
| `corsMiddleware` | Function |
| `authMiddleware` | Function |
| `rateLimitMiddleware` | Function |
| `requestIdMiddleware` | Function |
| `requestLoggerMiddleware` | Function |
| `sseHeaders` | Function |
| `formatSSE` | Function |
| `streamResponse` | Function |
| `tenantMiddleware` | Function |
| `tenantRateLimitMiddleware` | Function |
| `tenantBudgetMiddleware` | Function |
| `createRoutes` | Function |
| `RoutesDeps` | Interface |
| `createRBAC` | Function |
| `Permission` | Type |
| `Role` | Interface |
| `RBACConfig` | Interface |
| `RBAC` | Interface |

---

## App

### `createApp`

Creates and returns a fully configured ElsiumAI application with a gateway, tracer, agent registry, and a bound HTTP server produced by a pluggable server adapter.

```ts
function createApp<S extends ServerInstance = HonoServerInstance>(config: AppConfig<S>): ElsiumApp<S>
```

| Parameter | Type | Description |
| --- | --- | --- |
| `config` | `AppConfig<S>` | Full application configuration including gateway, agents, observability, and a `server` adapter or config. |

**Returns** `ElsiumApp<S>` -- the application handle exposing the bound server instance (typed as `S`), gateway, tracer, and `fetch`/`listen`.

```ts
import { createApp, createServer } from '@elsium-ai/app'

const app = createApp({
  gateway: {
    providers: {
      openai: { apiKey: process.env.OPENAI_API_KEY! },
    },
    defaultModel: 'gpt-4o',
  },
  // createServer is the built-in Hono adapter -- see "Built-in Hono Adapter"
  // below for its config. Pass any other ServerAdapter here instead to use
  // a different framework.
  server: createServer({
    port: 3000,
    cors: { origin: ['http://localhost:5173'], credentials: true },
    auth: { type: 'bearer', token: process.env.API_TOKEN! },
    rateLimit: { windowMs: 60_000, maxRequests: 100 },
  }),
})

const { port, stop } = app.listen()
console.log(`Listening on port ${port}`)
```

A bare Hono `HonoServerConfig` object (no `createServer` call) is also accepted for convenience and is wrapped in the default adapter:

```ts
const app = createApp({
  gateway: { providers: { openai: { apiKey: process.env.OPENAI_API_KEY! } } },
  server: { port: 3000 }, // shorthand for server: createServer({ port: 3000 })
})
```

### `ElsiumApp`

The object returned by `createApp`. Provides access to the bound server instance, gateway, tracer, and methods to serve requests.

```ts
interface ElsiumApp<S extends ServerInstance = HonoServerInstance> {
  readonly gateway: Gateway
  readonly mesh: ProviderMesh | undefined
  readonly tracer: Tracer
  readonly server: S
  fetch(request: Request): Response | Promise<Response>
  listen(port?: number): ServerHandle
}
```

| Property / Method | Type | Description |
| --- | --- | --- |
| `server` | `S` | The bound instance produced by the configured adapter's `bind()`. Its shape depends entirely on the adapter -- with the built-in one it's `HonoServerInstance`, which additionally exposes `.hono` for custom routes/middleware. |
| `gateway` | `Gateway` | The configured LLM gateway. |
| `mesh` | `ProviderMesh \| undefined` | The multi-provider mesh, if more than one provider is configured. |
| `tracer` | `Tracer` | The observability tracer for cost and latency tracking. |
| `fetch(request)` | `(request: Request) => Response \| Promise<Response>` | The web-standard request handler, delegated to the server adapter. |
| `listen(port?)` | `(port?: number) => ServerHandle` | Starts the HTTP server. Falls back to `server.port` from config, then `3000`. Returns `{ port, stop }`. |

---

## AppConfig & API Types

### `AppConfig`

Top-level configuration object passed to `createApp`. Framework-neutral except for the `server` field's bare-config shorthand described above.

```ts
interface AppConfig<S extends ServerInstance = HonoServerInstance> {
  gateway: {
    providers: Record<string, { apiKey: string; baseUrl?: string }>
    defaultModel?: string
  }
  agents?: Agent[]
  rag?: RAGPipeline
  observe?: {
    tracing?: boolean
    costTracking?: boolean
    export?: string
  }
  server?: ServerAdapter<S> | HonoServerConfig
}
```

### `ChatRequest`

Request body for the `POST /chat` endpoint (served by the built-in routes).

```ts
interface ChatRequest {
  message: string
  agent?: string
  stream?: boolean
}
```

### `ChatResponse`

Response body from the `POST /chat` endpoint.

```ts
interface ChatResponse {
  message: string
  usage: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    cost: number
  }
  model: string
  traceId: string
}
```

### `CompleteRequest`

Request body for the `POST /complete` endpoint.

```ts
interface CompleteRequest {
  messages: Array<{ role: string; content: string }>
  model?: string
  system?: string
  maxTokens?: number
  temperature?: number
  stream?: boolean
}
```

### `HealthResponse`

Response body from the `GET /health` endpoint.

```ts
interface HealthResponse {
  status: 'ok' | 'degraded'
  version: string
  uptime: number
  providers: string[]
}
```

### `MetricsResponse`

Response body from the `GET /metrics` endpoint.

```ts
interface MetricsResponse {
  uptime: number
  totalRequests: number
  totalTokens: number
  totalCost: number
  byModel: Record<string, { requests: number; tokens: number; cost: number }>
}
```

---

## Server Adapters

A server adapter is the only thing that stands between `createApp` and an actual running HTTP server. `createApp` builds an `AppRuntime` (gateway, tracer, agents, logger, ...) that describes everything the app needs to serve requests, then calls `bind()` on whichever adapter you gave it.

```ts
interface ServerAdapter<S extends ServerInstance = ServerInstance> {
  bind(runtime: AppRuntime): S
}

interface ServerInstance {
  fetch(request: Request): Response | Promise<Response>
  listen(port?: number): ServerHandle
}

interface ServerHandle {
  readonly port: number
  stop(): Promise<void>
}
```

`isServerAdapter(value)` is the runtime type guard `createApp` uses to distinguish a `ServerAdapter` from a bare config object.

### Bringing your own framework

Implement `ServerAdapter` yourself to swap in another framework -- there's no need to reuse anything documented under [Built-in Hono Adapter](#built-in-hono-adapter). Its config type, CORS/auth/rate-limit middleware, and routes are all implementation details of that one adapter, not a contract other adapters must satisfy:

```ts
import type { AppRuntime, ServerAdapter, ServerHandle, ServerInstance } from '@elsium-ai/app'
import express from 'express'

interface ExpressServerInstance extends ServerInstance {
  readonly express: express.Express
}

// Define whatever config shape makes sense for your framework -- it does not
// need to look anything like the built-in adapter's config.
interface ExpressServerConfig {
  trustProxy?: boolean
}

function createExpressServer(config: ExpressServerConfig = {}): ServerAdapter<ExpressServerInstance> {
  return {
    bind(runtime: AppRuntime): ExpressServerInstance {
      const app = express()
      if (config.trustProxy) app.set('trust proxy', true)

      app.get('/health', (_req, res) => res.json({ status: 'ok', version: runtime.version }))
      // ... wire up your own cors/auth/rate-limit middleware here, using
      // whatever Express ecosystem packages you prefer.

      return {
        express: app,
        fetch: async (request) => new Response('not implemented'), // adapt Express to fetch()
        listen(port?: number): ServerHandle {
          const server = app.listen(port ?? 3000)
          return { port: port ?? 3000, stop: async () => server.close() }
        },
      }
    },
  }
}

const app = createApp({
  gateway: { providers: { openai: { apiKey: process.env.OPENAI_API_KEY! } } },
  server: createExpressServer({ trustProxy: true }),
})

app.server.express.get('/custom', (_req, res) => res.send('hi'))
```

---

## Built-in Hono Adapter

Everything in this section is specific to the default adapter this package ships (`createServer`, built on Hono) and is entirely optional -- skip it if you're bringing your own adapter as shown above.

### `createServer`

Creates the built-in Hono server adapter. Pass its result (or a bare `HonoServerConfig`) to `createApp({ server })`.

```ts
function createServer(config?: HonoServerConfig): ServerAdapter<HonoServerInstance>
```

### `HonoServerInstance`

The Hono adapter's `ServerInstance`, additionally exposing the underlying Hono app for advanced mounting, sub-routing, or testing.

```ts
interface HonoServerInstance extends ServerInstance {
  readonly hono: Hono
}
```

### `HonoServerConfig`

HTTP server and middleware configuration for the built-in adapter.

```ts
interface HonoServerConfig {
  port?: number
  hostname?: string
  cors?: boolean | CorsConfig
  auth?: AuthConfig
  rateLimit?: RateLimitConfig
  gracefulShutdown?: boolean | { drainTimeoutMs?: number }
}
```

### `CorsConfig`

Fine-grained CORS settings. When `cors` in `HonoServerConfig` is set to `true`, sensible defaults are used.

```ts
interface CorsConfig {
  origin?: string | string[]
  methods?: string[]
  headers?: string[]
  credentials?: boolean
}
```

### `AuthConfig`

Bearer-token authentication configuration. The middleware uses timing-safe comparison to validate tokens.

```ts
interface AuthConfig {
  type: 'bearer'
  token: string
}
```

### `RateLimitConfig`

Per-client sliding-window rate limiting configuration.

```ts
interface RateLimitConfig {
  windowMs: number
  maxRequests: number
  trustedProxyHeaders?: string[]
}
```

`trustedProxyHeaders` defaults to `['CF-Connecting-IP']` and is tried in order to identify each client; requests without any of the listed headers share the `anonymous` bucket.

### Middleware

`corsMiddleware`, `authMiddleware`, and `rateLimitMiddleware` are Hono handlers `(c: Context, next: Next) => Promise<...>`. They're applied automatically by `createServer` when the corresponding `HonoServerConfig` field is set, but they can also be used standalone on any Hono app.

#### `corsMiddleware`

Sets CORS headers and handles preflight `OPTIONS` requests.

```ts
function corsMiddleware(config?: CorsConfig | boolean): (c: Context, next: Next) => Promise<Response | void>
```

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `config` | `CorsConfig \| boolean` | `true` | When `true`, uses default methods `['GET', 'POST', 'OPTIONS']` and an empty origin list. Pass a `CorsConfig` object for fine-grained control. |

```ts
import { corsMiddleware } from '@elsium-ai/app'
import { Hono } from 'hono'

const app = new Hono()

app.use('*', corsMiddleware({
  origin: ['https://myapp.com'],
  methods: ['GET', 'POST'],
  credentials: true,
}))
```

#### `authMiddleware`

Validates `Authorization: Bearer <token>` headers using timing-safe comparison. The `/health` endpoint is always excluded from auth checks.

```ts
function authMiddleware(config: AuthConfig): (c: Context, next: Next) => Promise<Response | void>
```

| Parameter | Type | Description |
| --- | --- | --- |
| `config` | `AuthConfig` | Must specify `type: 'bearer'` and the expected `token` string. |

**Responses on failure:**
- `401` with `{ error: 'Missing Authorization header' }` when the header is absent.
- `401` with `{ error: 'Invalid token' }` when the token does not match.

```ts
import { authMiddleware } from '@elsium-ai/app'
import { Hono } from 'hono'

const app = new Hono()

app.use('*', authMiddleware({
  type: 'bearer',
  token: process.env.API_TOKEN!,
}))
```

#### `rateLimitMiddleware`

Enforces per-client rate limiting using an in-memory sliding window. Sets `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` response headers.

```ts
function rateLimitMiddleware(config: RateLimitConfig): (c: Context, next: Next) => Promise<Response | void>
```

| Parameter | Type | Description |
| --- | --- | --- |
| `config` | `RateLimitConfig` | `windowMs` is the time window in milliseconds; `maxRequests` is the maximum number of requests allowed per window. |

**Responses on failure:**
- `429` with `{ error: 'Too many requests', retryAfterMs: number }` when the limit is exceeded.

```ts
import { rateLimitMiddleware } from '@elsium-ai/app'
import { Hono } from 'hono'

const app = new Hono()

app.use('*', rateLimitMiddleware({
  windowMs: 60_000,
  maxRequests: 100,
}))
```

#### `requestIdMiddleware` / `requestLoggerMiddleware`

Applied automatically by `createServer` on every request. `requestIdMiddleware` assigns (or forwards, if `X-Request-ID` is already set and well-formed) a request ID and echoes it back in the response headers. `requestLoggerMiddleware(logger?)` logs method, path, status, and duration for each request.

### SSE Utilities

Helpers for building Server-Sent Events responses from a Hono handler.

#### `sseHeaders`

Returns the standard HTTP headers for an SSE response.

```ts
function sseHeaders(): Record<string, string>
// { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' }
```

#### `formatSSE`

Formats an event name and data payload into the SSE wire format.

```ts
function formatSSE(event: string, data: unknown): string
```

| Parameter | Type | Description |
| --- | --- | --- |
| `event` | `string` | The SSE event name. |
| `data` | `unknown` | The data payload (will be JSON-stringified). |

**Returns:** A formatted SSE string (e.g., `event: text_delta\ndata: {"text":"Hello"}\n\n`).

#### `streamResponse`

Streams an async source (an `ElsiumStream` or any `AsyncIterable`) to the client as `message` SSE events, converting a thrown error into an `error` event, and returns the resulting Hono `Response`.

```ts
function streamResponse(c: Context, source: ElsiumStream | AsyncIterable<unknown>): Response
```

| Parameter | Type | Description |
| --- | --- | --- |
| `c` | `Context` | The Hono request context to stream the response through. |
| `source` | `ElsiumStream \| AsyncIterable<unknown>` | The events to send, one SSE `message` event per item. |

**Returns:** A `Response` object with SSE headers.

```ts
import { streamResponse } from '@elsium-ai/app'
import { Hono } from 'hono'

const app = new Hono()

app.post('/my-stream', (c) => {
  async function* events() {
    yield { text: 'Hello' }
    yield { done: true }
  }
  return streamResponse(c, events())
})
```

### Tenant Budget Middleware

#### `tenantBudgetMiddleware`

Enforces per-tenant token and cost budgets using sliding windows. Each tenant is identified from the request context (via `tenantMiddleware`, run first) and tracked independently.

```ts
function tenantBudgetMiddleware(): (c: Context, next: Next) => Promise<Response | void>
```

**Responses on failure:**
- `429` with `{ error: 'Token rate limit exceeded', retryAfterMs: 60_000 }` when the per-minute token budget is exceeded.
- `429` with `{ error: 'Daily cost limit exceeded' }` when the per-day cost budget is exceeded.

```ts
import { tenantBudgetMiddleware, tenantMiddleware } from '@elsium-ai/app'
import { Hono } from 'hono'

const app = new Hono()

app.use('*', tenantMiddleware({ extractTenant: (c) => resolveTenant(c) }))
app.use('*', tenantBudgetMiddleware())
```

`tenantMiddleware` and `tenantRateLimitMiddleware` are the companion functions that identify the tenant on each request and enforce a per-tenant requests-per-minute cap, respectively -- see `TenantMiddlewareConfig` for the extraction options.

### Routes

#### `createRoutes`

Creates a Hono sub-application with all built-in API routes: `GET /health`, `GET /metrics`, `POST /chat`, `POST /complete`, and `GET /agents`.

```ts
function createRoutes(deps: RoutesDeps): Hono
```

| Parameter | Type | Description |
| --- | --- | --- |
| `deps` | `RoutesDeps` | Dependencies injected into route handlers, including the gateway, agent registry, tracer, and server metadata. |

**Returns** a `Hono` instance with the following routes:

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | Returns a `HealthResponse` with status, version, uptime, and provider list. |
| `GET` | `/metrics` | Returns a `MetricsResponse` with request counts, token usage, and cost breakdowns. |
| `POST` | `/chat` | Accepts a `ChatRequest`, dispatches to the specified (or default) agent, and returns a `ChatResponse`. |
| `POST` | `/complete` | Accepts a `CompleteRequest`, forwards to the gateway, and returns the completion result. |
| `GET` | `/agents` | Lists all registered agents with their names, models, and tool names. |

```ts
import { createRoutes } from '@elsium-ai/app'
import { Hono } from 'hono'

const routes = createRoutes({
  gateway: myGateway,
  agents: new Map([['assistant', myAgent]]),
  defaultAgent: myAgent,
  tracer: myTracer,
  startTime: Date.now(),
  version: '1.0.0',
  providers: ['openai'],
})

const app = new Hono()
app.route('/', routes)
```

#### `RoutesDeps`

Dependency injection interface for `createRoutes`.

```ts
interface RoutesDeps {
  gateway: Gateway
  agents: Map<string, Agent>
  defaultAgent?: Agent
  tracer?: Tracer
  startTime: number
  version: string
  providers: string[]
}
```

| Field | Type | Description |
| --- | --- | --- |
| `gateway` | `Gateway` | The LLM gateway used by the `/complete` endpoint. |
| `agents` | `Map<string, Agent>` | Registry of named agents used by the `/chat` endpoint. |
| `defaultAgent` | `Agent` (optional) | The agent used when no `agent` field is specified in a chat request. |
| `tracer` | `Tracer` (optional) | Observability tracer for tracking LLM calls. |
| `startTime` | `number` | Timestamp (ms) when the server started, used to calculate uptime. |
| `version` | `string` | Application version string returned by `/health`. |
| `providers` | `string[]` | List of configured provider names returned by `/health`. |

### RBAC

#### `createRBAC`

Creates a role-based access control system with permission checking, role inheritance, wildcard matching, and Hono middleware generation. Includes four built-in roles (`admin`, `operator`, `user`, `viewer`) that can be overridden by user-defined roles.

```ts
function createRBAC(config: RBACConfig): RBAC
```

| Parameter | Type | Description |
| --- | --- | --- |
| `config` | `RBACConfig` | Defines custom roles, a default role, and how the role is extracted from each request. |

**Returns** an `RBAC` object with methods for permission checking and middleware creation.

**Built-in roles:**

| Role | Permissions |
| --- | --- |
| `admin` | `model:use:*`, `agent:execute:*`, `tool:call:*`, `config:read`, `config:write`, `audit:read`, `audit:write` |
| `operator` | `model:use:*`, `agent:execute:*`, `tool:call:*`, `config:read`, `audit:read` |
| `user` | `model:use`, `agent:execute`, `tool:call` |
| `viewer` | `config:read`, `audit:read` |

```ts
import { createRBAC } from '@elsium-ai/app'

const rbac = createRBAC({
  roles: [
    {
      name: 'analyst',
      permissions: ['model:use:gpt-4o-mini'],
      inherits: ['viewer'],
    },
  ],
  defaultRole: 'viewer',
})

// Check a permission
rbac.hasPermission('analyst', 'model:use:gpt-4o-mini') // true
rbac.hasPermission('analyst', 'config:read')            // true (inherited from viewer)

// Use as Hono middleware
app.post('/chat', rbac.middleware('model:use'), handler)
```

#### `Permission`

A union type representing all recognized permissions. Supports resource-specific and wildcard variants.

```ts
type Permission =
  | 'model:use'
  | 'model:use:*'
  | `model:use:${string}`
  | 'agent:execute'
  | 'agent:execute:*'
  | `agent:execute:${string}`
  | 'tool:call'
  | 'tool:call:*'
  | `tool:call:${string}`
  | 'config:read'
  | 'config:write'
  | 'audit:read'
  | 'audit:write'
```

Wildcard permissions (e.g., `model:use:*`) grant access to all resource-specific permissions under that namespace (e.g., `model:use:gpt-4o`) as well as the base permission (`model:use`).

#### `Role`

Defines a named role with a set of permissions and optional inheritance from other roles.

```ts
interface Role {
  name: string
  permissions: Permission[]
  inherits?: string[]
}
```

#### `RBACConfig`

Configuration for `createRBAC`.

```ts
interface RBACConfig {
  roles: Role[]
  defaultRole?: string
  roleExtractor?: (c: Context) => string | undefined
  trustRoleHeader?: boolean
}
```

| Field | Type | Description |
| --- | --- | --- |
| `roles` | `Role[]` | Custom role definitions. These override built-in roles with the same name. |
| `defaultRole` | `string` (optional) | The role assigned when no role can be determined from the request. Defaults to `'viewer'`. |
| `roleExtractor` | `(c: Context) => string \| undefined` (optional) | Custom function to extract the role name from a Hono request context. |
| `trustRoleHeader` | `boolean` (optional) | When `true`, reads the role from the `X-Role` request header. **Warning:** only enable this in development or behind a trusted reverse proxy, as any client can self-assign roles. |

#### `RBAC`

The object returned by `createRBAC`.

```ts
interface RBAC {
  hasPermission(role: string, permission: Permission): boolean
  middleware(required: Permission): (c: Context, next: Next) => Promise<Response | undefined>
  getRolePermissions(role: string): Permission[]
}
```

| Method | Description |
| --- | --- |
| `hasPermission(role, permission)` | Returns `true` if the given role (including inherited permissions) grants the specified permission. |
| `middleware(required)` | Returns a Hono middleware that rejects requests with `403` if the caller's role lacks the required permission. |
| `getRolePermissions(role)` | Returns the deduplicated list of all permissions for a role, including those inherited from parent roles. |

---

## Part of ElsiumAI

This package is the app layer of the [ElsiumAI](https://github.com/elsium-ai/elsium-ai) framework. See the [full documentation](https://github.com/elsium-ai/elsium-ai) for guides and examples.

## License

[MIT](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE)
