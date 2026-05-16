import { type Logger, createLogger, generateId, timingSafeEqualString } from '@elsium-ai/core'
import type { ServerAdapter } from './adapter'
import type { AuthConfig, CorsConfig, RateLimitConfig } from './types'

export function corsMiddleware(adapter: ServerAdapter, config: CorsConfig | boolean = true) {
	const opts: CorsConfig =
		typeof config === 'boolean' ? { origin: '*', methods: ['GET', 'POST', 'OPTIONS'] } : config

	return async (c: unknown, next: () => Promise<void>) => {
		const requestOrigin = adapter.header(c, 'Origin') ?? ''

		let allowedOrigin: string
		if (Array.isArray(opts.origin)) {
			allowedOrigin = opts.origin.includes(requestOrigin) ? requestOrigin : ''
		} else {
			allowedOrigin = opts.origin ?? ''
		}

		if (allowedOrigin) {
			adapter.setHeader(c, 'Access-Control-Allow-Origin', allowedOrigin)
			adapter.setHeader(c, 'Vary', 'Origin')
		}
		adapter.setHeader(
			c,
			'Access-Control-Allow-Methods',
			(opts.methods ?? ['GET', 'POST', 'OPTIONS']).join(', '),
		)
		adapter.setHeader(
			c,
			'Access-Control-Allow-Headers',
			(opts.headers ?? ['Content-Type', 'Authorization']).join(', '),
		)

		if (opts.credentials) {
			adapter.setHeader(c, 'Access-Control-Allow-Credentials', 'true')
		}

		if (adapter.method(c) === 'OPTIONS') {
			return adapter.body(c, null, 200)
		}

		await next()
	}
}

export function authMiddleware(adapter: ServerAdapter, config: AuthConfig) {
	return async (c: unknown, next: () => Promise<void>) => {
		if (adapter.path(c) === '/health') {
			return next()
		}

		const authorization = adapter.header(c, 'Authorization')

		if (!authorization) {
			return adapter.json(c, { error: 'Missing Authorization header' }, 401)
		}

		if (config.type === 'bearer') {
			const token = authorization.replace(/^Bearer\s+/, '')
			if (!timingSafeEqualString(token, config.token)) {
				return adapter.json(c, { error: 'Invalid token' }, 401)
			}
		}

		await next()
	}
}

function cleanupExpiredEntries(
	requests: Map<string, { count: number; resetTime: number }>,
	now: number,
): void {
	for (const [key, entry] of requests) {
		if (now > entry.resetTime) requests.delete(key)
	}
}

export function rateLimitMiddleware(adapter: ServerAdapter, config: RateLimitConfig) {
	const requests = new Map<string, { count: number; resetTime: number }>()

	return async (c: unknown, next: () => Promise<void>) => {
		const clientId =
			adapter.header(c, 'CF-Connecting-IP') ?? adapter.header(c, 'X-Real-IP') ?? 'anonymous'
		const now = Date.now()

		if (requests.size > 10_000) {
			cleanupExpiredEntries(requests, now)
		}

		if (requests.size > 100_000) {
			return adapter.json(c, { error: 'Too many requests', retryAfterMs: config.windowMs }, 429)
		}

		let record = requests.get(clientId)

		if (!record || now > record.resetTime) {
			record = { count: 0, resetTime: now + config.windowMs }
			requests.set(clientId, record)
		}

		record.count++

		adapter.setHeader(c, 'X-RateLimit-Limit', String(config.maxRequests))
		adapter.setHeader(
			c,
			'X-RateLimit-Remaining',
			String(Math.max(0, config.maxRequests - record.count)),
		)
		adapter.setHeader(c, 'X-RateLimit-Reset', String(Math.ceil(record.resetTime / 1000)))

		if (record.count > config.maxRequests) {
			return adapter.json(
				c,
				{ error: 'Too many requests', retryAfterMs: record.resetTime - now },
				429,
			)
		}

		await next()
	}
}

export function requestIdMiddleware(adapter: ServerAdapter) {
	return async (c: unknown, next: () => Promise<void>) => {
		const raw = adapter.header(c, 'X-Request-ID')
		const id = raw && /^[\w\-.:]{1,128}$/.test(raw) ? raw : generateId('req')
		adapter.set(c, 'requestId', id)

		await next()

		adapter.setHeader(c, 'X-Request-ID', id)
	}
}

export function requestLoggerMiddleware(adapter: ServerAdapter, logger?: Logger) {
	const log = logger ?? createLogger()

	return async (c: unknown, next: () => Promise<void>) => {
		const start = Date.now()

		await next()

		const duration = Date.now() - start
		log.info(`${adapter.method(c)} ${adapter.path(c)}`, {
			method: adapter.method(c),
			path: adapter.path(c),
			status: adapter.getStatus(c),
			durationMs: duration,
			requestId: adapter.getContext(c, 'requestId'),
		})
	}
}
