import type { TenantContext } from '@elsium-ai/core'
import { Hono } from 'hono'
import { tenantMiddleware, tenantRateLimitMiddleware } from './tenant'

// ─── Helpers ─────────────────────────────────────────────────────

function req(method: string, path: string, headers?: Record<string, string>): Request {
	return new Request(`http://localhost${path}`, { method, headers })
}

const freeTenant: TenantContext = {
	tenantId: 'tenant-free',
	tier: 'free',
	limits: { maxRequestsPerMinute: 3 },
}

const proTenant: TenantContext = {
	tenantId: 'tenant-pro',
	tier: 'pro',
	limits: { maxRequestsPerMinute: 100 },
}

const unlimitedTenant: TenantContext = {
	tenantId: 'tenant-unlimited',
	tier: 'enterprise',
}

const defaultTenant: TenantContext = {
	tenantId: 'default',
	tier: 'default',
}

// ─── tenantMiddleware ────────────────────────────────────────────

describe('tenantMiddleware', () => {
	it('sets tenant on context when extractor returns a tenant', async () => {
		const app = new Hono()
		app.use(
			'*',
			tenantMiddleware({
				extractTenant: () => freeTenant,
			}),
		)
		app.get('/test', (c) => {
			const tenant = c.get('tenant') as TenantContext
			return c.json({ tenantId: tenant.tenantId, tier: tenant.tier })
		})

		const res = await app.fetch(req('GET', '/test'))
		const json = await res.json()

		expect(res.status).toBe(200)
		expect(json.tenantId).toBe('tenant-free')
		expect(json.tier).toBe('free')
	})

	it('extracts tenant based on request header', async () => {
		const tenants: Record<string, TenantContext> = {
			'key-free': freeTenant,
			'key-pro': proTenant,
		}

		const app = new Hono()
		app.use(
			'*',
			tenantMiddleware({
				extractTenant: (c) => {
					const key = c.req.header('X-Tenant-Key')
					return key ? (tenants[key] ?? null) : null
				},
			}),
		)
		app.get('/test', (c) => {
			const tenant = c.get('tenant') as TenantContext
			return c.json({ tenantId: tenant.tenantId })
		})

		const res = await app.fetch(req('GET', '/test', { 'X-Tenant-Key': 'key-pro' }))
		const json = await res.json()

		expect(res.status).toBe(200)
		expect(json.tenantId).toBe('tenant-pro')
	})

	it('returns 401 when extractor returns null and onUnknownTenant is reject', async () => {
		const app = new Hono()
		app.use(
			'*',
			tenantMiddleware({
				extractTenant: () => null,
				onUnknownTenant: 'reject',
			}),
		)
		app.get('/test', (c) => c.json({ ok: true }))

		const res = await app.fetch(req('GET', '/test'))
		const json = await res.json()

		expect(res.status).toBe(401)
		expect(json.error).toBe('Tenant identification required')
	})

	it('returns 401 by default when extractor returns null (onUnknownTenant defaults to reject)', async () => {
		const app = new Hono()
		app.use(
			'*',
			tenantMiddleware({
				extractTenant: () => null,
			}),
		)
		app.get('/test', (c) => c.json({ ok: true }))

		const res = await app.fetch(req('GET', '/test'))

		expect(res.status).toBe(401)
	})

	it('falls back to default tenant when onUnknownTenant is default', async () => {
		const app = new Hono()
		app.use(
			'*',
			tenantMiddleware({
				extractTenant: () => null,
				onUnknownTenant: 'default',
				defaultTenant,
			}),
		)
		app.get('/test', (c) => {
			const tenant = c.get('tenant') as TenantContext
			return c.json({ tenantId: tenant.tenantId, tier: tenant.tier })
		})

		const res = await app.fetch(req('GET', '/test'))
		const json = await res.json()

		expect(res.status).toBe(200)
		expect(json.tenantId).toBe('default')
		expect(json.tier).toBe('default')
	})

	it('rejects when onUnknownTenant is default but no defaultTenant is provided', async () => {
		const app = new Hono()
		app.use(
			'*',
			tenantMiddleware({
				extractTenant: () => null,
				onUnknownTenant: 'default',
				// no defaultTenant provided
			}),
		)
		app.get('/test', (c) => c.json({ ok: true }))

		const res = await app.fetch(req('GET', '/test'))

		expect(res.status).toBe(401)
	})
})

// ─── tenantRateLimitMiddleware ───────────────────────────────────

describe('tenantRateLimitMiddleware', () => {
	it('allows requests when tenant has no rate limit configured', async () => {
		const app = new Hono()
		app.use('*', tenantMiddleware({ extractTenant: () => unlimitedTenant }))
		app.use('*', tenantRateLimitMiddleware())
		app.get('/test', (c) => c.json({ ok: true }))

		const res = await app.fetch(req('GET', '/test'))

		expect(res.status).toBe(200)
	})

	it('allows requests when no tenant is set on context', async () => {
		const app = new Hono()
		// Intentionally skip tenant middleware — no tenant in context
		app.use('*', tenantRateLimitMiddleware())
		app.get('/test', (c) => c.json({ ok: true }))

		const res = await app.fetch(req('GET', '/test'))

		expect(res.status).toBe(200)
	})

	it('allows requests within the rate limit', async () => {
		const app = new Hono()
		app.use('*', tenantMiddleware({ extractTenant: () => freeTenant }))
		app.use('*', tenantRateLimitMiddleware())
		app.get('/test', (c) => c.json({ ok: true }))

		// freeTenant has maxRequestsPerMinute: 3
		const res1 = await app.fetch(req('GET', '/test'))
		const res2 = await app.fetch(req('GET', '/test'))
		const res3 = await app.fetch(req('GET', '/test'))

		expect(res1.status).toBe(200)
		expect(res2.status).toBe(200)
		expect(res3.status).toBe(200)
	})

	it('blocks requests exceeding the rate limit', async () => {
		const app = new Hono()
		app.use('*', tenantMiddleware({ extractTenant: () => freeTenant }))
		app.use('*', tenantRateLimitMiddleware())
		app.get('/test', (c) => c.json({ ok: true }))

		// freeTenant has maxRequestsPerMinute: 3
		await app.fetch(req('GET', '/test'))
		await app.fetch(req('GET', '/test'))
		await app.fetch(req('GET', '/test'))
		const res = await app.fetch(req('GET', '/test')) // 4th request

		expect(res.status).toBe(429)
		const json = await res.json()
		expect(json.error).toBe('Rate limit exceeded')
		expect(json.retryAfterMs).toBeGreaterThan(0)
	})

	it('tracks rate limits independently per tenant', async () => {
		let currentTenant = freeTenant

		const app = new Hono()
		app.use('*', tenantMiddleware({ extractTenant: () => currentTenant }))
		app.use('*', tenantRateLimitMiddleware())
		app.get('/test', (c) => c.json({ ok: true }))

		// Exhaust freeTenant's limit (3 requests)
		await app.fetch(req('GET', '/test'))
		await app.fetch(req('GET', '/test'))
		await app.fetch(req('GET', '/test'))

		// 4th request from freeTenant is blocked
		const blockedRes = await app.fetch(req('GET', '/test'))
		expect(blockedRes.status).toBe(429)

		// Switch to proTenant — should still be allowed
		currentTenant = proTenant
		const proRes = await app.fetch(req('GET', '/test'))
		expect(proRes.status).toBe(200)
	})
})
