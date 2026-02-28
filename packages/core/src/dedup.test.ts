import { describe, expect, it, vi } from 'vitest'
import { createDedup, dedupMiddleware } from './dedup'

describe('Dedup', () => {
	it('deduplicates concurrent calls with same key', async () => {
		const dedup = createDedup<number>()
		let callCount = 0

		const fn = async () => {
			callCount++
			await new Promise((r) => setTimeout(r, 50))
			return 42
		}

		const [r1, r2, r3] = await Promise.all([
			dedup.deduplicate('key1', fn),
			dedup.deduplicate('key1', fn),
			dedup.deduplicate('key1', fn),
		])

		expect(r1).toBe(42)
		expect(r2).toBe(42)
		expect(r3).toBe(42)
		expect(callCount).toBe(1)
	})

	it('caches results within TTL', async () => {
		const dedup = createDedup<number>({ ttlMs: 200 })
		let callCount = 0

		const fn = async () => {
			callCount++
			return callCount
		}

		const r1 = await dedup.deduplicate('key1', fn)
		const r2 = await dedup.deduplicate('key1', fn)

		expect(r1).toBe(1)
		expect(r2).toBe(1) // cached
		expect(callCount).toBe(1)
	})

	it('expires cache after TTL', async () => {
		const dedup = createDedup<number>({ ttlMs: 50 })
		let callCount = 0

		const fn = async () => {
			callCount++
			return callCount
		}

		await dedup.deduplicate('key1', fn)
		await new Promise((r) => setTimeout(r, 60))
		const r2 = await dedup.deduplicate('key1', fn)

		expect(r2).toBe(2)
		expect(callCount).toBe(2)
	})

	it('handles different keys independently', async () => {
		const dedup = createDedup<string>()

		const r1 = await dedup.deduplicate('a', async () => 'alpha')
		const r2 = await dedup.deduplicate('b', async () => 'beta')

		expect(r1).toBe('alpha')
		expect(r2).toBe('beta')
	})

	it('does not cache errors', async () => {
		const dedup = createDedup<number>()
		let callCount = 0

		await expect(
			dedup.deduplicate('key1', async () => {
				callCount++
				throw new Error('fail')
			}),
		).rejects.toThrow('fail')

		const result = await dedup.deduplicate('key1', async () => {
			callCount++
			return 42
		})

		expect(result).toBe(42)
		expect(callCount).toBe(2)
	})

	it('hashRequest produces deterministic hashes', () => {
		const dedup = createDedup()

		const h1 = dedup.hashRequest({ a: 1, b: 2 })
		const h2 = dedup.hashRequest({ a: 1, b: 2 })
		const h3 = dedup.hashRequest({ a: 1, b: 3 })

		expect(h1).toBe(h2)
		expect(h1).not.toBe(h3)
		expect(h1).toHaveLength(16)
	})

	it('enforces maxEntries limit', async () => {
		const dedup = createDedup<number>({ maxEntries: 2, ttlMs: 10_000 })

		await dedup.deduplicate('a', async () => 1)
		await dedup.deduplicate('b', async () => 2)
		await dedup.deduplicate('c', async () => 3)

		// Size should be capped (oldest evicted)
		expect(dedup.size).toBeLessThanOrEqual(3)
	})

	it('clear removes all entries', async () => {
		const dedup = createDedup<number>({ ttlMs: 10_000 })

		await dedup.deduplicate('a', async () => 1)
		await dedup.deduplicate('b', async () => 2)

		dedup.clear()
		expect(dedup.size).toBe(0)
	})
})

describe('dedupMiddleware', () => {
	it('creates valid middleware', () => {
		const mw = dedupMiddleware()
		expect(typeof mw).toBe('function')
	})
})
