import type { TenantContext } from '@elsium-ai/core'
import { createLogger } from '@elsium-ai/core'
import type { ServerAdapter } from './adapter'

const log = createLogger()

interface UsageWindow {
	tokens: number
	cost: number
	windowStart: number
}

const tenantUsage = new Map<string, { minute: UsageWindow; day: UsageWindow }>()

export interface TenantMiddlewareConfig {
	extractTenant: (c: unknown) => TenantContext | null
	onUnknownTenant?: 'reject' | 'default'
	defaultTenant?: TenantContext
}

export function tenantMiddleware(adapter: ServerAdapter, config: TenantMiddlewareConfig) {
	const { extractTenant, onUnknownTenant = 'reject', defaultTenant } = config

	return async (c: unknown, next: () => Promise<void>) => {
		const tenant = extractTenant(c)

		if (!tenant) {
			if (onUnknownTenant === 'default' && defaultTenant) {
				adapter.set(c, 'tenant', defaultTenant)
				log.debug('Using default tenant', { tenantId: defaultTenant.tenantId })
			} else {
				return adapter.json(c, { error: 'Tenant identification required' }, 401)
			}
		} else {
			adapter.set(c, 'tenant', tenant)
			log.debug('Tenant identified', { tenantId: tenant.tenantId })
		}

		await next()
	}
}

interface RateLimitEntry {
	count: number
	windowStart: number
}

export function tenantRateLimitMiddleware(adapter: ServerAdapter) {
	const windows = new Map<string, RateLimitEntry>()

	return async (c: unknown, next: () => Promise<void>) => {
		const tenant = adapter.getContext(c, 'tenant') as TenantContext | undefined
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
			return adapter.json(
				c,
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

export function tenantBudgetMiddleware(adapter: ServerAdapter) {
	return async (c: unknown, next: () => Promise<void>) => {
		const tenant = adapter.getContext(c, 'tenant') as TenantContext | undefined
		if (!tenant?.limits) {
			await next()
			return
		}

		const usage = getOrCreateUsage(tenant.tenantId)

		resetWindowIfExpired(usage.minute, 60_000)
		resetWindowIfExpired(usage.day, 86_400_000)

		if (
			tenant.limits.maxTokensPerMinute &&
			usage.minute.tokens >= tenant.limits.maxTokensPerMinute
		) {
			return adapter.json(c, { error: 'Token rate limit exceeded', retryAfterMs: 60_000 }, 429)
		}

		if (tenant.limits.maxCostPerDay && usage.day.cost >= tenant.limits.maxCostPerDay) {
			return adapter.json(c, { error: 'Daily cost limit exceeded' }, 429)
		}

		await next()

		const tokenCount = Number(adapter.res(c).headers.get('x-token-count')) || 0
		const cost = Number(adapter.res(c).headers.get('x-cost')) || 0

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
