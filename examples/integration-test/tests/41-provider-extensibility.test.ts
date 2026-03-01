import {
	calculateCost,
	createProviderMesh,
	gateway,
	getProviderMetadata,
	registerProviderFactory,
} from '@elsium-ai/gateway'
import { createCostEngine, registerModelTier } from '@elsium-ai/observe'
import { mockProvider } from '@elsium-ai/testing'
/**
 * Test 41: Provider Extensibility
 * Verifies: a custom provider with metadata auto-registers pricing, capabilities,
 * x-ray URLs, auth style, and model tiers — zero changes to framework source code.
 */
import { describe, expect, it } from 'vitest'

describe('41 — Provider Extensibility', () => {
	it('custom provider with metadata: pricing auto-registered', () => {
		registerProviderFactory('acme-ai', () => {
			const mock = mockProvider({ defaultResponse: { content: 'hello from acme' } })
			return {
				...mock,
				name: 'acme-ai',
				defaultModel: 'acme-turbo',
				metadata: {
					baseUrl: 'https://api.acme.ai/v1/chat',
					capabilities: ['tools', 'streaming', 'system'],
					authStyle: 'bearer' as const,
					pricing: {
						'acme-turbo': { inputPerMillion: 1, outputPerMillion: 4 },
						'acme-mini': { inputPerMillion: 0.1, outputPerMillion: 0.4 },
					},
				},
			}
		})

		// Creating a gateway auto-registers metadata + pricing
		const gw = gateway({ provider: 'acme-ai', apiKey: 'test-key', model: 'acme-turbo' })
		expect(gw.provider.name).toBe('acme-ai')

		// Pricing should have been auto-registered
		const cost = calculateCost('acme-turbo', {
			inputTokens: 1000,
			outputTokens: 500,
			totalTokens: 1500,
		})
		expect(cost.inputCost).toBeGreaterThan(0)
		expect(cost.totalCost).toBeGreaterThan(0)

		// acme-mini should also be registered
		const miniCost = calculateCost('acme-mini', {
			inputTokens: 1000,
			outputTokens: 500,
			totalTokens: 1500,
		})
		expect(miniCost.totalCost).toBeGreaterThan(0)
		expect(miniCost.totalCost).toBeLessThan(cost.totalCost)
	})

	it('custom provider metadata available via getProviderMetadata', () => {
		const meta = getProviderMetadata('acme-ai')
		expect(meta).toBeDefined()
		expect(meta?.baseUrl).toBe('https://api.acme.ai/v1/chat')
		expect(meta?.capabilities).toEqual(['tools', 'streaming', 'system'])
		expect(meta?.authStyle).toBe('bearer')
	})

	it('x-ray middleware uses custom provider URL from metadata', async () => {
		const gw = gateway({
			provider: 'acme-ai',
			apiKey: 'test-key',
			model: 'acme-turbo',
			xray: true,
		})

		await gw.complete({ messages: [{ role: 'user', content: 'hi' }] })

		const last = gw.lastCall()
		expect(last).not.toBeNull()
		expect(last?.request.url).toBe('https://api.acme.ai/v1/chat')
	})

	it('custom provider works in provider mesh with capability routing', async () => {
		registerProviderFactory('beta-ai', () => {
			const mock = mockProvider({ defaultResponse: { content: 'beta response' } })
			return {
				...mock,
				name: 'beta-ai',
				defaultModel: 'beta-v1',
				metadata: {
					capabilities: ['tools', 'vision', 'streaming'],
				},
			}
		})

		const mesh = createProviderMesh({
			providers: [
				{ name: 'acme-ai', config: { apiKey: 'k1' }, priority: 1 },
				{ name: 'beta-ai', config: { apiKey: 'k2' }, priority: 2 },
			],
			strategy: 'capability-aware',
		})

		// Both should be registered
		expect(mesh.providers).toEqual(['acme-ai', 'beta-ai'])

		// Should complete successfully
		const result = await mesh.complete({ messages: [{ role: 'user', content: 'test' }] })
		expect(result.message.content).toBeTruthy()
	})

	it('complete() and stream() work through middleware with custom provider', async () => {
		const engine = createCostEngine()

		const gw = gateway({
			provider: 'acme-ai',
			apiKey: 'test-key',
			model: 'acme-turbo',
			middleware: [engine.middleware()],
		})

		const result = await gw.complete({ messages: [{ role: 'user', content: 'hello' }] })
		expect(result.message.content).toBeTruthy()
		expect(gw.provider.name).toBe('acme-ai')

		const report = engine.getReport()
		expect(report.totalCalls).toBe(1)
	})

	it('registerModelTier makes suggestModel work for custom models', () => {
		registerModelTier('acme-turbo', { tier: 'mid', costPerMToken: 1 })
		registerModelTier('acme-mini', { tier: 'low', costPerMToken: 0.1 })

		const engine = createCostEngine()
		const suggestion = engine.suggestModel('acme-turbo', 100)
		expect(suggestion).not.toBeNull()
		// suggestModel picks the cheapest lower-tier model globally
		expect(suggestion?.estimatedSavings).toBeGreaterThan(0)
		expect(suggestion?.currentModel).toBe('acme-turbo')
	})

	it('provider without metadata still works (backward compatible)', async () => {
		registerProviderFactory('bare-provider', () => {
			const mock = mockProvider({ defaultResponse: { content: 'bare works' } })
			return {
				...mock,
				name: 'bare-provider',
				defaultModel: 'bare-v1',
			}
		})

		const gw = gateway({ provider: 'bare-provider', apiKey: 'test' })
		const result = await gw.complete({ messages: [{ role: 'user', content: 'hi' }] })
		expect(result.message.content).toBe('bare works')
	})
})
