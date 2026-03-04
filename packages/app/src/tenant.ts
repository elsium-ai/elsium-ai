import type { TenantContext } from '@elsium-ai/core'
import { createLogger } from '@elsium-ai/core'
import type { Context, Next } from 'hono'

const log = createLogger()

export interface TenantMiddlewareConfig {
	extractTenant: (c: Context) => TenantContext | null
	onUnknownTenant?: 'reject' | 'default'
	defaultTenant?: TenantContext
}

export function tenantMiddleware(config: TenantMiddlewareConfig) {
	const { extractTenant, onUnknownTenant = 'reject', defaultTenant } = config

	return async (c: Context, next: Next) => {
		const tenant = extractTenant(c)

		if (!tenant) {
			if (onUnknownTenant === 'default' && defaultTenant) {
				c.set('tenant', defaultTenant)
				log.debug('Using default tenant', { tenantId: defaultTenant.tenantId })
			} else {
				return c.json({ error: 'Tenant identification required' }, 401)
			}
		} else {
			c.set('tenant', tenant)
			log.debug('Tenant identified', { tenantId: tenant.tenantId })
		}

		await next()
	}
}

interface RateLimitEntry {
	count: number
	windowStart: number
}

export function tenantRateLimitMiddleware() {
	const windows = new Map<string, RateLimitEntry>()

	return async (c: Context, next: Next) => {
		const tenant = c.get('tenant') as TenantContext | undefined
		if (!tenant?.limits?.maxRequestsPerMinute) {
			await next()
			return
		}

		const limit = tenant.limits.maxRequestsPerMinute
		const now = Date.now()
		const windowMs = 60_000

		const key = tenant.tenantId
		let entry = windows.get(key)

		if (!entry || now - entry.windowStart > windowMs) {
			entry = { count: 0, windowStart: now }
			windows.set(key, entry)
		}

		entry.count++

		if (entry.count > limit) {
			return c.json(
				{
					error: 'Rate limit exceeded',
					retryAfterMs: windowMs - (now - entry.windowStart),
				},
				429,
			)
		}

		await next()
	}
}
