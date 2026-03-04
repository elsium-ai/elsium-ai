import { createHash } from 'node:crypto'
import type { LLMResponse, Middleware, MiddlewareContext } from '@elsium-ai/core'
import { createLogger } from '@elsium-ai/core'

const log = createLogger()

export interface CacheAdapter {
	get(key: string): Promise<LLMResponse | null>
	set(key: string, value: LLMResponse, ttlMs: number): Promise<void>
	delete(key: string): Promise<void>
	clear(): Promise<void>
}

export interface CacheStats {
	hits: number
	misses: number
	size: number
	hitRate: number
}

export interface CacheMiddlewareConfig {
	adapter?: CacheAdapter
	ttlMs?: number
	maxSize?: number
	keyFn?: (ctx: MiddlewareContext) => string
	shouldCache?: (ctx: MiddlewareContext, response: LLMResponse) => boolean
}

interface CacheEntry {
	value: LLMResponse
	expiresAt: number
}

export function createInMemoryCache(maxSize = 1000): CacheAdapter {
	const cache = new Map<string, CacheEntry>()

	function evict() {
		if (cache.size <= maxSize) return
		// LRU: delete the oldest entry (first in map)
		const firstKey = cache.keys().next().value
		if (firstKey !== undefined) cache.delete(firstKey)
	}

	return {
		async get(key: string): Promise<LLMResponse | null> {
			const entry = cache.get(key)
			if (!entry) return null

			if (Date.now() > entry.expiresAt) {
				cache.delete(key)
				return null
			}

			// Move to end for LRU
			cache.delete(key)
			cache.set(key, entry)
			return entry.value
		},

		async set(key: string, value: LLMResponse, ttlMs: number): Promise<void> {
			cache.set(key, { value, expiresAt: Date.now() + ttlMs })
			evict()
		},

		async delete(key: string): Promise<void> {
			cache.delete(key)
		},

		async clear(): Promise<void> {
			cache.clear()
		},
	}
}

function defaultCacheKey(ctx: MiddlewareContext): string {
	const data = JSON.stringify({
		provider: ctx.provider,
		model: ctx.model,
		messages: ctx.request.messages,
		system: ctx.request.system,
		temperature: ctx.request.temperature,
	})
	return createHash('sha256').update(data).digest('hex')
}

function defaultShouldCache(_ctx: MiddlewareContext, response: LLMResponse): boolean {
	const temp = _ctx.request.temperature
	if (temp !== undefined && temp !== 0) return false
	return response.stopReason === 'end_turn'
}

export function cacheMiddleware(
	config?: CacheMiddlewareConfig,
): Middleware & { readonly adapter: CacheAdapter; stats(): CacheStats } {
	const ttlMs = config?.ttlMs ?? 3_600_000
	const adapter = config?.adapter ?? createInMemoryCache(config?.maxSize ?? 1000)
	const keyFn = config?.keyFn ?? defaultCacheKey
	const shouldCache = config?.shouldCache ?? defaultShouldCache

	let hits = 0
	let misses = 0

	const middleware: Middleware = async (ctx, next) => {
		// Skip caching for streaming requests
		if (ctx.request.stream) {
			return next(ctx)
		}

		const key = keyFn(ctx)

		const cached = await adapter.get(key)
		if (cached) {
			hits++
			log.debug('Cache hit', { key: key.slice(0, 8), provider: ctx.provider })
			return cached
		}

		misses++
		const response = await next(ctx)

		if (shouldCache(ctx, response)) {
			await adapter.set(key, response, ttlMs)
		}

		return response
	}

	return Object.assign(middleware, {
		adapter,
		stats(): CacheStats {
			const total = hits + misses
			return {
				hits,
				misses,
				size: 0, // adapter-specific
				hitRate: total > 0 ? hits / total : 0,
			}
		},
	})
}
