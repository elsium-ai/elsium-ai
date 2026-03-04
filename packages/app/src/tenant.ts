import type { TenantContext } from '@elsium-ai/core'
import { createLogger } from '@elsium-ai/core'
import type { Context, Next } from 'hono'

const log = createLogger()

// ─── Sliding Window Tracking ────────────────────────────────────

interface UsageWindow {
	tokens: number
	cost: number
	windowStart: number
}

const tenantUsage = new Map<string, { minute: UsageWindow; day: UsageWindow }>()

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

// ─── Tenant Budget Middleware ───────────────────────────────────

function getOrCreateUsage(tenantId: string) {
	let usage = tenantUsage.get(tenantId)
	if (!usage) {
		const now = Date.now()
		usage = {
			minute: { tokens: 0, cost: 0, windowStart: now },
			day: { tokens: 0, cost: 0, windowStart: now },
		}
		tenantUsage.set(tenantId, usage)
	}
	return usage
}

function resetWindowIfExpired(window: UsageWindow, durationMs: number): void {
	const now = Date.now()
	if (now - window.windowStart > durationMs) {
		window.tokens = 0
		window.cost = 0
		window.windowStart = now
	}
}

export function tenantBudgetMiddleware() {
	return async (c: Context, next: Next) => {
		const tenant = c.get('tenant') as TenantContext | undefined
		if (!tenant?.limits) {
			await next()
			return
		}

		const usage = getOrCreateUsage(tenant.tenantId)

		// Reset expired windows
		resetWindowIfExpired(usage.minute, 60_000)
		resetWindowIfExpired(usage.day, 86_400_000)

		// Pre-check: deny if already exceeded
		if (
			tenant.limits.maxTokensPerMinute &&
			usage.minute.tokens >= tenant.limits.maxTokensPerMinute
		) {
			return c.json({ error: 'Token rate limit exceeded', retryAfterMs: 60_000 }, 429)
		}

		if (tenant.limits.maxCostPerDay && usage.day.cost >= tenant.limits.maxCostPerDay) {
			return c.json({ error: 'Daily cost limit exceeded' }, 429)
		}

		await next()

		// Post-response: track usage from response headers or body
		const tokenCount = Number(c.res.headers.get('x-token-count')) || 0
		const cost = Number(c.res.headers.get('x-cost')) || 0

		if (tokenCount > 0) {
			usage.minute.tokens += tokenCount
			usage.day.tokens += tokenCount
		}

		if (cost > 0) {
			usage.minute.cost += cost
			usage.day.cost += cost
		}
	}
}
