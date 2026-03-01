/**
 * Test 21: Gateway Stream (Real LLM)
 * Verifies: gateway.stream() — event types, .toText(), .toResponse()
 */
import { expect, it } from 'vitest'
import { assertNonEmptyString, createTestGateway, describeWithLLM } from '../lib/helpers'

describeWithLLM('21 — Gateway Stream (Real LLM)', () => {
	it('yields message_start, text_delta, and message_end events', async () => {
		const gw = createTestGateway()

		const stream = gw.stream({
			messages: [{ role: 'user', content: 'Say hello.' }],
			maxTokens: 20,
			system: 'Keep responses under 10 words.',
		})

		const eventTypes = new Set<string>()
		for await (const event of stream) {
			eventTypes.add(event.type)
		}

		expect(eventTypes.has('message_start')).toBe(true)
		expect(eventTypes.has('text_delta')).toBe(true)
		expect(eventTypes.has('message_end')).toBe(true)
	})

	it('toText() returns concatenated text', async () => {
		const gw = createTestGateway()

		const stream = gw.stream({
			messages: [{ role: 'user', content: 'Say "hi".' }],
			maxTokens: 10,
			system: 'Respond with just one word.',
		})

		const text = await stream.toText()
		assertNonEmptyString(text)
	})

	it('toResponse() returns text, usage, and stopReason', async () => {
		const gw = createTestGateway()

		const stream = gw.stream({
			messages: [{ role: 'user', content: 'What is 1+1?' }],
			maxTokens: 10,
			system: 'Respond with just the number.',
		})

		const result = await stream.toResponse()

		assertNonEmptyString(result.text)
		expect(result.usage).not.toBeNull()
		expect(result.usage?.totalTokens).toBeGreaterThan(0)
		expect(result.stopReason).not.toBeNull()
	})
})
