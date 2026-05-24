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

	it('forwards thinking config to the API body', async () => {
		let capturedBody: Record<string, unknown> | undefined
		const mockFetch = vi.fn().mockImplementation(async (_url, init) => {
			capturedBody = JSON.parse((init?.body as string) ?? '{}')
			return {
				ok: true,
				json: async () => ({
					id: 'msg_thinking',
					type: 'message',
					role: 'assistant',
					content: [{ type: 'text', text: 'Done.' }],
					model: 'claude-sonnet-4-6',
					stop_reason: 'end_turn',
					usage: { input_tokens: 5, output_tokens: 5 },
				}),
			}
		})
		vi.stubGlobal('fetch', mockFetch)

		const provider = createAnthropicProvider({ apiKey: 'test-key' })
		await provider.complete({
			messages: [{ role: 'user', content: 'Plan an itinerary.' }],
			thinking: { enabled: true, budgetTokens: 8000 },
		})

		expect(capturedBody?.thinking).toEqual({ type: 'enabled', budget_tokens: 8000 })

		vi.unstubAllGlobals()
	})

	it('derives budget_tokens from effort when budgetTokens is absent', async () => {
		let capturedBody: Record<string, unknown> | undefined
		const mockFetch = vi.fn().mockImplementation(async (_url, init) => {
			capturedBody = JSON.parse((init?.body as string) ?? '{}')
			return {
				ok: true,
				json: async () => ({
					id: 'msg_1',
					type: 'message',
					role: 'assistant',
					content: [{ type: 'text', text: 'ok' }],
					model: 'claude-sonnet-4-6',
					stop_reason: 'end_turn',
					usage: { input_tokens: 1, output_tokens: 1 },
				}),
			}
		})
		vi.stubGlobal('fetch', mockFetch)

		const provider = createAnthropicProvider({ apiKey: 'test-key' })
		await provider.complete({
			messages: [{ role: 'user', content: 'x' }],
			thinking: { enabled: true, effort: 'high' },
		})
		expect((capturedBody?.thinking as { budget_tokens: number }).budget_tokens).toBe(16000)

		vi.unstubAllGlobals()
	})

	it('emits thinking_* stream events when Anthropic returns thinking blocks', async () => {
		const events = [
			{ type: 'message_start', message: { id: 'msg_t1' } },
			{ type: 'content_block_start', content_block: { type: 'thinking', id: 'th_1' } },
			{ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Let me think…' } },
			{ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: ' step 2.' } },
			{ type: 'content_block_stop', content_block: { type: 'thinking' } },
			{ type: 'content_block_start', content_block: { type: 'text' } },
			{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Answer.' } },
			{
				type: 'message_delta',
				delta: { stop_reason: 'end_turn' },
				usage: { input_tokens: 4, output_tokens: 3 },
			},
		]
		const encoder = new TextEncoder()
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				for (const e of events) {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`))
				}
				controller.enqueue(encoder.encode('data: [DONE]\n\n'))
				controller.close()
			},
		})
		const mockFetch = vi.fn().mockResolvedValue({ ok: true, body })
		vi.stubGlobal('fetch', mockFetch)

		const provider = createAnthropicProvider({ apiKey: 'test-key' })
		const stream = provider.stream({
			messages: [{ role: 'user', content: 'x' }],
			thinking: { enabled: true, budgetTokens: 2000 },
		})

		const collected: { type: string; text?: string }[] = []
		for await (const event of stream) {
			collected.push({ type: event.type, text: 'text' in event ? event.text : undefined })
		}

		const types = collected.map((e) => e.type)
		expect(types).toContain('thinking_start')
		expect(types).toContain('thinking_delta')
		expect(types).toContain('thinking_end')
		expect(types).toContain('text_delta')
		expect(types).toContain('message_end')

		const thinkingText = collected
			.filter((e) => e.type === 'thinking_delta')
			.map((e) => e.text)
			.join('')
		expect(thinkingText).toBe('Let me think… step 2.')

		vi.unstubAllGlobals()
	})

	it('omits thinking when disabled / not requested', async () => {
		let capturedBody: Record<string, unknown> | undefined
		const mockFetch = vi.fn().mockImplementation(async (_url, init) => {
			capturedBody = JSON.parse((init?.body as string) ?? '{}')
			return {
				ok: true,
				json: async () => ({
					id: 'msg_x',
					type: 'message',
					role: 'assistant',
					content: [{ type: 'text', text: 'ok' }],
					model: 'claude-sonnet-4-6',
					stop_reason: 'end_turn',
					usage: { input_tokens: 1, output_tokens: 1 },
				}),
			}
		})
		vi.stubGlobal('fetch', mockFetch)

		const provider = createAnthropicProvider({ apiKey: 'test-key' })
		await provider.complete({
			messages: [{ role: 'user', content: 'x' }],
		})
		expect(capturedBody?.thinking).toBeUndefined()

		vi.unstubAllGlobals()
	})
})
