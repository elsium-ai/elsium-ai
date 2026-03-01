import { ElsiumError, createCircuitBreaker, createDedup } from '@elsium-ai/core'
import { createBulkhead } from '@elsium-ai/gateway'
/**
 * Test 30: Concurrency Primitives
 * Verifies: bulkhead, dedup, circuit breaker — all framework tests (no API key needed)
 */
import { describe, expect, it } from 'vitest'

describe('30 — Concurrency: Bulkhead', () => {
	it('limits concurrent execution to maxConcurrent', async () => {
		const bulkhead = createBulkhead({ maxConcurrent: 2, maxQueued: 10 })
		let peakActive = 0
		let currentActive = 0

		const tasks = Array.from({ length: 5 }, () =>
			bulkhead.execute(async () => {
				currentActive++
				peakActive = Math.max(peakActive, currentActive)
				await new Promise((r) => setTimeout(r, 50))
				currentActive--
				return 'done'
			}),
		)

		const results = await Promise.all(tasks)
		expect(results).toHaveLength(5)
		expect(results.every((r) => r === 'done')).toBe(true)
		expect(peakActive).toBeLessThanOrEqual(2)
	})

	it('rejects when queue is full', async () => {
		const bulkhead = createBulkhead({ maxConcurrent: 1, maxQueued: 1 })

		const slow = () => new Promise((r) => setTimeout(r, 200))

		// First task: runs immediately
		const t1 = bulkhead.execute(slow)
		// Second task: queued
		const t2 = bulkhead.execute(slow)
		// Third task: should be rejected (queue full)
		await expect(bulkhead.execute(slow)).rejects.toThrow()

		await Promise.all([t1, t2])
	})
})

describe('30 — Concurrency: Dedup', () => {
	it('coalesces concurrent calls with same key', async () => {
		const dedup = createDedup({ ttlMs: 1000 })
		let execCount = 0

		const fn = async () => {
			execCount++
			await new Promise((r) => setTimeout(r, 50))
			return 'result'
		}

		const [r1, r2] = await Promise.all([
			dedup.deduplicate('key-1', fn),
			dedup.deduplicate('key-1', fn),
		])

		expect(r1).toBe('result')
		expect(r2).toBe('result')
		expect(execCount).toBe(1)
	})

	it('re-executes after TTL expiry', async () => {
		const dedup = createDedup({ ttlMs: 50 })
		let execCount = 0

		const fn = async () => {
			execCount++
			return `call-${execCount}`
		}

		const r1 = await dedup.deduplicate('key-2', fn)
		expect(r1).toBe('call-1')

		// Wait for TTL to expire
		await new Promise((r) => setTimeout(r, 100))

		const r2 = await dedup.deduplicate('key-2', fn)
		expect(r2).toBe('call-2')
		expect(execCount).toBe(2)
	})
})

describe('30 — Concurrency: Circuit Breaker', () => {
	it('opens after failure threshold and rejects calls', async () => {
		const stateChanges: Array<{ from: string; to: string }> = []
		const cb = createCircuitBreaker({
			failureThreshold: 3,
			resetTimeoutMs: 500,
			windowMs: 5000,
			onStateChange: (from, to) => stateChanges.push({ from, to }),
			shouldCount: () => true,
		})

		const fail = async () => {
			throw new Error('fail')
		}

		// Trigger 3 failures
		for (let i = 0; i < 3; i++) {
			try {
				await cb.execute(fail)
			} catch {
				// expected
			}
		}

		expect(cb.state).toBe('open')

		// Next call should be rejected immediately
		await expect(cb.execute(async () => 'ok')).rejects.toThrow()
	})

	it('transitions through half-open back to closed on success', async () => {
		const cb = createCircuitBreaker({
			failureThreshold: 3,
			resetTimeoutMs: 100,
			windowMs: 5000,
			shouldCount: () => true,
		})

		const fail = async () => {
			throw new Error('fail')
		}

		// Open the circuit
		for (let i = 0; i < 3; i++) {
			try {
				await cb.execute(fail)
			} catch {
				// expected
			}
		}
		expect(cb.state).toBe('open')

		// Wait for resetTimeout
		await new Promise((r) => setTimeout(r, 150))

		// Should transition to half-open, then closed on success
		const result = await cb.execute(async () => 'recovered')
		expect(result).toBe('recovered')
		expect(cb.state).toBe('closed')
	})
})
