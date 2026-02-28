import { describe, expect, it, vi } from 'vitest'
import { createGoogleProvider } from './google'

describe('Google Provider', () => {
	it('should create provider with correct name and default model', () => {
		const provider = createGoogleProvider({ apiKey: 'test-key' })
		expect(provider.name).toBe('google')
		expect(provider.defaultModel).toBe('gemini-2.0-flash')
	})

	it('should list available models', async () => {
		const provider = createGoogleProvider({ apiKey: 'test-key' })
		const models = await provider.listModels()
		expect(models).toContain('gemini-2.0-flash')
		expect(models).toContain('gemini-2.5-pro-preview-05-06')
	})

	it('should handle auth errors', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 403,
			text: async () => 'Forbidden',
		})
		vi.stubGlobal('fetch', mockFetch)

		const provider = createGoogleProvider({ apiKey: 'bad-key', maxRetries: 0 })

		await expect(
			provider.complete({ messages: [{ role: 'user', content: 'Hello' }] }),
		).rejects.toThrow()

		vi.unstubAllGlobals()
	})

	it('should parse response correctly', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				candidates: [
					{
						content: {
							role: 'model',
							parts: [{ text: 'Hello! How can I help?' }],
						},
						finishReason: 'STOP',
					},
				],
				usageMetadata: {
					promptTokenCount: 5,
					candidatesTokenCount: 8,
					totalTokenCount: 13,
				},
			}),
		})
		vi.stubGlobal('fetch', mockFetch)

		const provider = createGoogleProvider({ apiKey: 'test-key' })
		const result = await provider.complete({
			messages: [{ role: 'user', content: 'Hello' }],
		})

		expect(result.message.role).toBe('assistant')
		expect(result.message.content).toBe('Hello! How can I help?')
		expect(result.usage.inputTokens).toBe(5)
		expect(result.usage.outputTokens).toBe(8)
		expect(result.provider).toBe('google')
		expect(result.stopReason).toBe('end_turn')

		vi.unstubAllGlobals()
	})

	it('should format system instruction', async () => {
		let capturedBody: Record<string, unknown> | null = null

		const mockFetch = vi.fn().mockImplementation(async (_url: string, opts: RequestInit) => {
			capturedBody = JSON.parse(opts.body as string)
			return {
				ok: true,
				json: async () => ({
					candidates: [
						{
							content: { role: 'model', parts: [{ text: 'Hi!' }] },
							finishReason: 'STOP',
						},
					],
					usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 },
				}),
			}
		})
		vi.stubGlobal('fetch', mockFetch)

		const provider = createGoogleProvider({ apiKey: 'test-key' })
		await provider.complete({
			messages: [{ role: 'user', content: 'Hi' }],
			system: 'Be concise.',
		})

		expect(capturedBody?.systemInstruction).toEqual({ parts: [{ text: 'Be concise.' }] })

		vi.unstubAllGlobals()
	})

	it('should parse function calls', async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				candidates: [
					{
						content: {
							role: 'model',
							parts: [
								{
									functionCall: {
										name: 'search',
										args: { query: 'weather NYC' },
									},
								},
							],
						},
						finishReason: 'TOOL_CALLS',
					},
				],
				usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 15, totalTokenCount: 25 },
			}),
		})
		vi.stubGlobal('fetch', mockFetch)

		const provider = createGoogleProvider({ apiKey: 'test-key' })
		const result = await provider.complete({
			messages: [{ role: 'user', content: 'Search for NYC weather' }],
		})

		expect(result.message.toolCalls).toHaveLength(1)
		expect(result.message.toolCalls?.[0].name).toBe('search')
		expect(result.message.toolCalls?.[0].arguments).toEqual({ query: 'weather NYC' })
		expect(result.stopReason).toBe('tool_use')

		vi.unstubAllGlobals()
	})
})
