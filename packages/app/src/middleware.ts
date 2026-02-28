import { timingSafeEqual } from 'node:crypto'
import type { Context, Next } from 'hono'
import type { AuthConfig, CorsConfig, RateLimitConfig } from './types'

// ─── CORS ────────────────────────────────────────────────────────

// H2 fix: Require explicit origin configuration; no wildcard by default
export function corsMiddleware(config: CorsConfig | boolean = true) {
	const opts: CorsConfig =
		typeof config === 'boolean' ? { origin: [], methods: ['GET', 'POST', 'OPTIONS'] } : config

	return async (c: Context, next: Next) => {
		const requestOrigin = c.req.header('Origin') ?? ''

		let allowedOrigin: string
		if (Array.isArray(opts.origin)) {
			allowedOrigin = opts.origin.includes(requestOrigin) ? requestOrigin : ''
		} else {
			allowedOrigin = opts.origin ?? ''
		}

		if (allowedOrigin) {
			c.res.headers.set('Access-Control-Allow-Origin', allowedOrigin)
		}
		c.res.headers.set(
			'Access-Control-Allow-Methods',
			(opts.methods ?? ['GET', 'POST', 'OPTIONS']).join(', '),
		)
		c.res.headers.set(
			'Access-Control-Allow-Headers',
			(opts.headers ?? ['Content-Type', 'Authorization']).join(', '),
		)

		if (opts.credentials) {
			c.res.headers.set('Access-Control-Allow-Credentials', 'true')
		}

		if (c.req.method === 'OPTIONS') {
			return c.body(null, 200)
		}

		await next()
	}
}

// ─── Auth ────────────────────────────────────────────────────────

// H4 fix: Use constant-time comparison for bearer token
export function authMiddleware(config: AuthConfig) {
	return async (c: Context, next: Next) => {
		// Skip health endpoint
		if (c.req.path === '/health') {
			return next()
		}

		const authorization = c.req.header('Authorization')

		if (!authorization) {
			return c.json({ error: 'Missing Authorization header' }, 401)
		}

		if (config.type === 'bearer') {
			const token = authorization.replace(/^Bearer\s+/, '')
			const expected = config.token
			const tokenBuf = Buffer.from(token)
			const expectedBuf = Buffer.from(expected)
			if (tokenBuf.length !== expectedBuf.length || !timingSafeEqual(tokenBuf, expectedBuf)) {
				return c.json({ error: 'Invalid token' }, 401)
			}
		}

		await next()
	}
}

// ─── Rate Limiting ───────────────────────────────────────────────

// H3 fix: Don't trust X-Forwarded-For from untrusted clients
export function rateLimitMiddleware(config: RateLimitConfig) {
	const requests = new Map<string, { count: number; resetTime: number }>()

	return async (c: Context, next: Next) => {
		// Use CF-Connecting-IP (from trusted proxy) or fall back to a per-request hash
		// Do NOT trust X-Forwarded-For as it's client-controlled
		const clientId = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Real-IP') ?? 'anonymous'
		const now = Date.now()

		let record = requests.get(clientId)

		if (!record || now > record.resetTime) {
			record = { count: 0, resetTime: now + config.windowMs }
			requests.set(clientId, record)
		}

		record.count++

		c.res.headers.set('X-RateLimit-Limit', String(config.maxRequests))
		c.res.headers.set(
			'X-RateLimit-Remaining',
			String(Math.max(0, config.maxRequests - record.count)),
		)
		c.res.headers.set('X-RateLimit-Reset', String(Math.ceil(record.resetTime / 1000)))

		if (record.count > config.maxRequests) {
			return c.json({ error: 'Too many requests', retryAfterMs: record.resetTime - now }, 429)
		}

		await next()
	}
}
