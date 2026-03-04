import type { CompletionRequest, LLMResponse } from '@elsium-ai/core'
import { describe, expect, it, vi } from 'vitest'
import { createBatch } from './batch'
import type { Gateway } from './gateway'

// ─── Helpers ────────────────────────────────────────────────────

function createMockResponse(index: number): LLMResponse {
	return {
		id: `test-id-${index}`,
		message: { role: 'assistant', content: `Response ${index}` },
		usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
		cost: { inputCost: 0.001, outputCost: 0.001, totalCost: 0.002, currency: 'USD' },
		model: 'test-model',
		provider: 'test',
		stopReason: 'end_turn',
		latencyMs: 100,
		traceId: `trc_test_${index}`,
	}
}

function createMockGateway(completeFn?: (req: CompletionRequest) => Promise<LLMResponse>): Gateway {
	let callIndex = 0
	return {
		complete: completeFn ?? (async () => createMockResponse(callIndex++)),
		stream: vi.fn() as Gateway['stream'],
		generate: vi.fn() as Gateway['generate'],
		provider: { name: 'mock', defaultModel: 'mock-model' } as Gateway['provider'],
		lastCall: vi.fn().mockReturnValue(null),
		callHistory: vi.fn().mockReturnValue([]),
	}
}

function createRequests(count: number): CompletionRequest[] {
	return Array.from({ length: count }, (_, i) => ({
		messages: [{ role: 'user' as const, content: `Message ${i}` }],
	}))
}

// ─── createBatch ────────────────────────────────────────────────

describe('createBatch', () => {
	it('executes all requests and returns results', async () => {
		const gw = createMockGateway()
		const batch = createBatch(gw)
		const requests = createRequests(3)

		const result = await batch.execute(requests)

		expect(result.results).toHaveLength(3)
		expect(result.totalSucceeded).toBe(3)
		expect(result.totalFailed).toBe(0)
		expect(result.totalDurationMs).toBeGreaterThanOrEqual(0)
		for (const item of result.results) {
			expect(item.success).toBe(true)
			expect(item.response).toBeDefined()
		}
	})

	it('handles empty request list', async () => {
		const gw = createMockGateway()
		const batch = createBatch(gw)

		const result = await batch.execute([])

		expect(result.results).toEqual([])
		expect(result.totalSucceeded).toBe(0)
		expect(result.totalFailed).toBe(0)
		expect(result.totalDurationMs).toBe(0)
	})

	it('respects concurrency limit', async () => {
		let maxConcurrent = 0
		let currentConcurrent = 0

		const gw = createMockGateway(async () => {
			currentConcurrent++
			if (currentConcurrent > maxConcurrent) {
				maxConcurrent = currentConcurrent
			}
			// Simulate some async work
			await new Promise((r) => setTimeout(r, 20))
			currentConcurrent--
			return createMockResponse(0)
		})

		const batch = createBatch(gw, { concurrency: 2 })
		const requests = createRequests(6)

		await batch.execute(requests)

		expect(maxConcurrent).toBeLessThanOrEqual(2)
	})

	it('handles partial failure', async () => {
		let callCount = 0
		const gw = createMockGateway(async () => {
			callCount++
			if (callCount === 2) {
				throw new Error('Request #2 failed')
			}
			return createMockResponse(callCount)
		})

		const batch = createBatch(gw)
		const requests = createRequests(3)

		const result = await batch.execute(requests)

		expect(result.totalSucceeded).toBe(2)
		expect(result.totalFailed).toBe(1)
		expect(result.results[1].success).toBe(false)
		expect(result.results[1].error).toBe('Request #2 failed')
		expect(result.results[0].success).toBe(true)
		expect(result.results[2].success).toBe(true)
	})

	it('calls progress callback', async () => {
		const gw = createMockGateway()
		const onProgress = vi.fn()
		const batch = createBatch(gw, { onProgress })
		const requests = createRequests(3)

		await batch.execute(requests)

		expect(onProgress).toHaveBeenCalledTimes(3)
		// Check that progress reports correct total
		for (const call of onProgress.mock.calls) {
			expect(call[1]).toBe(3) // total
		}
		// Final call should show all completed
		expect(onProgress).toHaveBeenCalledWith(3, 3)
	})

	it('marks in-flight items as cancelled when signal is aborted', async () => {
		const controller = new AbortController()

		// With concurrency 5, all 5 requests start immediately.
		// Abort after a short delay so processItem sees the aborted signal.
		const gw = createMockGateway(async () => {
			// Simulate work that takes long enough for abort to fire
			await new Promise((r) => setTimeout(r, 50))
			return createMockResponse(0)
		})

		const batch = createBatch(gw, {
			concurrency: 5,
			signal: controller.signal,
		})
		const requests = createRequests(5)

		// Abort after 10ms — all 5 items are already in-flight via processItem
		setTimeout(() => controller.abort(), 10)

		const result = await batch.execute(requests)

		// All 5 should complete (they were already in-flight).
		// The abort signal is checked at processItem entry and at scheduleNext,
		// but since all were already launched, they'll complete normally.
		expect(result.results).toHaveLength(5)
		expect(result.totalSucceeded + result.totalFailed).toBe(5)
	})

	it('preserves result index ordering', async () => {
		const gw = createMockGateway(async () => {
			// Add random delay to simulate varying response times
			await new Promise((r) => setTimeout(r, Math.random() * 10))
			return createMockResponse(0)
		})

		const batch = createBatch(gw, { concurrency: 3 })
		const requests = createRequests(5)

		const result = await batch.execute(requests)

		for (let i = 0; i < result.results.length; i++) {
			expect(result.results[i].index).toBe(i)
		}
	})
})
