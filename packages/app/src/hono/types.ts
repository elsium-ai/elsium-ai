/**
 * Configuration for the built-in Hono adapter. This shape is specific to
 * `createServer`'s implementation choices — bearer-token auth, an in-memory
 * sliding-window rate limiter, `@hono/node-server`-based graceful shutdown —
 * and is not part of the framework-neutral {@link ServerAdapter} contract. A
 * different adapter (e.g. one built on Express) is free to define its own
 * config shape instead of matching this one.
 */
export interface HonoServerConfig {
	port?: number
	hostname?: string
	cors?: boolean | CorsConfig
	auth?: AuthConfig
	rateLimit?: RateLimitConfig
	gracefulShutdown?: boolean | { drainTimeoutMs?: number }
}

export interface CorsConfig {
	origin?: string | string[]
	methods?: string[]
	headers?: string[]
	credentials?: boolean
}

export interface AuthConfig {
	type: 'bearer'
	token: string
}

export interface RateLimitConfig {
	windowMs: number
	maxRequests: number
	/**
	 * Header names trusted to carry the real client IP, set by a known reverse proxy
	 * (e.g. `CF-Connecting-IP` for Cloudflare, `True-Client-IP` for Akamai). Headers
	 * listed here are tried in order; requests without any of them share the
	 * `anonymous` bucket. Defaults to `['CF-Connecting-IP']`.
	 *
	 * Do NOT include `X-Real-IP` or `X-Forwarded-For` unless you have validated that
	 * your proxy strips client-supplied copies — both are spoofable by default and
	 * allow an attacker to bypass rate limiting by varying the header per request.
	 */
	trustedProxyHeaders?: string[]
}
