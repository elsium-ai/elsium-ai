import type { Context, Next } from 'hono'
import type { AuthConfig, CorsConfig, RateLimitConfig } from './types'

// ─── CORS ────────────────────────────────────────────────────────

export function corsMiddleware(config: CorsConfig | boolean = true) {
	const opts: CorsConfig =
		typeof config === 'boolean'
			? { origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] }
			: config

	return async (c: Context, next: Next) => {
		const origin = Array.isArray(opts.origin) ? opts.origin.join(', ') : (opts.origin ?? '*')

		c.res.headers.set('Access-Control-Allow-Origin', origin)
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
			if (token !== config.token) {
				return c.json({ error: 'Invalid token' }, 401)
			}
		}

		await next()
	}
}

// ─── Rate Limiting ───────────────────────────────────────────────

export function rateLimitMiddleware(config: RateLimitConfig) {
	const requests = new Map<string, { count: number; resetTime: number }>()

	return async (c: Context, next: Next) => {
		const clientId =
			c.req.header('X-Forwarded-For') ?? c.req.header('CF-Connecting-IP') ?? 'unknown'
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
