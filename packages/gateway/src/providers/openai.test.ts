import { describe, expect, it, vi } from 'vitest'
import { createOpenAIProvider } from './openai'

describe('OpenAI Provider', () => {
	it('should create provider with correct name and default model', () => {
		const provider = createOpenAIProvider({ apiKey: 'test-key' })
		expect(provider.name).toBe('openai')
		expect(provider.defaultModel).toBe('gpt-4o')
	})

	it('should list available models', async () => {
		const provider = createOpenAIProvider({ apiKey: 'test-key' })
		const models = await provider.listModels()
		expect(models).toContain('gpt-4o')
		expect(models).toContain('gpt-4o-mini')
		expect(models).toContain('o1')
	})

	it('should handle auth errors', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 401,
			text: async () => 'Unauthorized',
		})
		vi.stubGlobal('fetch', mockFetch)

		const provider = createOpenAIProvider({ apiKey: 'bad-key', maxRetries: 0 })

		await expect(
			provider.complete({ messages: [{ role: 'user', content: 'Hello' }] }),
		).rejects.toThrow()

		vi.unstubAllGlobals()
	})

	it('should handle rate limit errors', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 429,
			text: async () => 'Rate limited',
			headers: new Headers({ 'retry-after': '5' }),
		})
		vi.stubGlobal('fetch', mockFetch)

		const provider = createOpenAIProvider({ apiKey: 'test-key', maxRetries: 0 })

		await expect(
			provider.complete({ messages: [{ role: 'user', content: 'Hello' }] }),
		).rejects.toThrow()

		vi.unstubAllGlobals()
	})

	it('should format messages correctly with system prompt', async () => {
		let capturedBody: Record<string, unknown> | null = null

		const mockFetch = vi.fn().mockImplementation(async (_url: string, opts: RequestInit) => {
			capturedBody = JSON.parse(opts.body as string)
			return {
				ok: true,
				json: async () => ({
					id: 'chatcmpl-123',
					model: 'gpt-4o',
					choices: [
						{
							index: 0,
							message: { role: 'assistant', content: 'Hi!' },
							finish_reason: 'stop',
						},
					],
					usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
				}),
			}
		})
		vi.stubGlobal('fetch', mockFetch)

		const provider = createOpenAIProvider({ apiKey: 'test-key' })
		await provider.complete({
			messages: [{ role: 'user', content: 'Hello' }],
			system: 'You are helpful.',
		})

		expect(capturedBody?.messages).toBeDefined()
		const messages = capturedBody?.messages as Array<{ role: string; content: string }>
		expect(messages[0]).toEqual({ role: 'system', content: 'You are helpful.' })
		expect(messages[1]).toEqual({ role: 'user', content: 'Hello' })

		vi.unstubAllGlobals()
	})

	it('should parse tool calls in response', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				id: 'chatcmpl-123',
				model: 'gpt-4o',
				choices: [
					{
						index: 0,
						message: {
							role: 'assistant',
							content: null,
							tool_calls: [
								{
									id: 'call_1',
									type: 'function',
									function: {
										name: 'get_weather',
										arguments: '{"city":"NYC"}',
									},
								},
							],
						},
						finish_reason: 'tool_calls',
					},
				],
				usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
			}),
		})
		vi.stubGlobal('fetch', mockFetch)

		const provider = createOpenAIProvider({ apiKey: 'test-key' })
		const result = await provider.complete({
			messages: [{ role: 'user', content: 'Weather in NYC?' }],
		})

		expect(result.message.toolCalls).toHaveLength(1)
		expect(result.message.toolCalls?.[0].name).toBe('get_weather')
		expect(result.message.toolCalls?.[0].arguments).toEqual({ city: 'NYC' })
		expect(result.stopReason).toBe('tool_use')

		vi.unstubAllGlobals()
	})
})
