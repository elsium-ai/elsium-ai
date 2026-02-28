import { describe, expect, it } from 'vitest'
import { bulkheadMiddleware, createBulkhead } from './bulkhead'

describe('Bulkhead', () => {
	it('allows concurrent executions up to limit', async () => {
		const bh = createBulkhead({ maxConcurrent: 2 })

		let concurrent = 0
		let maxConcurrentSeen = 0

		const task = async () => {
			concurrent++
			maxConcurrentSeen = Math.max(maxConcurrentSeen, concurrent)
			await new Promise((r) => setTimeout(r, 50))
			concurrent--
			return 'done'
		}

		await Promise.all([bh.execute(task), bh.execute(task)])
		expect(maxConcurrentSeen).toBe(2)
	})

	it('queues when at capacity', async () => {
		const bh = createBulkhead({ maxConcurrent: 1, maxQueued: 5 })

		const results: number[] = []
		const task = (n: number) => async () => {
			await new Promise((r) => setTimeout(r, 20))
			results.push(n)
			return n
		}

		await Promise.all([bh.execute(task(1)), bh.execute(task(2)), bh.execute(task(3))])

		expect(results).toHaveLength(3)
	})

	it('rejects when queue is full', async () => {
		const bh = createBulkhead({ maxConcurrent: 1, maxQueued: 1 })

		const slow = async () => {
			await new Promise((r) => setTimeout(r, 200))
			return 'done'
		}

		const p1 = bh.execute(slow)
		const p2 = bh.execute(slow) // queued
		const p3 = bh.execute(slow) // should reject

		await expect(p3).rejects.toThrow()
		await p1
		await p2
	})

	it('reports active and queued counts', async () => {
		const bh = createBulkhead({ maxConcurrent: 1, maxQueued: 5 })

		expect(bh.active).toBe(0)
		expect(bh.queued).toBe(0)

		let resolveTask: () => void
		const blockingTask = new Promise<void>((r) => {
			resolveTask = r
		})

		const p = bh.execute(async () => {
			await blockingTask
			return 'done'
		})

		// Allow microtask to proceed
		await new Promise((r) => setTimeout(r, 10))
		expect(bh.active).toBe(1)

		resolveTask?.()
		await p
		expect(bh.active).toBe(0)
	})

	it('times out queued tasks', async () => {
		const bh = createBulkhead({ maxConcurrent: 1, maxQueued: 5, queueTimeoutMs: 50 })

		const blockForever = async () => {
			await new Promise((r) => setTimeout(r, 5000))
			return 'done'
		}

		const p1 = bh.execute(blockForever)
		const p2 = bh.execute(async () => 'queued') // will timeout

		await expect(p2).rejects.toThrow('Bulkhead queue timeout')

		// Clean up p1 - we don't care about it
		p1.catch(() => {})
	})
})

describe('bulkheadMiddleware', () => {
	it('creates valid middleware', () => {
		const mw = bulkheadMiddleware()
		expect(typeof mw).toBe('function')
	})
})
