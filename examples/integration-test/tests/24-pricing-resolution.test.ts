import { calculateCost, registerPricing } from '@elsium-ai/gateway'
/**
 * Test 24: Pricing Resolution
 * Verifies: resolveModelName fallback strips date suffixes, registerPricing works
 */
import { describe, expect, it } from 'vitest'
import { createTestGateway, describeWithLLM } from '../lib/helpers'

describe('24 — Pricing Resolution (Framework)', () => {
	it('resolves versioned model name to base pricing', () => {
		const usage = { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 }
		const cost = calculateCost('gpt-4o-mini-2024-07-18', usage)
		expect(cost.totalCost).toBeGreaterThan(0)
	})

	it('still resolves base model name directly', () => {
		const usage = { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 }
		const cost = calculateCost('gpt-4o-mini', usage)
		expect(cost.totalCost).toBeGreaterThan(0)
	})

	it('returns $0 for truly unknown model', () => {
		const usage = { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 }
		const cost = calculateCost('truly-unknown-model', usage)
		expect(cost.totalCost).toBe(0)
	})

	it('registerPricing makes custom model resolvable', () => {
		registerPricing('custom-test-model', { inputPerMillion: 5, outputPerMillion: 10 })
		const usage = { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 }
		const cost = calculateCost('custom-test-model', usage)
		expect(cost.totalCost).toBeGreaterThan(0)
		expect(cost.inputCost).toBeGreaterThan(0)
		expect(cost.outputCost).toBeGreaterThan(0)
	})
})

describeWithLLM('24 — Pricing Resolution (Real LLM)', () => {
	it('gateway.complete() returns non-zero cost', async () => {
		const gw = createTestGateway()

		const response = await gw.complete({
			messages: [{ role: 'user', content: 'Say hi.' }],
			maxTokens: 5,
		})

		expect(response.cost.totalCost).toBeGreaterThan(0)
		expect(response.cost.inputCost).toBeGreaterThan(0)
		expect(response.cost.outputCost).toBeGreaterThan(0)
		expect(response.cost.currency).toBe('USD')
	})
})
