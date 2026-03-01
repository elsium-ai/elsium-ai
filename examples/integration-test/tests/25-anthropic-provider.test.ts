/**
 * Test 25: Anthropic Provider (Real LLM)
 * Verifies: gateway.complete() and stream() with real Anthropic — full LLMResponse shape
 */
import { expect, it } from 'vitest'
import { assertNonEmptyString, createAnthropicGateway, describeWithAnthropic } from '../lib/helpers'

describeWithAnthropic('25 — Anthropic Provider (Real LLM)', () => {
	it('complete() returns a full LLMResponse', async () => {
		const gw = createAnthropicGateway()

		const response = await gw.complete({
			messages: [{ role: 'user', content: 'Say hello in one word.' }],
			maxTokens: 20,
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

		expect(response.provider).toBe('anthropic')
		expect(response.model).toBeDefined()
		expect(response.stopReason).toBeDefined()
		expect(response.latencyMs).toBeGreaterThan(0)
		assertNonEmptyString(response.traceId)
	})

	it('stream() emits events and collects text', async () => {
		const gw = createAnthropicGateway()

		const stream = gw.stream({
			messages: [{ role: 'user', content: 'Say hello.' }],
			maxTokens: 20,
			system: 'Respond in one word.',
		})

		const text = await stream.toText()
		assertNonEmptyString(text)
	})

	it('stream().toResponse() returns usage and stopReason', async () => {
		const gw = createAnthropicGateway()

		const stream = gw.stream({
			messages: [{ role: 'user', content: 'Say hi.' }],
			maxTokens: 20,
			system: 'Respond in one word.',
		})

		const result = await stream.toResponse()
		assertNonEmptyString(result.text)
		expect(result.usage).not.toBeNull()
		expect(result.usage?.inputTokens).toBeGreaterThan(0)
		expect(result.stopReason).toBeDefined()
	})

	it('respects system prompt', async () => {
		const gw = createAnthropicGateway()

		const response = await gw.complete({
			messages: [{ role: 'user', content: 'What is 2+2?' }],
			maxTokens: 20,
			system: 'Always respond with just the number, nothing else.',
		})

		assertNonEmptyString(response.message.content)
		expect(response.message.content).toContain('4')
	})
})
