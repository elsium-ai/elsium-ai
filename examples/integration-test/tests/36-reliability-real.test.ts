import { createCircuitBreaker } from '@elsium-ai/core'
import { createBulkhead, gateway } from '@elsium-ai/gateway'
/**
 * Test 36: Reliability with Real LLM
 * Verifies: circuit breaker with real failures, bulkhead with real concurrency
 */
import { expect, it } from 'vitest'
import { describeWithLLM } from '../lib/helpers'

describeWithLLM('36 — Reliability (Real LLM)', () => {
	it('circuit breaker opens after 3 failures with invalid key', async () => {
		const cb = createCircuitBreaker({
			failureThreshold: 3,
			resetTimeoutMs: 30_000,
			windowMs: 60_000,
			shouldCount: () => true,
		})

		const gw = gateway({
			provider: 'openai',
			apiKey: 'sk-invalid-key-for-cb-test-0000',
			model: 'gpt-4o-mini',
			maxRetries: 0,
		})

		for (let i = 0; i < 3; i++) {
			try {
				await cb.execute(() =>
					gw.complete({
						messages: [{ role: 'user', content: 'Hello' }],
						maxTokens: 5,
					}),
				)
			} catch {
				// Expected auth failures
			}
		}

		expect(cb.state).toBe('open')

		await expect(
			cb.execute(() =>
				gw.complete({
					messages: [{ role: 'user', content: 'Hello' }],
					maxTokens: 5,
				}),
			),
		).rejects.toThrow('Circuit breaker is open')
	})

	it('bulkhead limits concurrent real calls', async () => {
		const bulkhead = createBulkhead({ maxConcurrent: 2, maxQueued: 10 })
		const apiKey = process.env.OPENAI_API_KEY as string

		const gw = gateway({
			provider: 'openai',
			apiKey,
			model: 'gpt-4o-mini',
		})

		let peakActive = 0
		let currentActive = 0

		const makeCall = () =>
			bulkhead.execute(async () => {
				currentActive++
				peakActive = Math.max(peakActive, currentActive)
				try {
					const response = await gw.complete({
						messages: [{ role: 'user', content: 'Say one word' }],
						maxTokens: 5,
					})
					return response
				} finally {
					currentActive--
				}
			})

		const results = await Promise.all([makeCall(), makeCall(), makeCall(), makeCall()])

		expect(results).toHaveLength(4)
		expect(peakActive).toBeLessThanOrEqual(2)
		for (const r of results) {
			expect(r.message.content.length).toBeGreaterThan(0)
		}
	})
})
