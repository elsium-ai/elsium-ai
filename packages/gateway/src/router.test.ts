import { describe, expect, it, vi } from 'vitest'
import { createProviderMesh } from './router'

// Mock the gateway module
vi.mock('./gateway', () => {
	return {
		gateway: vi.fn().mockImplementation((config) => {
			const provider = config.provider as string
			return {
				provider: { name: provider, defaultModel: 'mock-model' },
				lastCall: () => null,
				callHistory: () => [],
				complete: vi.fn().mockImplementation(async (req) => ({
					id: `msg_${provider}`,
					message: { role: 'assistant', content: `Response from ${provider}` },
					usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
					cost: { inputCost: 0.001, outputCost: 0.002, totalCost: 0.003, currency: 'USD' },
					model: req.model ?? config.model ?? 'mock-model',
					provider,
					stopReason: 'end_turn',
					latencyMs: provider === 'anthropic' ? 200 : 100,
					traceId: `trc_${provider}`,
				})),
				stream: vi.fn(),
				generate: vi.fn(),
			}
		}),
	}
})

describe('createProviderMesh', () => {
	it('should throw on empty providers', () => {
		expect(() => createProviderMesh({ providers: [], strategy: 'fallback' })).toThrow(
			'at least one provider',
		)
	})

	it('should use fallback strategy', async () => {
		const mesh = createProviderMesh({
			providers: [
				{ name: 'anthropic', config: { apiKey: 'key1' }, priority: 1 },
				{ name: 'openai', config: { apiKey: 'key2' }, priority: 2 },
			],
			strategy: 'fallback',
		})

		const result = await mesh.complete({
			messages: [{ role: 'user', content: 'Hello' }],
		})

		expect(result.provider).toBe('anthropic')
		expect(mesh.providers).toContain('anthropic')
		expect(mesh.providers).toContain('openai')
	})

	it('should expose strategy and providers', () => {
		const mesh = createProviderMesh({
			providers: [{ name: 'anthropic', config: { apiKey: 'key1' }, priority: 1 }],
			strategy: 'cost-optimized',
		})

		expect(mesh.strategy).toBe('cost-optimized')
		expect(mesh.providers).toEqual(['anthropic'])
	})

	it('should sort providers by priority', async () => {
		const mesh = createProviderMesh({
			providers: [
				{ name: 'openai', config: { apiKey: 'key2' }, priority: 2 },
				{ name: 'anthropic', config: { apiKey: 'key1' }, priority: 1 },
			],
			strategy: 'fallback',
		})

		expect(mesh.providers[0]).toBe('anthropic')
		expect(mesh.providers[1]).toBe('openai')
	})

	it('should use cost-optimized strategy with simple requests', async () => {
		const mesh = createProviderMesh({
			providers: [
				{ name: 'anthropic', config: { apiKey: 'key1' }, priority: 1 },
				{ name: 'openai', config: { apiKey: 'key2' }, priority: 2 },
			],
			strategy: 'cost-optimized',
			costOptimizer: {
				simpleModel: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
				complexModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
			},
		})

		const result = await mesh.complete({
			messages: [{ role: 'user', content: 'Hi' }],
		})

		expect(result).toBeDefined()
		expect(result.model).toBe('claude-haiku-4-5-20251001')
	})

	it('should use cost-optimized strategy with complex requests', async () => {
		const mesh = createProviderMesh({
			providers: [{ name: 'anthropic', config: { apiKey: 'key1' }, priority: 1 }],
			strategy: 'cost-optimized',
			costOptimizer: {
				simpleModel: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
				complexModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
				complexityThreshold: 0.1,
			},
		})

		const result = await mesh.complete({
			messages: [{ role: 'user', content: 'A'.repeat(3000) }],
			tools: [
				{ name: 'tool1', description: 'A tool', inputSchema: {} },
				{ name: 'tool2', description: 'B tool', inputSchema: {} },
				{ name: 'tool3', description: 'C tool', inputSchema: {} },
				{ name: 'tool4', description: 'D tool', inputSchema: {} },
			],
			system: 'A'.repeat(600),
		})

		expect(result.model).toBe('claude-sonnet-4-6')
	})

	it('should use capability-aware strategy', async () => {
		const mesh = createProviderMesh({
			providers: [
				{
					name: 'anthropic',
					config: { apiKey: 'key1' },
					priority: 1,
					capabilities: ['tools', 'vision'],
				},
				{ name: 'openai', config: { apiKey: 'key2' }, priority: 2, capabilities: ['tools'] },
			],
			strategy: 'capability-aware',
		})

		const result = await mesh.complete({
			messages: [{ role: 'user', content: 'Hello' }],
			tools: [{ name: 'search', description: 'Search', inputSchema: {} }],
		})

		expect(result).toBeDefined()
	})
})
