/**
 * Test 20: Gateway Complete (Real LLM)
 * Verifies: gateway.complete() with real OpenAI — full LLMResponse shape
 */
import { expect, it } from 'vitest'
import { assertNonEmptyString, createTestGateway, describeWithLLM } from '../lib/helpers'

describeWithLLM('20 — Gateway Complete (Real LLM)', () => {
	it('returns a full LLMResponse', async () => {
		const gw = createTestGateway()

		const response = await gw.complete({
			messages: [{ role: 'user', content: 'Say hello in one word.' }],
			maxTokens: 10,
			system: 'Keep responses under 5 words.',
		})

		assertNonEmptyString(response.id)
		expect(response.message.role).toBe('assistant')
		assertNonEmptyString(response.message.content)

		expect(response.usage.inputTokens).toBeGreaterThan(0)
		expect(response.usage.outputTokens).toBeGreaterThan(0)
		expect(response.usage.totalTokens).toBeGreaterThan(0)

		expect(response.cost.totalCost).toBeGreaterThan(0)
		expect(response.cost.currency).toBe('USD')

		expect(response.model).toBeDefined()
		expect(response.provider).toBe('openai')
		expect(response.stopReason).toBeDefined()
		expect(response.latencyMs).toBeGreaterThan(0)
		assertNonEmptyString(response.traceId)
	})

	it('respects system prompt', async () => {
		const gw = createTestGateway()

		const response = await gw.complete({
			messages: [{ role: 'user', content: 'What is 2 + 2?' }],
			maxTokens: 10,
			system: 'Always respond with just the number, nothing else.',
		})

		assertNonEmptyString(response.message.content)
		expect(response.message.content).toContain('4')
	})

	it('respects maxTokens', async () => {
		const gw = createTestGateway()

		const response = await gw.complete({
			messages: [{ role: 'user', content: 'Count from 1 to 1000.' }],
			maxTokens: 5,
		})

		expect(response.usage.outputTokens).toBeLessThanOrEqual(10)
	})
})
