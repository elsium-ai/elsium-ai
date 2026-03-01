import { defineAgent } from '@elsium-ai/agents'
import { createMemory } from '@elsium-ai/agents'
import { mockProvider } from '@elsium-ai/testing'
/**
 * Test 28: Memory Persistence
 * Verifies: multi-turn memory, resetMemory(), memory strategies
 */
import { describe, expect, it } from 'vitest'
import { assertNonEmptyString, createTestComplete, describeWithLLM } from '../lib/helpers'

describeWithLLM('28 — Memory Persistence (Real LLM)', () => {
	it('agent remembers across run() calls', async () => {
		const complete = createTestComplete()
		const agent = defineAgent(
			{
				name: 'memory-test',
				system: 'You are a helpful assistant. Remember everything the user tells you.',
				memory: { strategy: 'unlimited' },
			},
			{ complete },
		)

		await agent.run('My name is Zephyr. Remember it.')

		const result = await agent.run('What is my name?')
		assertNonEmptyString(result.message.content)
		expect(result.message.content.toLowerCase()).toContain('zephyr')
	})

	it('resetMemory() clears context', async () => {
		const complete = createTestComplete()
		const agent = defineAgent(
			{
				name: 'reset-test',
				system: 'You are a helpful assistant. If you do not know the answer, say "I don\'t know".',
				memory: { strategy: 'unlimited' },
			},
			{ complete },
		)

		await agent.run('My name is Zephyr.')
		agent.resetMemory()

		const result = await agent.run('What is my name?')
		assertNonEmptyString(result.message.content)
		expect(result.message.content.toLowerCase()).not.toContain('zephyr')
	})

	it('chat() with conversation history works', async () => {
		const complete = createTestComplete()
		const agent = defineAgent(
			{
				name: 'chat-test',
				system: 'You are a helpful assistant.',
			},
			{ complete },
		)

		const result = await agent.chat([
			{ role: 'user', content: 'My favorite color is blue.' },
			{ role: 'assistant', content: 'Got it, blue!' },
			{ role: 'user', content: 'What is my favorite color?' },
		])

		assertNonEmptyString(result.message.content)
		expect(result.message.content.toLowerCase()).toContain('blue')
	})
})

describe('28 — Memory Persistence (Framework)', () => {
	it('sliding-window with maxMessages=3 trims old messages', () => {
		const memory = createMemory({ strategy: 'sliding-window', maxMessages: 3 })

		for (let i = 0; i < 5; i++) {
			memory.add({ role: 'user', content: `Message ${i}` })
		}

		expect(memory.getMessages().length).toBe(3)
	})

	it('token-limited with maxTokens=50 trims old messages', () => {
		const memory = createMemory({ strategy: 'token-limited', maxTokens: 50 })

		for (let i = 0; i < 10; i++) {
			memory.add({ role: 'user', content: 'This is a moderately long message that uses tokens.' })
		}

		const estimate = memory.getTokenEstimate()
		expect(estimate).toBeLessThanOrEqual(50)
	})

	it('unlimited retains all messages', () => {
		const memory = createMemory({ strategy: 'unlimited' })

		for (let i = 0; i < 100; i++) {
			memory.add({ role: 'user', content: `Message ${i}` })
		}

		expect(memory.getMessages().length).toBe(100)
	})
})
