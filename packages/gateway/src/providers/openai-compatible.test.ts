import { describe, expect, it, vi } from 'vitest'
import { createOpenAICompatibleProvider } from './openai-compatible'

vi.mock('./openai', () => ({
	createOpenAIProvider: vi.fn(() => ({
		name: 'openai',
		defaultModel: 'gpt-4o',
		metadata: {},
		complete: vi.fn(async () => ({
			id: 'test-id',
			message: { role: 'assistant', content: 'hello' },
			usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
			cost: { totalCost: 0.001, inputCost: 0.0005, outputCost: 0.0005 },
			model: 'llama-3',
			provider: 'openai',
			stopReason: 'end_turn',
			latencyMs: 100,
			traceId: 'trace-1',
		})),
		stream: vi.fn(() => ({
			[Symbol.asyncIterator]: () => ({
				next: () => Promise.resolve({ done: true, value: undefined }),
			}),
		})),
		listModels: vi.fn(async () => ['gpt-4o']),
	})),
}))

describe('createOpenAICompatibleProvider', () => {
	it('uses the custom provider name', () => {
		const provider = createOpenAICompatibleProvider({
			apiKey: 'test-key',
			baseUrl: 'http://localhost:11434',
			name: 'ollama',
		})

		expect(provider.name).toBe('ollama')
	})

	it('defaults name to openai-compatible', () => {
		const provider = createOpenAICompatibleProvider({
			apiKey: 'test-key',
			baseUrl: 'http://localhost:11434',
		})

		expect(provider.name).toBe('openai-compatible')
	})

	it('uses custom defaultModel', () => {
		const provider = createOpenAICompatibleProvider({
			apiKey: 'test-key',
			baseUrl: 'http://localhost:11434',
			defaultModel: 'llama-3.1',
		})

		expect(provider.defaultModel).toBe('llama-3.1')
	})

	it('returns custom provider name in complete() response', async () => {
		const provider = createOpenAICompatibleProvider({
			apiKey: 'test-key',
			baseUrl: 'http://localhost:11434',
			name: 'groq',
		})

		const response = await provider.complete({
			messages: [{ role: 'user', content: 'hi' }],
		})

		expect(response.provider).toBe('groq')
	})

	it('uses custom capabilities in metadata', () => {
		const provider = createOpenAICompatibleProvider({
			apiKey: 'test-key',
			baseUrl: 'http://localhost:8000',
			capabilities: ['tools', 'streaming'],
		})

		expect(provider.metadata?.capabilities).toEqual(['tools', 'streaming'])
	})

	it('sets metadata baseUrl correctly', () => {
		const provider = createOpenAICompatibleProvider({
			apiKey: 'test-key',
			baseUrl: 'http://localhost:11434',
		})

		expect(provider.metadata?.baseUrl).toBe('http://localhost:11434/v1/chat/completions')
	})
})
