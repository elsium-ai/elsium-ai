import { createHash } from 'node:crypto'
import type { Middleware, MiddlewareContext, MiddlewareNext } from './types'

export interface DedupConfig {
	ttlMs?: number
	maxEntries?: number
}

export interface Dedup<T> {
	deduplicate(key: string, fn: () => Promise<T>): Promise<T>
	hashRequest(request: unknown): string
	readonly size: number
	clear(): void
}

export function createDedup<T>(config?: DedupConfig): Dedup<T> {
	const ttlMs = config?.ttlMs ?? 5_000
	const maxEntries = config?.maxEntries ?? 1_000

	const inFlight = new Map<string, Promise<T>>()
	const cache = new Map<string, { value: T; expiresAt: number }>()

	function evictExpired(): void {
		const now = Date.now()
		for (const [key, entry] of cache) {
			if (now >= entry.expiresAt) {
				cache.delete(key)
			}
		}
	}

	function enforceSizeLimit(): void {
		if (cache.size <= maxEntries) return
		const oldest = cache.keys().next().value
		if (oldest !== undefined) cache.delete(oldest)
	}

	return {
		async deduplicate(key: string, fn: () => Promise<T>): Promise<T> {
			// Check TTL cache
			const cached = cache.get(key)
			if (cached && Date.now() < cached.expiresAt) {
				return cached.value
			}

			// Check in-flight (coalescing)
			const existing = inFlight.get(key)
			if (existing) {
				return existing
			}

			// Execute and cache
			const promise = fn().then(
				(result) => {
					inFlight.delete(key)
					cache.set(key, { value: result, expiresAt: Date.now() + ttlMs })
					enforceSizeLimit()
					return result
				},
				(error) => {
					inFlight.delete(key)
					throw error
				},
			)

			inFlight.set(key, promise)
			return promise
		},

		hashRequest(request: unknown): string {
			const sorted = JSON.stringify(request, Object.keys(request as Record<string, unknown>).sort())
			return createHash('sha256').update(sorted).digest('hex').slice(0, 16)
		},

		get size(): number {
			evictExpired()
			return cache.size + inFlight.size
		},

		clear(): void {
			inFlight.clear()
			cache.clear()
		},
	}
}

export function dedupMiddleware(config?: DedupConfig): Middleware {
	const dedup = createDedup<import('./types').LLMResponse>(config)

	return async (ctx: MiddlewareContext, next: MiddlewareNext) => {
		const key = dedup.hashRequest({
			messages: ctx.request.messages,
			model: ctx.model,
			provider: ctx.provider,
			system: ctx.request.system,
			temperature: ctx.request.temperature,
			seed: ctx.request.seed,
		})

		return dedup.deduplicate(key, () => next(ctx))
	}
}
