import { describe, expect, it } from 'vitest'
import { createMetrics } from './metrics'

describe('createMetrics', () => {
	it('creates a metrics collector', () => {
		const metrics = createMetrics()
		expect(metrics).toBeDefined()
		expect(typeof metrics.increment).toBe('function')
		expect(typeof metrics.gauge).toBe('function')
		expect(typeof metrics.histogram).toBe('function')
		expect(typeof metrics.getMetrics).toBe('function')
		expect(typeof metrics.reset).toBe('function')
	})

	it('returns empty metrics initially', () => {
		const metrics = createMetrics()
		expect(metrics.getMetrics()).toEqual([])
	})

	describe('increment', () => {
		it('records a counter entry', () => {
			const metrics = createMetrics()
			metrics.increment('requests')

			const entries = metrics.getMetrics()
			expect(entries).toHaveLength(1)
			expect(entries[0].name).toBe('requests')
			expect(entries[0].type).toBe('counter')
			expect(entries[0].value).toBe(1)
			expect(entries[0].tags).toEqual({})
		})

		it('defaults increment value to 1', () => {
			const metrics = createMetrics()
			metrics.increment('hits')

			expect(metrics.getMetrics()[0].value).toBe(1)
		})

		it('increments by a custom value', () => {
			const metrics = createMetrics()
			metrics.increment('bytes', 512)

			expect(metrics.getMetrics()[0].value).toBe(512)
		})

		it('accumulates counter across multiple calls', () => {
			const metrics = createMetrics()
			metrics.increment('requests')
			metrics.increment('requests')
			metrics.increment('requests')

			const entries = metrics.getMetrics()
			expect(entries).toHaveLength(3)
			// Each entry shows the cumulative value at that point
			expect(entries[0].value).toBe(1)
			expect(entries[1].value).toBe(2)
			expect(entries[2].value).toBe(3)
		})

		it('accumulates separately per tag combination', () => {
			const metrics = createMetrics()
			metrics.increment('requests', 1, { method: 'GET' })
			metrics.increment('requests', 1, { method: 'POST' })
			metrics.increment('requests', 1, { method: 'GET' })

			const entries = metrics.getMetrics()
			const getEntries = entries.filter((e) => e.tags.method === 'GET')
			const postEntries = entries.filter((e) => e.tags.method === 'POST')

			expect(getEntries[getEntries.length - 1].value).toBe(2)
			expect(postEntries[postEntries.length - 1].value).toBe(1)
		})

		it('records tags on entry', () => {
			const metrics = createMetrics()
			metrics.increment('errors', 1, { service: 'gateway', code: '500' })

			const entry = metrics.getMetrics()[0]
			expect(entry.tags).toEqual({ service: 'gateway', code: '500' })
		})

		it('includes a timestamp', () => {
			const before = Date.now()
			const metrics = createMetrics()
			metrics.increment('op')
			const after = Date.now()

			const entry = metrics.getMetrics()[0]
			expect(entry.timestamp).toBeGreaterThanOrEqual(before)
			expect(entry.timestamp).toBeLessThanOrEqual(after)
		})
	})

	describe('gauge', () => {
		it('records a gauge entry', () => {
			const metrics = createMetrics()
			metrics.gauge('memory_mb', 256)

			const entries = metrics.getMetrics()
			expect(entries).toHaveLength(1)
			expect(entries[0].name).toBe('memory_mb')
			expect(entries[0].type).toBe('gauge')
			expect(entries[0].value).toBe(256)
		})

		it('records tags on gauge', () => {
			const metrics = createMetrics()
			metrics.gauge('cpu_pct', 72.5, { host: 'worker-1' })

			expect(metrics.getMetrics()[0].tags).toEqual({ host: 'worker-1' })
		})

		it('records each gauge call as a new entry', () => {
			const metrics = createMetrics()
			metrics.gauge('active_connections', 10)
			metrics.gauge('active_connections', 15)

			const entries = metrics.getMetrics()
			expect(entries).toHaveLength(2)
			expect(entries[0].value).toBe(10)
			expect(entries[1].value).toBe(15)
		})
	})

	describe('histogram', () => {
		it('records a histogram entry', () => {
			const metrics = createMetrics()
			metrics.histogram('latency_ms', 142)

			const entries = metrics.getMetrics()
			expect(entries).toHaveLength(1)
			expect(entries[0].name).toBe('latency_ms')
			expect(entries[0].type).toBe('histogram')
			expect(entries[0].value).toBe(142)
		})

		it('records tags on histogram', () => {
			const metrics = createMetrics()
			metrics.histogram('response_size', 1024, { endpoint: '/api/complete' })

			expect(metrics.getMetrics()[0].tags).toEqual({ endpoint: '/api/complete' })
		})

		it('records multiple histogram observations independently', () => {
			const metrics = createMetrics()
			metrics.histogram('latency_ms', 100)
			metrics.histogram('latency_ms', 200)
			metrics.histogram('latency_ms', 300)

			const entries = metrics.getMetrics()
			expect(entries).toHaveLength(3)
			expect(entries.map((e) => e.value)).toEqual([100, 200, 300])
		})
	})

	describe('getMetrics', () => {
		it('returns entries from all metric types in insertion order', () => {
			const metrics = createMetrics()
			metrics.increment('requests')
			metrics.gauge('memory_mb', 128)
			metrics.histogram('latency_ms', 50)

			const entries = metrics.getMetrics()
			expect(entries).toHaveLength(3)
			expect(entries[0].type).toBe('counter')
			expect(entries[1].type).toBe('gauge')
			expect(entries[2].type).toBe('histogram')
		})

		it('returns a copy — mutations do not affect internal state', () => {
			const metrics = createMetrics()
			metrics.increment('hits')

			const entries = metrics.getMetrics()
			entries.pop()

			expect(metrics.getMetrics()).toHaveLength(1)
		})
	})

	describe('reset', () => {
		it('clears all metric entries', () => {
			const metrics = createMetrics()
			metrics.increment('requests')
			metrics.gauge('memory', 256)
			metrics.histogram('latency', 100)

			metrics.reset()
			expect(metrics.getMetrics()).toEqual([])
		})

		it('resets counter accumulator after reset', () => {
			const metrics = createMetrics()
			metrics.increment('hits')
			metrics.increment('hits')

			metrics.reset()
			metrics.increment('hits')

			// Counter accumulator should restart at 1
			expect(metrics.getMetrics()[0].value).toBe(1)
		})
	})

	describe('maxEntries', () => {
		it('evicts oldest entry when maxEntries is exceeded', () => {
			const metrics = createMetrics({ maxEntries: 2 })
			metrics.increment('a')
			metrics.increment('b')
			metrics.increment('c')

			const entries = metrics.getMetrics()
			expect(entries).toHaveLength(2)
			expect(entries[0].name).toBe('b')
			expect(entries[1].name).toBe('c')
		})

		it('defaults to a high maxEntries limit', () => {
			const metrics = createMetrics()
			for (let i = 0; i < 100; i++) {
				metrics.increment('op')
			}
			expect(metrics.getMetrics()).toHaveLength(100)
		})
	})

	describe('tag key ordering', () => {
		it('treats same tags in different order as the same counter key', () => {
			const metrics = createMetrics()
			metrics.increment('requests', 1, { b: '2', a: '1' })
			metrics.increment('requests', 1, { a: '1', b: '2' })

			const entries = metrics.getMetrics()
			// Both increments should accumulate on the same counter key
			expect(entries[1].value).toBe(2)
		})
	})
})
