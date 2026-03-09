import { ElsiumStream } from '@elsium-ai/core'
import { describe, expect, it, vi } from 'vitest'
import * as gatewayModule from './gateway'
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
				{ name: 'anthropic', config: { apiKey: 'key1' } },
				{ name: 'openai', config: { apiKey: 'key2' } },
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
			providers: [{ name: 'anthropic', config: { apiKey: 'key1' } }],
			strategy: 'cost-optimized',
		})

		expect(mesh.strategy).toBe('cost-optimized')
		expect(mesh.providers).toEqual(['anthropic'])
	})

	it('should preserve array order', () => {
		const mesh = createProviderMesh({
			providers: [
				{ name: 'openai', config: { apiKey: 'key2' } },
				{ name: 'anthropic', config: { apiKey: 'key1' } },
			],
			strategy: 'fallback',
		})

		expect(mesh.providers[0]).toBe('openai')
		expect(mesh.providers[1]).toBe('anthropic')
	})

	it('should use cost-optimized strategy with simple requests', async () => {
		const mesh = createProviderMesh({
			providers: [
				{ name: 'anthropic', config: { apiKey: 'key1' } },
				{ name: 'openai', config: { apiKey: 'key2' } },
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
			providers: [{ name: 'anthropic', config: { apiKey: 'key1' } }],
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

	it('should route reasoning keywords to complex model', async () => {
		const mesh = createProviderMesh({
			providers: [{ name: 'anthropic', config: { apiKey: 'key1' } }],
			strategy: 'cost-optimized',
			costOptimizer: {
				simpleModel: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
				complexModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
			},
		})

		const result = await mesh.complete({
			messages: [{ role: 'user', content: 'Prove that P ≠ NP' }],
		})

		expect(result.model).toBe('claude-sonnet-4-6')
	})

	it('should route math keywords to complex model', async () => {
		const mesh = createProviderMesh({
			providers: [{ name: 'anthropic', config: { apiKey: 'key1' } }],
			strategy: 'cost-optimized',
			costOptimizer: {
				simpleModel: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
				complexModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
			},
		})

		const result = await mesh.complete({
			messages: [{ role: 'user', content: 'Solve this integral for x' }],
		})

		expect(result.model).toBe('claude-sonnet-4-6')
	})

	it('should route code keywords to complex model', async () => {
		const mesh = createProviderMesh({
			providers: [{ name: 'anthropic', config: { apiKey: 'key1' } }],
			strategy: 'cost-optimized',
			costOptimizer: {
				simpleModel: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
				complexModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
			},
		})

		const result = await mesh.complete({
			messages: [{ role: 'user', content: 'Refactor this function to use async iterators' }],
		})

		expect(result.model).toBe('claude-sonnet-4-6')
	})

	it('should keep simple greetings on simple model', async () => {
		const mesh = createProviderMesh({
			providers: [{ name: 'anthropic', config: { apiKey: 'key1' } }],
			strategy: 'cost-optimized',
			costOptimizer: {
				simpleModel: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
				complexModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
			},
		})

		const result = await mesh.complete({
			messages: [{ role: 'user', content: 'Hello, how are you?' }],
		})

		expect(result.model).toBe('claude-haiku-4-5-20251001')
	})

	it('should detect keywords in structured content blocks', async () => {
		const mesh = createProviderMesh({
			providers: [{ name: 'anthropic', config: { apiKey: 'key1' } }],
			strategy: 'cost-optimized',
			costOptimizer: {
				simpleModel: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
				complexModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
			},
		})

		const result = await mesh.complete({
			messages: [
				{
					role: 'user',
					content: [{ type: 'text', text: 'Analyze the performance of this algorithm' }],
				},
			],
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
				{ name: 'openai', config: { apiKey: 'key2' }, capabilities: ['tools'] },
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

describe('ProviderMesh audit integration', () => {
	it('should log provider_failover when falling back to next provider', async () => {
		const auditLog = vi.fn()

		vi.mocked(gatewayModule.gateway).mockImplementation((config) => {
			const provider = config.provider as string
			return {
				provider: { name: provider, defaultModel: 'mock-model' },
				lastCall: () => null,
				callHistory: () => [],
				complete: vi.fn().mockImplementation(async (req) => {
					if (provider === 'anthropic') throw new Error('rate limited')
					return {
						id: `msg_${provider}`,
						message: { role: 'assistant', content: `Response from ${provider}` },
						usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
						cost: { inputCost: 0.001, outputCost: 0.002, totalCost: 0.003, currency: 'USD' },
						model: req.model ?? config.model ?? 'mock-model',
						provider,
						stopReason: 'end_turn',
						latencyMs: 100,
						traceId: `trc_${provider}`,
					}
				}),
				stream: vi.fn(),
				generate: vi.fn(),
			}
		})

		const mesh = createProviderMesh({
			providers: [
				{ name: 'anthropic', config: { apiKey: 'key1' } },
				{ name: 'openai', config: { apiKey: 'key2' } },
			],
			strategy: 'fallback',
			audit: { log: auditLog },
		})

		const result = await mesh.complete({
			messages: [{ role: 'user', content: 'Hello' }],
		})

		expect(result.provider).toBe('openai')
		expect(auditLog).toHaveBeenCalledWith(
			'provider_failover',
			expect.objectContaining({
				fromProvider: 'anthropic',
				toProvider: 'openai',
				strategy: 'fallback',
				reason: 'rate limited',
			}),
		)
	})

	it('should not log failover when first provider succeeds', async () => {
		const auditLog = vi.fn()

		vi.mocked(gatewayModule.gateway).mockImplementation((config) => {
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
					latencyMs: 100,
					traceId: `trc_${provider}`,
				})),
				stream: vi.fn(),
				generate: vi.fn(),
			}
		})

		const mesh = createProviderMesh({
			providers: [
				{ name: 'anthropic', config: { apiKey: 'key1' } },
				{ name: 'openai', config: { apiKey: 'key2' } },
			],
			strategy: 'fallback',
			audit: { log: auditLog },
		})

		await mesh.complete({
			messages: [{ role: 'user', content: 'Hello' }],
		})

		expect(auditLog).not.toHaveBeenCalled()
	})

	it('should log circuit_breaker_state_change when breaker trips', async () => {
		const auditLog = vi.fn()

		vi.mocked(gatewayModule.gateway).mockImplementation((config) => {
			const provider = config.provider as string
			return {
				provider: { name: provider, defaultModel: 'mock-model' },
				lastCall: () => null,
				callHistory: () => [],
				complete: vi.fn().mockRejectedValue(new Error('provider down')),
				stream: vi.fn(),
				generate: vi.fn(),
			}
		})

		const mesh = createProviderMesh({
			providers: [{ name: 'anthropic', config: { apiKey: 'key1' } }],
			strategy: 'fallback',
			circuitBreaker: { failureThreshold: 1 },
			audit: { log: auditLog },
		})

		await expect(mesh.complete({ messages: [{ role: 'user', content: 'Hi' }] })).rejects.toThrow()

		expect(auditLog).toHaveBeenCalledWith(
			'circuit_breaker_state_change',
			expect.objectContaining({
				provider: 'anthropic',
				fromState: 'closed',
				toState: 'open',
			}),
		)
	})

	it('should preserve user-provided onStateChange callback', async () => {
		const auditLog = vi.fn()
		const userCallback = vi.fn()

		vi.mocked(gatewayModule.gateway).mockImplementation((config) => {
			const provider = config.provider as string
			return {
				provider: { name: provider, defaultModel: 'mock-model' },
				lastCall: () => null,
				callHistory: () => [],
				complete: vi.fn().mockRejectedValue(new Error('provider down')),
				stream: vi.fn(),
				generate: vi.fn(),
			}
		})

		const mesh = createProviderMesh({
			providers: [{ name: 'anthropic', config: { apiKey: 'key1' } }],
			strategy: 'fallback',
			circuitBreaker: { failureThreshold: 1, onStateChange: userCallback },
			audit: { log: auditLog },
		})

		await expect(mesh.complete({ messages: [{ role: 'user', content: 'Hi' }] })).rejects.toThrow()

		expect(userCallback).toHaveBeenCalledWith('closed', 'open')
		expect(auditLog).toHaveBeenCalledWith(
			'circuit_breaker_state_change',
			expect.objectContaining({ fromState: 'closed', toState: 'open' }),
		)
	})

	it('should log failover in cost-optimized strategy when primary fails', async () => {
		const auditLog = vi.fn()

		vi.mocked(gatewayModule.gateway).mockImplementation((config) => {
			const provider = config.provider as string
			return {
				provider: { name: provider, defaultModel: 'mock-model' },
				lastCall: () => null,
				callHistory: () => [],
				complete: vi.fn().mockImplementation(async (req) => {
					if (req.model === 'claude-haiku-4-5-20251001') throw new Error('haiku down')
					return {
						id: `msg_${provider}`,
						message: { role: 'assistant', content: `Response from ${provider}` },
						usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
						cost: { inputCost: 0.001, outputCost: 0.002, totalCost: 0.003, currency: 'USD' },
						model: req.model ?? config.model ?? 'mock-model',
						provider,
						stopReason: 'end_turn',
						latencyMs: 100,
						traceId: `trc_${provider}`,
					}
				}),
				stream: vi.fn(),
				generate: vi.fn(),
			}
		})

		const mesh = createProviderMesh({
			providers: [
				{ name: 'anthropic', config: { apiKey: 'key1' } },
				{ name: 'openai', config: { apiKey: 'key2' } },
			],
			strategy: 'cost-optimized',
			costOptimizer: {
				simpleModel: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
				complexModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
			},
			audit: { log: auditLog },
		})

		await mesh.complete({
			messages: [{ role: 'user', content: 'Hello' }],
		})

		expect(auditLog).toHaveBeenCalledWith(
			'provider_failover',
			expect.objectContaining({
				fromProvider: 'anthropic',
				toProvider: 'fallback-chain',
				strategy: 'cost-optimized',
				reason: 'haiku down',
			}),
		)
	})
})

describe('ProviderMesh stream() circuit breaker integration', () => {
	it('should call the gateway stream when circuit breaker is closed', () => {
		const mockStream = new ElsiumStream(
			(async function* () {
				yield { type: 'text_delta' as const, text: 'hello' }
			})(),
		)

		const streamMock = vi.fn().mockReturnValue(mockStream)
		vi.mocked(gatewayModule.gateway).mockImplementationOnce((config) => {
			const provider = config.provider as string
			return {
				provider: { name: provider, defaultModel: 'mock-model' },
				lastCall: () => null,
				callHistory: () => [],
				complete: vi.fn(),
				stream: streamMock,
				generate: vi.fn(),
			}
		})

		const mesh = createProviderMesh({
			providers: [{ name: 'anthropic', config: { apiKey: 'key1' } }],
			strategy: 'fallback',
			circuitBreaker: true,
		})

		const result = mesh.stream({ messages: [{ role: 'user', content: 'Hi' }] })

		expect(streamMock).toHaveBeenCalledOnce()
		expect(result).toBeInstanceOf(ElsiumStream)
	})

	it('should return an error stream when circuit breaker is open', async () => {
		vi.mocked(gatewayModule.gateway).mockImplementationOnce((config) => {
			const provider = config.provider as string
			return {
				provider: { name: provider, defaultModel: 'mock-model' },
				lastCall: () => null,
				callHistory: () => [],
				complete: vi.fn().mockRejectedValue(new Error('provider down')),
				stream: vi.fn().mockReturnValue(
					new ElsiumStream(
						(async function* () {
							yield { type: 'text_delta' as const, text: 'ok' }
						})(),
					),
				),
				generate: vi.fn(),
			}
		})

		const mesh = createProviderMesh({
			providers: [{ name: 'anthropic', config: { apiKey: 'key1' } }],
			strategy: 'fallback',
			// Low threshold so one failure opens the breaker
			circuitBreaker: { failureThreshold: 1, resetTimeoutMs: 60_000 },
		})

		// Trip the circuit breaker via complete()
		await expect(mesh.complete({ messages: [{ role: 'user', content: 'Hi' }] })).rejects.toThrow(
			'provider down',
		)

		// Now the circuit breaker is open — stream() should return an error stream
		const errorStream = mesh.stream({ messages: [{ role: 'user', content: 'Hi' }] })
		expect(errorStream).toBeInstanceOf(ElsiumStream)

		const events: unknown[] = []
		for await (const event of errorStream) {
			events.push(event)
		}

		expect(events).toHaveLength(1)
		expect(events[0]).toMatchObject({
			type: 'error',
			error: expect.objectContaining({ message: 'Circuit breaker is open' }),
		})
	})
})
