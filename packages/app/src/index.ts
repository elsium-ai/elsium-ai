// App
export { createApp } from './app'
export type { ElsiumApp } from './app'

// Server adapters
export { createServer } from './hono/adapter'
export type { HonoServerInstance } from './hono/adapter'
export type { HonoServerConfig, CorsConfig, AuthConfig, RateLimitConfig } from './hono/types'
export { isServerAdapter } from './adapter'
export type { ServerAdapter, ServerInstance, ServerHandle, AppRuntime } from './adapter'

// Types
export type {
	AppConfig,
	ChatRequest,
	ChatResponse,
	CompleteRequest,
	HealthResponse,
	MetricsResponse,
	StreamChatEvent,
	StreamCompleteEvent,
} from './types'

// SSE
export { sseHeaders, formatSSE, streamResponse } from './hono/sse'

// Middleware
export {
	corsMiddleware,
	authMiddleware,
	rateLimitMiddleware,
	requestIdMiddleware,
	requestLoggerMiddleware,
} from './hono/middleware'

// Routes
export { createRoutes } from './hono/routes'
export type { RoutesDeps } from './hono/routes'

// RBAC
export { createRBAC } from './hono/rbac'
export type { Permission, Role, RBACConfig, RBAC } from './hono/rbac'

// Tenant
export {
	tenantMiddleware,
	tenantRateLimitMiddleware,
	tenantBudgetMiddleware,
} from './hono/tenant'
export type { TenantMiddlewareConfig } from './hono/tenant'
