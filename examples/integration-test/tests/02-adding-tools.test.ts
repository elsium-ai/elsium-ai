import { defineAgent } from '@elsium-ai/agents'
import { mockProvider } from '@elsium-ai/testing'
import { createToolkit, defineTool } from '@elsium-ai/tools'
/**
 * Test 02: Adding Tools
 * Verifies: defineTool, createToolkit, agent with tools
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { assertNonEmptyString, createTestComplete, describeWithLLM } from '../lib/helpers'

describe('02 — Adding Tools', () => {
	const weatherTool = defineTool({
		name: 'get_weather',
		description: 'Get current weather for a city',
		input: z.object({ city: z.string() }),
		handler: async (input) => ({ temp: 72, city: input.city, unit: 'F' }),
	})

	it('defineTool creates a tool with correct interface', () => {
		expect(weatherTool.name).toBe('get_weather')
		expect(weatherTool.description).toBe('Get current weather for a city')
		expect(weatherTool.timeoutMs).toBe(30_000)
	})

	it('tool.execute() validates input and runs handler', async () => {
		const result = await weatherTool.execute({ city: 'Paris' })

		expect(result.success).toBe(true)
		expect(result.data).toEqual({ temp: 72, city: 'Paris', unit: 'F' })
	})

	it('tool.toDefinition() returns a ToolDefinition', () => {
		const def = weatherTool.toDefinition()

		expect(def.name).toBe('get_weather')
		expect(def.description).toBe('Get current weather for a city')
		expect(def.inputSchema).toBeDefined()
	})

	it('createToolkit bundles tools together', () => {
		const calcTool = defineTool({
			name: 'calculate',
			description: 'Simple calculator',
			input: z.object({ expression: z.string() }),
			handler: async (input) => ({ result: input.expression }),
		})

		const toolkit = createToolkit('utilities', [weatherTool, calcTool])

		expect(toolkit.name).toBe('utilities')
		expect(toolkit.tools).toHaveLength(2)
		expect(toolkit.getTool('get_weather')).toBeDefined()
		expect(toolkit.getTool('calculate')).toBeDefined()
		expect(toolkit.getTool('nonexistent')).toBeUndefined()
	})

	it('agent with tools receives tool definitions', async () => {
		const mock = mockProvider({
			defaultResponse: { content: 'The weather is nice.' },
		})

		const agent = defineAgent(
			{
				name: 'weather-agent',
				system: 'You help with weather.',
				tools: [weatherTool],
			},
			{ complete: (req) => mock.complete(req) },
		)

		const result = await agent.run('What is the weather in Tokyo?')

		// The agent sent the tool definitions to the provider
		expect(mock.calls[0].tools).toBeDefined()
		expect(mock.calls[0].tools).toHaveLength(1)
		expect(mock.calls[0].tools?.[0].name).toBe('get_weather')
		expect(result.message.content).toBe('The weather is nice.')
	})
})

describeWithLLM('02 — Adding Tools (Real LLM)', () => {
	it('real tool-use loop: LLM calls tool, agent executes, LLM responds', async () => {
		const complete = createTestComplete()

		const weatherTool = defineTool({
			name: 'get_weather',
			description: 'Get current weather for a city. Returns temperature in Fahrenheit.',
			input: z.object({ city: z.string() }),
			handler: async (input) => ({ temp: 72, city: input.city, unit: 'F' }),
		})

		const agent = defineAgent(
			{
				name: 'weather-agent',
				system:
					'You help with weather. Always use the get_weather tool when asked about weather. Keep final responses under 20 words.',
				tools: [weatherTool],
			},
			{ complete },
		)

		const result = await agent.run('What is the weather in Paris?')

		expect(result.toolCalls.length).toBeGreaterThanOrEqual(1)
		expect(result.usage.iterations).toBeGreaterThanOrEqual(2)

		const weatherCall = result.toolCalls.find((tc) => tc.name === 'get_weather')
		expect(weatherCall).toBeDefined()
		expect(weatherCall?.result.success).toBe(true)

		assertNonEmptyString(result.message.content)
	})
})
