import { defineAgent } from '@elsium-ai/agents'
import { env } from '@elsium-ai/core'
import { mockProvider } from '@elsium-ai/testing'
/**
 * Test 01: First Agent
 * Verifies: gateway, defineAgent, agent.run(), env()
 */
import { describe, expect, it } from 'vitest'
import { assertNonEmptyString, createTestComplete, describeWithLLM } from '../lib/helpers'

describe('01 — First Agent', () => {
	it('creates a gateway-like mock and runs an agent', async () => {
		const mock = mockProvider({
			defaultResponse: { content: 'Hello, world!' },
		})

		const agent = defineAgent(
			{
				name: 'greeter',
				model: 'mock-model',
				system: 'You are a helpful assistant.',
			},
			{ complete: (req) => mock.complete(req) },
		)

		const result = await agent.run('Say hello')

		expect(result.message.role).toBe('assistant')
		expect(result.message.content).toBe('Hello, world!')
		expect(result.usage.totalTokens).toBeGreaterThan(0)
		expect(result.traceId).toBeDefined()
		expect(mock.callCount).toBe(1)
	})

	it('env() uses fallback for missing keys and throws without one', () => {
		const val = env('DEFINITELY_NOT_SET_12345', 'fallback-value')
		expect(val).toBe('fallback-value')

		expect(() => env('DEFINITELY_NOT_SET_12345')).toThrow('Missing required environment variable')
	})

	it('agent exposes name and config', () => {
		const mock = mockProvider()
		const agent = defineAgent(
			{
				name: 'test-agent',
				system: 'system prompt',
			},
			{ complete: (req) => mock.complete(req) },
		)

		expect(agent.name).toBe('test-agent')
		expect(agent.config.system).toBe('system prompt')
	})
})

describeWithLLM('01 — First Agent (Real LLM)', () => {
	it('runs an agent with real OpenAI', async () => {
		const complete = createTestComplete()

		const agent = defineAgent(
			{
				name: 'greeter',
				model: 'gpt-4o-mini',
				system: 'You are a helpful assistant. Keep responses under 10 words.',
			},
			{ complete },
		)

		const result = await agent.run('Say hello')

		expect(result.message.role).toBe('assistant')
		assertNonEmptyString(result.message.content)
		expect(result.usage.totalTokens).toBeGreaterThan(0)
		expect(result.traceId).toBeDefined()
	})
})
