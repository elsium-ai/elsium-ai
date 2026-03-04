# @elsium-ai/app

HTTP server package built on Hono, providing REST API routes, middleware, SSE streaming, RBAC, and multi-tenant support for the ElsiumAI framework.

```ts
import { createApp, createRoutes, authMiddleware, createRBAC } from '@elsium-ai/app'
```

---

## Core

| Export | Signature | Description |
|---|---|---|
| `createApp` | `createApp(config: AppConfig): ElsiumApp` | Bootstrap a complete HTTP server with gateway, agents, observability, and middleware |

### ElsiumApp Interface

```ts
interface ElsiumApp {
  readonly hono: Hono                // Underlying Hono instance
  readonly gateway: Gateway          // Configured gateway
  readonly tracer: Tracer            // Observability tracer
  listen(port?: number): { port: number; stop: () => Promise<void> }
}
```

### AppConfig

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
  version?: string
}
```

### ServerConfig

```ts
interface ServerConfig {
  port?: number                                    // Default: 3000
  hostname?: string                                // Default: '0.0.0.0'
  cors?: boolean | CorsConfig                      // CORS configuration
  auth?: AuthConfig                                // Authentication
  rateLimit?: RateLimitConfig                      // Global rate limiting
  gracefulShutdown?: boolean | { drainTimeoutMs?: number }
}
```

### Example

```ts
import { createApp } from '@elsium-ai/app'

const app = createApp({
  gateway: {
    providers: {
      anthropic: { apiKey: process.env.ANTHROPIC_API_KEY! },
    },
    defaultModel: 'claude-sonnet-4-20250514',
  },
  agents: [myAgent],
  observe: { tracing: true, costTracking: true },
  server: {
    port: 3000,
    cors: true,
    auth: { type: 'bearer', token: process.env.API_TOKEN! },
    rateLimit: { windowMs: 60000, maxRequests: 100 },
    gracefulShutdown: { drainTimeoutMs: 5000 },
  },
})

const { port, stop } = app.listen()
```

---

## Routes

| Export | Signature | Description |
|---|---|---|
| `createRoutes` | `createRoutes(deps: RoutesDeps): Hono` | Create route handlers for gateway and agents |

### RoutesDeps

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

### Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/chat` | Chat with an agent (streaming SSE or JSON) |
| `POST` | `/complete` | Direct LLM completion |
| `GET` | `/health` | Health check |
| `GET` | `/metrics` | Usage metrics |
| `GET` | `/agents` | List registered agents |

### Request/Response Types

```ts
interface ChatRequest {
  message: string
  agent?: string    // Agent name (uses default if omitted)
  stream?: boolean  // Enable SSE streaming
}

interface ChatResponse {
  message: string
  usage: { inputTokens: number; outputTokens: number; totalTokens: number; cost: number }
  model: string
  traceId: string
}

interface CompleteRequest {
  messages: Array<{ role: string; content: string }>
  model?: string
  system?: string
  maxTokens?: number
  temperature?: number
  stream?: boolean
}

interface HealthResponse {
  status: 'ok' | 'degraded'
  version: string
  uptime: number       // Seconds
  providers: string[]
}

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

| Export | Signature | Description |
|---|---|---|
| `corsMiddleware` | `corsMiddleware(config?: CorsConfig \| boolean): HonoMiddleware` | CORS headers with origin, methods, headers, credentials |
| `authMiddleware` | `authMiddleware(config: AuthConfig): HonoMiddleware` | Bearer token auth with timing-safe comparison |
| `rateLimitMiddleware` | `rateLimitMiddleware(config: RateLimitConfig): HonoMiddleware` | Sliding window rate limiting per client IP |
| `requestIdMiddleware` | `requestIdMiddleware(): HonoMiddleware` | Adds `X-Request-ID` header (preserves client-provided ID if valid) |
| `requestLoggerMiddleware` | `requestLoggerMiddleware(logger?: Logger): HonoMiddleware` | Structured request/response logging with duration |

### CorsConfig

```ts
interface CorsConfig {
  origin?: string | string[]  // Allowed origins (default: '*')
  methods?: string[]           // Allowed methods (default: ['GET', 'POST', 'OPTIONS'])
  headers?: string[]           // Allowed headers (default: ['Content-Type', 'Authorization'])
  credentials?: boolean        // Allow credentials
}
```

### AuthConfig

```ts
interface AuthConfig {
  type: 'bearer'
  token: string  // Expected bearer token (compared using timing-safe equality)
}
```

The `/health` endpoint is automatically excluded from auth checks.

### RateLimitConfig

```ts
interface RateLimitConfig {
  windowMs: number     // Time window in milliseconds
  maxRequests: number  // Max requests per window
}
```

Rate limit headers are set on every response: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.

### Example

```ts
import { corsMiddleware, authMiddleware, rateLimitMiddleware } from '@elsium-ai/app'
import { Hono } from 'hono'

const app = new Hono()

app.use('*', corsMiddleware({ origin: ['https://myapp.com'], credentials: true }))
app.use('*', authMiddleware({ type: 'bearer', token: process.env.API_TOKEN! }))
app.use('*', rateLimitMiddleware({ windowMs: 60_000, maxRequests: 100 }))
```

---

## Tenant Middleware

Multi-tenant isolation middleware for per-tenant rate limiting and budget enforcement.

| Export | Signature | Description |
|---|---|---|
| `tenantMiddleware` | `tenantMiddleware(config: TenantMiddlewareConfig): HonoMiddleware` | Resolve tenant from request context |
| `tenantRateLimitMiddleware` | `tenantRateLimitMiddleware(): HonoMiddleware` | Per-tenant request rate limiting (uses `maxRequestsPerMinute` from tenant limits) |
| `tenantBudgetMiddleware` | `tenantBudgetMiddleware(): HonoMiddleware` | Per-tenant token and cost budget enforcement (sliding window, 429 on exceed) |

### TenantMiddlewareConfig

```ts
interface TenantMiddlewareConfig {
  extractTenant: (c: Context) => TenantContext | null  // Resolve tenant from request
  onUnknownTenant?: 'reject' | 'default'               // Behavior for unknown tenants (default: 'reject')
  defaultTenant?: TenantContext                          // Fallback tenant when using 'default' mode
}
```

### Example

```ts
import { tenantMiddleware, tenantRateLimitMiddleware, tenantBudgetMiddleware } from '@elsium-ai/app'

app.use('*', tenantMiddleware({
  extractTenant: (c) => {
    const apiKey = c.req.header('X-API-Key')
    return apiKey ? lookupTenant(apiKey) : null
  },
  onUnknownTenant: 'reject',
}))

app.use('*', tenantRateLimitMiddleware())
app.use('*', tenantBudgetMiddleware())
```

---

## SSE Utilities

Server-Sent Events helpers for streaming responses.

| Export | Signature | Description |
|---|---|---|
| `sseHeaders` | `sseHeaders(): Record<string, string>` | Standard SSE response headers (`Content-Type`, `Cache-Control`, `Connection`, `X-Accel-Buffering`) |
| `formatSSE` | `formatSSE(event: string, data: unknown): string` | Format a named SSE event with JSON data |
| `streamResponse` | `streamResponse(c: Context, source: ElsiumStream): Response` | Convert an ElsiumStream to an SSE Response |

### Stream Event Types

```ts
interface StreamChatEvent {
  type: 'text_delta' | 'message_end' | 'error'
  text?: string
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number }
  error?: string
}

interface StreamCompleteEvent {
  type: 'text_delta' | 'tool_call_start' | 'tool_call_delta' | 'message_end' | 'error'
  text?: string
  toolCall?: { id: string; name: string }
  toolCallId?: string
  arguments?: string
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number }
  error?: string
}
```

### Example

```ts
import { sseHeaders, formatSSE } from '@elsium-ai/app'

const headers = sseHeaders()
// => { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ... }

const message = formatSSE('message', { type: 'text_delta', text: 'Hello' })
// => 'data: {"type":"text_delta","text":"Hello"}\n\n'

const named = formatSSE('error', { message: 'Something went wrong' })
// => 'event: error\ndata: {"message":"Something went wrong"}\n\n'
```

---

## Access Control (RBAC)

| Export | Signature | Description |
|---|---|---|
| `createRBAC` | `createRBAC(config: RBACConfig): RBAC` | Create a role-based access control instance |

### RBACConfig

```ts
interface RBACConfig {
  roles: Role[]                                    // Custom role definitions
  defaultRole?: string                             // Role assigned when none is resolved
  roleExtractor?: (c: Context) => string | undefined  // Custom role resolution
  trustRoleHeader?: boolean                        // Trust X-Role header (development only)
}
```

### Role

```ts
interface Role {
  name: string
  permissions: Permission[]
  inherits?: string[]  // Inherit permissions from other roles
}
```

### RBAC Interface

```ts
interface RBAC {
  hasPermission(role: string, permission: Permission): boolean
  middleware(required: Permission): (c: Context, next: Next) => Promise<Response | undefined>
  getRolePermissions(role: string): Permission[]
}
```

### Built-in Roles

| Role | Permissions |
|---|---|
| `admin` | `model:use:*`, `agent:execute:*`, `tool:call:*`, `config:read`, `config:write`, `audit:read`, `audit:write` |
| `operator` | `model:use:*`, `agent:execute:*`, `tool:call:*`, `config:read`, `audit:read` |
| `user` | `model:use`, `agent:execute`, `tool:call` |
| `viewer` | `config:read`, `audit:read` |

### Permission Types

Permissions follow the pattern `resource:action` or `resource:action:target`. Wildcard matching is supported (`model:use:*` grants `model:use:gpt-4o`).

```ts
type Permission =
  | 'model:use' | 'model:use:*' | `model:use:${string}`
  | 'agent:execute' | 'agent:execute:*' | `agent:execute:${string}`
  | 'tool:call' | 'tool:call:*' | `tool:call:${string}`
  | 'config:read' | 'config:write'
  | 'audit:read' | 'audit:write'
```

### Example

```ts
import { createRBAC } from '@elsium-ai/app'

const rbac = createRBAC({
  roles: [
    {
      name: 'ml-engineer',
      permissions: ['model:use:*', 'agent:execute:*', 'config:read'],
      inherits: ['user'],
    },
  ],
  defaultRole: 'viewer',
})

// Check permissions programmatically
rbac.hasPermission('admin', 'config:write')  // true
rbac.hasPermission('viewer', 'config:write') // false

// Use as Hono middleware
app.post('/chat', rbac.middleware('agent:execute'), chatHandler)
app.get('/config', rbac.middleware('config:read'), configHandler)
```

---

## Types

| Export | Description |
|---|---|
| `AppConfig` | App configuration: `gateway`, `agents?`, `rag?`, `observe?`, `server?`, `version?` |
| `ServerConfig` | Server options: `port?`, `hostname?`, `cors?`, `auth?`, `rateLimit?`, `gracefulShutdown?` |
| `CorsConfig` | CORS options: `origin?`, `methods?`, `headers?`, `credentials?` |
| `AuthConfig` | Auth config: `type: 'bearer'`, `token` |
| `RateLimitConfig` | Rate limit options: `windowMs`, `maxRequests` |
| `ChatRequest` | Chat endpoint request body |
| `ChatResponse` | Chat endpoint response body |
| `CompleteRequest` | Complete endpoint request body |
| `HealthResponse` | Health endpoint response |
| `MetricsResponse` | Metrics endpoint response |
| `StreamChatEvent` | SSE event types for chat streaming |
| `StreamCompleteEvent` | SSE event types for completion streaming |
| `ElsiumApp` | App instance: `hono`, `gateway`, `tracer`, `listen()` |
| `RoutesDeps` | Dependencies for `createRoutes` |
| `Permission` | Permission string type |
| `Role` | Role definition: `name`, `permissions`, `inherits?` |
| `RBACConfig` | RBAC configuration |
| `RBAC` | RBAC instance: `hasPermission`, `middleware`, `getRolePermissions` |
| `TenantMiddlewareConfig` | Tenant middleware options: `extractTenant`, `onUnknownTenant?`, `defaultTenant?` |
