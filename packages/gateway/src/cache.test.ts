import type { LLMResponse, MiddlewareContext } from '@elsium-ai/core'
import { describe, expect, it, vi } from 'vitest'
import { cacheMiddleware } from './cache'

// ─── Helpers ────────────────────────────────────────────────────

function createMockContext(overrides?: Partial<MiddlewareContext>): MiddlewareContext {
	return {
		request: {
			messages: [{ role: 'user', content: 'hello' }],
		},
		provider: 'test',
		model: 'test-model',
		traceId: 'trc_test',
		startTime: performance.now(),
		metadata: {},
		...overrides,
	}
}

function createMockResponse(overrides?: Partial<LLMResponse>): LLMResponse {
	return {
		id: 'test-id',
		message: { role: 'assistant', content: 'Hello' },
		usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
		cost: { inputCost: 0.001, outputCost: 0.001, totalCost: 0.002, currency: 'USD' },
		model: 'test-model',
		provider: 'test',
		stopReason: 'end_turn',
		latencyMs: 100,
		traceId: 'trc_test',
		...overrides,
	}
}

// ─── cacheMiddleware ────────────────────────────────────────────

describe('cacheMiddleware', () => {
	it('returns cached response on cache hit', async () => {
		const cache = cacheMiddleware()
		const ctx = createMockContext()
		const response = createMockResponse()
		const next = vi.fn().mockResolvedValue(response)

		// First call: cache miss
		const result1 = await cache(ctx, next)
		expect(next).toHaveBeenCalledTimes(1)
		expect(result1).toEqual(response)

		// Second call: cache hit
		const result2 = await cache(ctx, next)
		expect(next).toHaveBeenCalledTimes(1) // next not called again
		expect(result2).toEqual(response)
	})

	it('calls next on cache miss and stores result', async () => {
		const cache = cacheMiddleware()
		const ctx = createMockContext()
		const response = createMockResponse()
		const next = vi.fn().mockResolvedValue(response)

		const result = await cache(ctx, next)

		expect(next).toHaveBeenCalledOnce()
		expect(result).toEqual(response)

		// Verify stats
		const stats = cache.stats()
		expect(stats.misses).toBe(1)
		expect(stats.hits).toBe(0)
	})

	it('reports correct hit/miss stats', async () => {
		const cache = cacheMiddleware()
		const ctx = createMockContext()
		const response = createMockResponse()
		const next = vi.fn().mockResolvedValue(response)

		await cache(ctx, next) // miss
		await cache(ctx, next) // hit
		await cache(ctx, next) // hit

		const stats = cache.stats()
		expect(stats.hits).toBe(2)
		expect(stats.misses).toBe(1)
		expect(stats.hitRate).toBeCloseTo(2 / 3)
	})

	it('expires entries after TTL', async () => {
		const cache = cacheMiddleware({ ttlMs: 50 })
		const ctx = createMockContext()
		const response = createMockResponse()
		const next = vi.fn().mockResolvedValue(response)

		await cache(ctx, next) // miss, stored
		expect(next).toHaveBeenCalledTimes(1)

		// Wait for TTL to expire
		await new Promise((r) => setTimeout(r, 100))

		await cache(ctx, next) // miss again (expired)
		expect(next).toHaveBeenCalledTimes(2)
	})

	it('bypasses cache for streaming requests', async () => {
		const cache = cacheMiddleware()
		const ctx = createMockContext({
			request: {
				messages: [{ role: 'user', content: 'hello' }],
				stream: true,
			},
		})
		const response = createMockResponse()
		const next = vi.fn().mockResolvedValue(response)

		await cache(ctx, next)
		await cache(ctx, next)

		// next should be called both times because stream requests bypass cache
		expect(next).toHaveBeenCalledTimes(2)
	})

	it('uses custom key function', async () => {
		const keyFn = vi.fn().mockReturnValue('custom-key')
		const cache = cacheMiddleware({ keyFn })
		const ctx = createMockContext()
		const response = createMockResponse()
		const next = vi.fn().mockResolvedValue(response)

		await cache(ctx, next)
		expect(keyFn).toHaveBeenCalledWith(ctx)

		// Same key should produce a cache hit
		await cache(ctx, next)
		expect(next).toHaveBeenCalledTimes(1)
	})

	it('does not cache when temperature is non-zero', async () => {
		const cache = cacheMiddleware()
		const ctx = createMockContext({
			request: {
				messages: [{ role: 'user', content: 'hello' }],
				temperature: 0.7,
			},
		})
		const response = createMockResponse()
		const next = vi.fn().mockResolvedValue(response)

		await cache(ctx, next)
		await cache(ctx, next)

		// next should be called both times since non-zero temp is not cached
		expect(next).toHaveBeenCalledTimes(2)
	})

	it('caches when temperature is explicitly 0', async () => {
		const cache = cacheMiddleware()
		const ctx = createMockContext({
			request: {
				messages: [{ role: 'user', content: 'hello' }],
				temperature: 0,
			},
		})
		const response = createMockResponse()
		const next = vi.fn().mockResolvedValue(response)

		await cache(ctx, next)
		await cache(ctx, next)

		// Second call should be a cache hit
		expect(next).toHaveBeenCalledTimes(1)
	})

	it('does not cache responses with stopReason other than end_turn', async () => {
		const cache = cacheMiddleware()
		const ctx = createMockContext()
		const response = createMockResponse({ stopReason: 'max_tokens' })
		const next = vi.fn().mockResolvedValue(response)

		await cache(ctx, next)
		await cache(ctx, next)

		// Not cached because stopReason is not 'end_turn'
		expect(next).toHaveBeenCalledTimes(2)
	})

	it('exposes the adapter', () => {
		const cache = cacheMiddleware()
		expect(cache.adapter).toBeDefined()
		expect(typeof cache.adapter.get).toBe('function')
		expect(typeof cache.adapter.set).toBe('function')
		expect(typeof cache.adapter.delete).toBe('function')
		expect(typeof cache.adapter.clear).toBe('function')
	})
})
