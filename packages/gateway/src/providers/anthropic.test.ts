import { describe, expect, it, vi } from 'vitest'
import { createAnthropicProvider } from './anthropic'

describe('Anthropic Provider', () => {
	it('should create provider with correct name and default model', () => {
		const provider = createAnthropicProvider({ apiKey: 'test-key' })
		expect(provider.name).toBe('anthropic')
		expect(provider.defaultModel).toBe('claude-sonnet-4-6')
	})

	it('should list available models', async () => {
		const provider = createAnthropicProvider({ apiKey: 'test-key' })
		const models = await provider.listModels()
		expect(models).toContain('claude-opus-4-6')
		expect(models).toContain('claude-sonnet-4-6')
	})

	it('should handle auth errors', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 401,
			text: async () => 'Unauthorized',
		})
		vi.stubGlobal('fetch', mockFetch)

		const provider = createAnthropicProvider({ apiKey: 'bad-key', maxRetries: 0 })

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

		const provider = createAnthropicProvider({ apiKey: 'test-key', maxRetries: 0 })

		await expect(
			provider.complete({ messages: [{ role: 'user', content: 'Hello' }] }),
		).rejects.toThrow()

		vi.unstubAllGlobals()
	})

	it('should not produce empty text blocks for tool-call-only assistant messages', async () => {
		let capturedBody: Record<string, unknown> | null = null

		const mockFetch = vi.fn().mockImplementation(async (_url: string, opts: RequestInit) => {
			capturedBody = JSON.parse(opts.body as string)
			return {
				ok: true,
				json: async () => ({
					id: 'msg_123',
					type: 'message',
					role: 'assistant',
					content: [{ type: 'text', text: 'Done.' }],
					model: 'claude-sonnet-4-6',
					stop_reason: 'end_turn',
					usage: { input_tokens: 20, output_tokens: 5 },
				}),
			}
		})
		vi.stubGlobal('fetch', mockFetch)

		const provider = createAnthropicProvider({ apiKey: 'test-key' })
		await provider.complete({
			messages: [
				{ role: 'user', content: 'Use the tool' },
				{
					role: 'assistant',
					content: '',
					toolCalls: [{ id: 'tc_1', name: 'get_weather', arguments: { city: 'NYC' } }],
				},
				{
					role: 'tool',
					content: '',
					toolResults: [{ toolCallId: 'tc_1', content: '{"temp": 22}' }],
				},
			],
		})

		const messages = capturedBody?.messages as Array<{
			role: string
			content: string | Array<{ type: string; text?: string }>
		}>

		// Find the assistant message with tool calls
		const assistantMsg = messages.find((m) => m.role === 'assistant')
		expect(assistantMsg).toBeDefined()

		// The content should be an array of blocks with NO empty text blocks
		const blocks = assistantMsg?.content as Array<{ type: string; text?: string }>
		expect(Array.isArray(blocks)).toBe(true)

		const emptyTextBlocks = blocks.filter((b) => b.type === 'text' && !b.text)
		expect(emptyTextBlocks).toHaveLength(0)

		// Should have the tool_use block
		const toolUseBlocks = blocks.filter((b) => b.type === 'tool_use')
		expect(toolUseBlocks).toHaveLength(1)

		vi.unstubAllGlobals()
	})

	it('should format normal text content with text block', async () => {
		let capturedBody: Record<string, unknown> | null = null

		const mockFetch = vi.fn().mockImplementation(async (_url: string, opts: RequestInit) => {
			capturedBody = JSON.parse(opts.body as string)
			return {
				ok: true,
				json: async () => ({
					id: 'msg_123',
					type: 'message',
					role: 'assistant',
					content: [{ type: 'text', text: 'Hello!' }],
					model: 'claude-sonnet-4-6',
					stop_reason: 'end_turn',
					usage: { input_tokens: 10, output_tokens: 5 },
				}),
			}
		})
		vi.stubGlobal('fetch', mockFetch)

		const provider = createAnthropicProvider({ apiKey: 'test-key' })
		await provider.complete({
			messages: [{ role: 'user', content: 'Hello' }],
		})

		const messages = capturedBody?.messages as Array<{
			role: string
			content: string | Array<{ type: string; text?: string }>
		}>

		const userMsg = messages.find((m) => m.role === 'user')
		expect(userMsg).toBeDefined()

		// User message with text should have a text block
		const blocks = userMsg?.content as Array<{ type: string; text?: string }>
		expect(Array.isArray(blocks)).toBe(true)
		expect(blocks.some((b) => b.type === 'text' && b.text === 'Hello')).toBe(true)

		vi.unstubAllGlobals()
	})

	it('should parse tool calls in response', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				id: 'msg_123',
				type: 'message',
				role: 'assistant',
				content: [{ type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'NYC' } }],
				model: 'claude-sonnet-4-6',
				stop_reason: 'tool_use',
				usage: { input_tokens: 10, output_tokens: 20 },
			}),
		})
		vi.stubGlobal('fetch', mockFetch)

		const provider = createAnthropicProvider({ apiKey: 'test-key' })
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
