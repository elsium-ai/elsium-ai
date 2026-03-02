# @elsium-ai/app

App bootstrap, HTTP server, and API routes for [ElsiumAI](https://github.com/elsium-ai/elsium-ai).

[![npm](https://img.shields.io/npm/v/@elsium-ai/app.svg)](https://www.npmjs.com/package/@elsium-ai/app)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE)

## Install

```bash
npm install @elsium-ai/app
```

## What's Inside

| Category | Export | Kind |
| --- | --- | --- |
| **App** | `createApp` | Function |
| | `ElsiumApp` | Interface |
| **Types** | `AppConfig` | Interface |
| | `ServerConfig` | Interface |
| | `CorsConfig` | Interface |
| | `AuthConfig` | Interface |
| | `RateLimitConfig` | Interface |
| | `ChatRequest` | Interface |
| | `ChatResponse` | Interface |
| | `CompleteRequest` | Interface |
| | `HealthResponse` | Interface |
| | `MetricsResponse` | Interface |
| **Middleware** | `corsMiddleware` | Function |
| | `authMiddleware` | Function |
| | `rateLimitMiddleware` | Function |
| **Routes** | `createRoutes` | Function |
| | `RoutesDeps` | Interface |
| **RBAC** | `createRBAC` | Function |
| | `Permission` | Type |
| | `Role` | Interface |
| | `RBACConfig` | Interface |
| | `RBAC` | Interface |

---

## App

### `createApp`

Creates and returns a fully configured ElsiumAI application with a gateway, tracer, middleware stack, agent registry, and HTTP routes.

```ts
function createApp(config: AppConfig): ElsiumApp
```

| Parameter | Type | Description |
| --- | --- | --- |
| `config` | `AppConfig` | Full application configuration including gateway, agents, observability, and server settings. |

**Returns** `ElsiumApp` -- the application handle exposing the Hono instance, gateway, tracer, and a `listen` method to start the HTTP server.

```ts
import { createApp } from '@elsium-ai/app'

const app = createApp({
  gateway: {
    providers: {
      openai: { apiKey: process.env.OPENAI_API_KEY! },
    },
    defaultModel: 'gpt-4o',
  },
  server: {
    port: 3000,
    cors: { origin: ['http://localhost:5173'], credentials: true },
    auth: { type: 'bearer', token: process.env.API_TOKEN! },
    rateLimit: { windowMs: 60_000, maxRequests: 100 },
  },
})

const { port, stop } = app.listen()
console.log(`Listening on port ${port}`)
```

### `ElsiumApp`

The object returned by `createApp`. Provides access to the underlying Hono app, gateway, tracer, and a method to start the HTTP server.

```ts
interface ElsiumApp {
  readonly hono: Hono
  readonly gateway: Gateway
  readonly tracer: Tracer
  listen(port?: number): { port: number; stop: () => void }
}
```

| Property / Method | Type | Description |
| --- | --- | --- |
| `hono` | `Hono` | The underlying Hono application instance. Use it to add custom routes or middleware. |
| `gateway` | `Gateway` | The configured LLM gateway. |
| `tracer` | `Tracer` | The observability tracer for cost and latency tracking. |
| `listen(port?)` | `(port?: number) => { port: number; stop: () => void }` | Starts the HTTP server. Falls back to `server.port` from config, then `3000`. Returns the resolved port and a `stop` function to shut down the server. |

---

## Types

### `AppConfig`

Top-level configuration object passed to `createApp`.

```ts
interface AppConfig {
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
  server?: ServerConfig
}
```

### `ServerConfig`

HTTP server and middleware configuration.

```ts
interface ServerConfig {
  port?: number
  hostname?: string
  cors?: boolean | CorsConfig
  auth?: AuthConfig
  rateLimit?: RateLimitConfig
}
```

### `CorsConfig`

Fine-grained CORS settings. When `cors` in `ServerConfig` is set to `true`, sensible defaults are used.

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
}
```

### `ChatRequest`

Request body for the `POST /chat` endpoint.

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

## Middleware

All middleware functions return a Hono-compatible handler `(c: Context, next: Next) => Promise<...>`. They are applied automatically when the corresponding `ServerConfig` field is set, but they can also be used standalone on any Hono app.

### `corsMiddleware`

Returns a Hono middleware that sets CORS headers and handles preflight `OPTIONS` requests.

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

### `authMiddleware`

Returns a Hono middleware that validates `Authorization: Bearer <token>` headers using timing-safe comparison. The `/health` endpoint is always excluded from auth checks.

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

### `rateLimitMiddleware`

Returns a Hono middleware that enforces per-client rate limiting using an in-memory sliding window. Client identity is determined from the `CF-Connecting-IP` header, then `X-Real-IP`, falling back to `'anonymous'`. Sets `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` response headers.

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

---

## Routes

### `createRoutes`

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

### `RoutesDeps`

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

---

## RBAC

### `createRBAC`

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

### `Permission`

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

### `Role`

Defines a named role with a set of permissions and optional inheritance from other roles.

```ts
interface Role {
  name: string
  permissions: Permission[]
  inherits?: string[]
}
```

### `RBACConfig`

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

### `RBAC`

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
