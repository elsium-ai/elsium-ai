import { defineAgent } from '@elsium-ai/agents'
import { mockProvider } from '@elsium-ai/testing'
/**
 * Test 05: Testing with Mocks
 * Verifies: mockProvider, agent testing patterns
 */
import { describe, expect, it } from 'vitest'

describe('05 — Testing with mockProvider', () => {
	it('mockProvider returns canned responses in order', async () => {
		const mock = mockProvider({
			responses: [{ content: 'First response' }, { content: 'Second response' }],
			defaultResponse: { content: 'Fallback' },
		})

		const r1 = await mock.complete({ messages: [{ role: 'user', content: 'hi' }] })
		const r2 = await mock.complete({ messages: [{ role: 'user', content: 'hello' }] })
		const r3 = await mock.complete({ messages: [{ role: 'user', content: 'hey' }] })

		expect(r1.message.content).toBe('First response')
		expect(r2.message.content).toBe('Second response')
		expect(r3.message.content).toBe('Fallback')
	})

	it('mockProvider records all calls', async () => {
		const mock = mockProvider({ defaultResponse: { content: 'ok' } })

		await mock.complete({ messages: [{ role: 'user', content: 'a' }] })
		await mock.complete({ messages: [{ role: 'user', content: 'b' }] })

		expect(mock.callCount).toBe(2)
		expect(mock.calls[0].messages[0].content).toBe('a')
		expect(mock.calls[1].messages[0].content).toBe('b')
	})

	it('mockProvider.reset() clears state', async () => {
		const mock = mockProvider({
			responses: [{ content: 'first' }],
			defaultResponse: { content: 'default' },
		})

		await mock.complete({ messages: [{ role: 'user', content: 'x' }] })
		expect(mock.callCount).toBe(1)

		mock.reset()

		expect(mock.callCount).toBe(0)
		expect(mock.calls).toHaveLength(0)

		// After reset, responses start from the beginning again
		const r = await mock.complete({ messages: [{ role: 'user', content: 'y' }] })
		expect(r.message.content).toBe('first')
	})

	it('agent + mockProvider end-to-end test', async () => {
		const mock = mockProvider({
			defaultResponse: { content: 'I can help with that!' },
		})

		const agent = defineAgent(
			{ name: 'helper', system: 'You help users.' },
			{ complete: (req) => mock.complete(req) },
		)

		const result = await agent.run('Please help me')

		expect(result.message.content).toBe('I can help with that!')
		expect(result.usage.iterations).toBe(1)

		// Verify the system prompt was sent
		expect(mock.calls[0].system).toBe('You help users.')
	})

	it('mockProvider with tool_use response', async () => {
		const mock = mockProvider({
			responses: [
				{
					content: '',
					toolCalls: [{ name: 'search', arguments: { query: 'test' } }],
					stopReason: 'tool_use',
				},
			],
		})

		const r = await mock.complete({ messages: [{ role: 'user', content: 'search for test' }] })

		expect(r.stopReason).toBe('tool_use')
		expect(r.message.toolCalls).toHaveLength(1)
		expect(r.message.toolCalls?.[0].name).toBe('search')
	})
})
