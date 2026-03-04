import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import {
	authMiddleware,
	corsMiddleware,
	rateLimitMiddleware,
	requestIdMiddleware,
	requestLoggerMiddleware,
} from './middleware'

// ─── Helpers ─────────────────────────────────────────────────────

function getReq(path: string, headers: Record<string, string> = {}): Request {
	return new Request(`http://localhost${path}`, { method: 'GET', headers })
}

function postReq(path: string, headers: Record<string, string> = {}): Request {
	return new Request(`http://localhost${path}`, { method: 'POST', headers })
}

// ─── corsMiddleware ───────────────────────────────────────────────

describe('corsMiddleware', () => {
	it('sets wildcard origin when called with true', async () => {
		const app = new Hono()
		app.use('*', corsMiddleware(true))
		app.get('/test', (c) => c.text('ok'))

		const res = await app.fetch(getReq('/test', { Origin: 'http://example.com' }))

		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
	})

	it('reflects matched origin from array', async () => {
		const app = new Hono()
		app.use('*', corsMiddleware({ origin: ['http://app.example.com', 'http://admin.example.com'] }))
		app.get('/test', (c) => c.text('ok'))

		const res = await app.fetch(getReq('/test', { Origin: 'http://app.example.com' }))

		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://app.example.com')
		expect(res.headers.get('Vary')).toBe('Origin')
	})

	it('does not set Allow-Origin for unrecognised origin', async () => {
		const app = new Hono()
		app.use('*', corsMiddleware({ origin: ['http://trusted.com'] }))
		app.get('/test', (c) => c.text('ok'))

		const res = await app.fetch(getReq('/test', { Origin: 'http://evil.com' }))

		expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
	})

	it('uses string origin directly', async () => {
		const app = new Hono()
		app.use('*', corsMiddleware({ origin: 'https://myapp.io' }))
		app.get('/test', (c) => c.text('ok'))

		const res = await app.fetch(getReq('/test', { Origin: 'anything' }))

		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://myapp.io')
	})

	it('responds 200 to OPTIONS preflight', async () => {
		const app = new Hono()
		app.use('*', corsMiddleware(true))
		app.get('/test', (c) => c.text('ok'))

		const res = await app.fetch(new Request('http://localhost/test', { method: 'OPTIONS' }))

		expect(res.status).toBe(200)
	})

	it('sets Allow-Methods header', async () => {
		const app = new Hono()
		app.use('*', corsMiddleware({ methods: ['GET', 'DELETE'] }))
		app.get('/test', (c) => c.text('ok'))

		const res = await app.fetch(getReq('/test'))

		expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET')
		expect(res.headers.get('Access-Control-Allow-Methods')).toContain('DELETE')
	})

	it('sets Allow-Headers header', async () => {
		const app = new Hono()
		app.use('*', corsMiddleware({ headers: ['X-Custom-Header'] }))
		app.get('/test', (c) => c.text('ok'))

		const res = await app.fetch(getReq('/test'))

		expect(res.headers.get('Access-Control-Allow-Headers')).toContain('X-Custom-Header')
	})

	it('sets Allow-Credentials when credentials: true', async () => {
		const app = new Hono()
		app.use('*', corsMiddleware({ credentials: true, origin: 'https://app.com' }))
		app.get('/test', (c) => c.text('ok'))

		const res = await app.fetch(getReq('/test', { Origin: 'https://app.com' }))

		expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true')
	})

	it('does not set Allow-Credentials when credentials is not set', async () => {
		const app = new Hono()
		app.use('*', corsMiddleware(true))
		app.get('/test', (c) => c.text('ok'))

		const res = await app.fetch(getReq('/test'))

		expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull()
	})

	it('uses default methods when config is boolean true', async () => {
		const app = new Hono()
		app.use('*', corsMiddleware(true))
		app.get('/test', (c) => c.text('ok'))

		const res = await app.fetch(getReq('/test'))
		const methods = res.headers.get('Access-Control-Allow-Methods') ?? ''

		expect(methods).toContain('GET')
		expect(methods).toContain('POST')
		expect(methods).toContain('OPTIONS')
	})
})

// ─── authMiddleware ───────────────────────────────────────────────

describe('authMiddleware', () => {
	it('passes request with correct bearer token', async () => {
		const app = new Hono()
		app.use('*', authMiddleware({ type: 'bearer', token: 'supersecret' }))
		app.get('/test', (c) => c.text('ok'))

		const res = await app.fetch(getReq('/test', { Authorization: 'Bearer supersecret' }))

		expect(res.status).toBe(200)
	})

	it('rejects when Authorization header is absent', async () => {
		const app = new Hono()
		app.use('*', authMiddleware({ type: 'bearer', token: 'supersecret' }))
		app.get('/test', (c) => c.text('ok'))

		const res = await app.fetch(getReq('/test'))
		const json = await res.json()

		expect(res.status).toBe(401)
		expect(json.error).toBe('Missing Authorization header')
	})

	it('rejects wrong token', async () => {
		const app = new Hono()
		app.use('*', authMiddleware({ type: 'bearer', token: 'supersecret' }))
		app.get('/test', (c) => c.text('ok'))

		const res = await app.fetch(getReq('/test', { Authorization: 'Bearer wrongtoken' }))
		const json = await res.json()

		expect(res.status).toBe(401)
		expect(json.error).toBe('Invalid token')
	})

	it('rejects token with different length (timing-safe check)', async () => {
		const app = new Hono()
		app.use('*', authMiddleware({ type: 'bearer', token: 'short' }))
		app.get('/test', (c) => c.text('ok'))

		// Different length — timingSafeEqual requires equal lengths; the middleware must return 401
		const res = await app.fetch(
			getReq('/test', { Authorization: 'Bearer averylongtokenthatdoesnotmatch' }),
		)

		expect(res.status).toBe(401)
	})

	it('skips auth check for /health endpoint', async () => {
		const app = new Hono()
		app.use('*', authMiddleware({ type: 'bearer', token: 'secret' }))
		app.get('/health', (c) => c.json({ status: 'ok' }))

		const res = await app.fetch(getReq('/health'))

		expect(res.status).toBe(200)
	})

	it('strips Bearer prefix before comparing', async () => {
		const app = new Hono()
		app.use('*', authMiddleware({ type: 'bearer', token: 'mytoken' }))
		app.get('/test', (c) => c.text('ok'))

		// With extra spaces after Bearer — the replace strips it
		const res = await app.fetch(getReq('/test', { Authorization: 'Bearer mytoken' }))

		expect(res.status).toBe(200)
	})
})

// ─── rateLimitMiddleware ──────────────────────────────────────────

describe('rateLimitMiddleware', () => {
	it('allows requests within the window limit', async () => {
		const app = new Hono()
		app.use('*', rateLimitMiddleware({ windowMs: 60_000, maxRequests: 10 }))
		app.get('/test', (c) => c.text('ok'))

		const res = await app.fetch(getReq('/test'))

		expect(res.status).toBe(200)
	})

	it('sets X-RateLimit-Limit header', async () => {
		const app = new Hono()
		app.use('*', rateLimitMiddleware({ windowMs: 60_000, maxRequests: 5 }))
		app.get('/test', (c) => c.text('ok'))

		const res = await app.fetch(getReq('/test'))

		expect(res.headers.get('X-RateLimit-Limit')).toBe('5')
	})

	it('sets X-RateLimit-Remaining and decrements per request', async () => {
		const app = new Hono()
		app.use('*', rateLimitMiddleware({ windowMs: 60_000, maxRequests: 3 }))
		app.get('/test', (c) => c.text('ok'))

		const r1 = await app.fetch(getReq('/test'))
		const r2 = await app.fetch(getReq('/test'))

		expect(r1.headers.get('X-RateLimit-Remaining')).toBe('2')
		expect(r2.headers.get('X-RateLimit-Remaining')).toBe('1')
	})

	it('blocks requests that exceed the limit and returns 429', async () => {
		const app = new Hono()
		app.use('*', rateLimitMiddleware({ windowMs: 60_000, maxRequests: 2 }))
		app.get('/test', (c) => c.text('ok'))

		await app.fetch(getReq('/test'))
		await app.fetch(getReq('/test'))
		const res = await app.fetch(getReq('/test'))
		const json = await res.json()

		expect(res.status).toBe(429)
		expect(json.error).toContain('Too many requests')
	})

	it('includes retryAfterMs in 429 response', async () => {
		const app = new Hono()
		app.use('*', rateLimitMiddleware({ windowMs: 60_000, maxRequests: 1 }))
		app.get('/test', (c) => c.text('ok'))

		await app.fetch(getReq('/test'))
		const res = await app.fetch(getReq('/test'))
		const json = await res.json()

		expect(typeof json.retryAfterMs).toBe('number')
		expect(json.retryAfterMs).toBeGreaterThan(0)
	})

	it('sets X-RateLimit-Remaining to 0 when at the limit (not negative)', async () => {
		const app = new Hono()
		app.use('*', rateLimitMiddleware({ windowMs: 60_000, maxRequests: 1 }))
		app.get('/test', (c) => c.text('ok'))

		const res = await app.fetch(getReq('/test'))
		expect(res.headers.get('X-RateLimit-Remaining')).toBe('0')
	})

	it('uses CF-Connecting-IP for client identification', async () => {
		const app = new Hono()
		app.use('*', rateLimitMiddleware({ windowMs: 60_000, maxRequests: 1 }))
		app.get('/test', (c) => c.text('ok'))

		// Two different IPs — each should have their own window
		const r1 = await app.fetch(getReq('/test', { 'CF-Connecting-IP': '1.2.3.4' }))
		const r2 = await app.fetch(getReq('/test', { 'CF-Connecting-IP': '5.6.7.8' }))

		expect(r1.status).toBe(200)
		expect(r2.status).toBe(200)
	})
})

// ─── requestIdMiddleware ──────────────────────────────────────────

describe('requestIdMiddleware', () => {
	it('generates a request ID when none is provided', async () => {
		const app = new Hono()
		app.use('*', requestIdMiddleware())
		app.get('/test', (c) => c.json({ id: c.get('requestId') }))

		const res = await app.fetch(getReq('/test'))
		const json = await res.json()

		expect(res.headers.get('X-Request-ID')).toMatch(/^req_/)
		expect(json.id).toMatch(/^req_/)
	})

	it('echoes a valid incoming X-Request-ID', async () => {
		const app = new Hono()
		app.use('*', requestIdMiddleware())
		app.get('/test', (c) => c.json({ id: c.get('requestId') }))

		const res = await app.fetch(getReq('/test', { 'X-Request-ID': 'my-custom-id-42' }))
		const json = await res.json()

		expect(res.headers.get('X-Request-ID')).toBe('my-custom-id-42')
		expect(json.id).toBe('my-custom-id-42')
	})

	it('replaces malicious X-Request-ID with generated ID', async () => {
		const app = new Hono()
		app.use('*', requestIdMiddleware())
		app.get('/test', (c) => c.json({ id: c.get('requestId') }))

		const res = await app.fetch(getReq('/test', { 'X-Request-ID': '<script>xss</script>' }))
		const json = await res.json()

		expect(json.id).toMatch(/^req_/)
		expect(res.headers.get('X-Request-ID')).toMatch(/^req_/)
	})

	it('rejects IDs longer than 128 characters', async () => {
		const app = new Hono()
		app.use('*', requestIdMiddleware())
		app.get('/test', (c) => c.json({ id: c.get('requestId') }))

		const longId = 'a'.repeat(129)
		const res = await app.fetch(getReq('/test', { 'X-Request-ID': longId }))
		const json = await res.json()

		expect(json.id).toMatch(/^req_/)
	})

	it('sets X-Request-ID on the response', async () => {
		const app = new Hono()
		app.use('*', requestIdMiddleware())
		app.get('/test', (c) => c.text('ok'))

		const res = await app.fetch(getReq('/test'))

		expect(res.headers.get('X-Request-ID')).toBeTruthy()
	})
})

// ─── requestLoggerMiddleware ──────────────────────────────────────

describe('requestLoggerMiddleware', () => {
	it('does not interfere with the response', async () => {
		const app = new Hono()
		app.use('*', requestLoggerMiddleware())
		app.get('/test', (c) => c.json({ ok: true }))

		const res = await app.fetch(getReq('/test'))
		const json = await res.json()

		expect(res.status).toBe(200)
		expect(json.ok).toBe(true)
	})

	it('calls logger.info with method, path, and status', async () => {
		const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
		const app = new Hono()
		app.use('*', requestLoggerMiddleware(logger as never))
		app.get('/ping', (c) => c.text('pong'))

		await app.fetch(getReq('/ping'))

		expect(logger.info).toHaveBeenCalledOnce()
		const [msg, meta] = logger.info.mock.calls[0]
		expect(msg).toContain('GET')
		expect(msg).toContain('/ping')
		expect(meta.method).toBe('GET')
		expect(meta.path).toBe('/ping')
		expect(meta.status).toBe(200)
		expect(typeof meta.durationMs).toBe('number')
	})

	it('uses its own logger when none is provided', async () => {
		const app = new Hono()
		// Should not throw — uses internal createLogger()
		app.use('*', requestLoggerMiddleware())
		app.get('/test', (c) => c.text('ok'))

		await expect(app.fetch(getReq('/test'))).resolves.toBeDefined()
	})

	it('logs request ID when it is set on context', async () => {
		const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
		const app = new Hono()
		app.use('*', requestIdMiddleware())
		app.use('*', requestLoggerMiddleware(logger as never))
		app.get('/test', (c) => c.text('ok'))

		await app.fetch(getReq('/test', { 'X-Request-ID': 'track-me-123' }))

		const [, meta] = logger.info.mock.calls[0]
		expect(meta.requestId).toBe('track-me-123')
	})
})
