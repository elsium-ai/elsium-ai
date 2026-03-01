import { ElsiumError } from '@elsium-ai/core'
import { gateway } from '@elsium-ai/gateway'
/**
 * Test 32: Error Handling
 * Verifies: ElsiumError shape, static factories, real auth error from invalid key
 */
import { describe, expect, it } from 'vitest'
import { describeWithLLM } from '../lib/helpers'

describeWithLLM('32 — Error Handling (Real LLM)', () => {
	it('invalid API key throws ElsiumError with AUTH_ERROR', async () => {
		const gw = gateway({
			provider: 'openai',
			apiKey: 'sk-invalid-key-for-error-test-0000',
			model: 'gpt-4o-mini',
			maxRetries: 0,
		})

		const start = Date.now()

		try {
			await gw.complete({
				messages: [{ role: 'user', content: 'Hello' }],
				maxTokens: 5,
			})
			expect.fail('Should have thrown')
		} catch (error) {
			const elapsed = Date.now() - start
			expect(error).toBeInstanceOf(ElsiumError)
			const e = error as InstanceType<typeof ElsiumError>
			expect(e.code).toBe('AUTH_ERROR')
			expect(e.retryable).toBe(false)
			// Auth errors should fail fast, not retry 3x
			expect(elapsed).toBeLessThan(10_000)
		}
	})
})

describe('32 — Error Handling (Framework)', () => {
	it('ElsiumError has correct shape', () => {
		const err = new ElsiumError({
			code: 'PROVIDER_ERROR',
			message: 'Test error',
			provider: 'openai',
			retryable: true,
		})

		expect(err.code).toBe('PROVIDER_ERROR')
		expect(err.provider).toBe('openai')
		expect(err.retryable).toBe(true)
		expect(err.message).toBe('Test error')
		expect(err).toBeInstanceOf(Error)
		expect(err).toBeInstanceOf(ElsiumError)
	})

	it('ElsiumError.rateLimit() has retryable: true', () => {
		const err = ElsiumError.rateLimit('openai')
		expect(err.code).toBe('RATE_LIMIT')
		expect(err.retryable).toBe(true)
		expect(err.provider).toBe('openai')
	})

	it('ElsiumError.authError() has retryable: false', () => {
		const err = ElsiumError.authError('openai')
		expect(err.code).toBe('AUTH_ERROR')
		expect(err.retryable).toBe(false)
		expect(err.provider).toBe('openai')
	})

	it('ElsiumError.timeout() has retryable: true', () => {
		const err = ElsiumError.timeout('openai', 5000)
		expect(err.code).toBe('TIMEOUT')
		expect(err.retryable).toBe(true)
		expect(err.provider).toBe('openai')
	})

	it('ElsiumError.validation() has retryable: false', () => {
		const err = ElsiumError.validation('Bad input')
		expect(err.code).toBe('VALIDATION_ERROR')
		expect(err.retryable).toBe(false)
	})

	it('toJSON() returns serializable object', () => {
		const err = new ElsiumError({
			code: 'PROVIDER_ERROR',
			message: 'Test',
			provider: 'openai',
			retryable: false,
		})

		const json = err.toJSON()
		expect(json.code).toBe('PROVIDER_ERROR')
		expect(json.message).toBe('Test')
		expect(json.provider).toBe('openai')
	})
})
