import { timingSafeEqual } from 'node:crypto'
import type { Context, Next } from 'hono'
import type { AuthConfig, CorsConfig, RateLimitConfig } from './types'

// ─── CORS ────────────────────────────────────────────────────────

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
			c.res.headers.set('Vary', 'Origin')
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

function cleanupExpiredEntries(
	requests: Map<string, { count: number; resetTime: number }>,
	now: number,
): void {
	for (const [key, entry] of requests) {
		if (now > entry.resetTime) requests.delete(key)
	}
}

export function rateLimitMiddleware(config: RateLimitConfig) {
	const requests = new Map<string, { count: number; resetTime: number }>()

	return async (c: Context, next: Next) => {
		// Use CF-Connecting-IP (from trusted proxy) or fall back to a per-request hash
		// Do NOT trust X-Forwarded-For as it's client-controlled
		const clientId = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Real-IP') ?? 'anonymous'
		const now = Date.now()

		// Periodic cleanup: evict expired entries when map grows large
		if (requests.size > 10_000) {
			cleanupExpiredEntries(requests, now)
		}

		// DoS protection: hard cap on map size
		if (requests.size > 100_000) {
			return c.json({ error: 'Too many requests', retryAfterMs: config.windowMs }, 429)
		}

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
