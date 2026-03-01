import { gateway } from '@elsium-ai/gateway'
import { createCostEngine } from '@elsium-ai/observe'
/**
 * Test 33: Cost Engine E2E
 * Verifies: cost tracking with real OpenAI, budget enforcement
 */
import { expect, it } from 'vitest'
import { describeWithLLM } from '../lib/helpers'

describeWithLLM('33 — Cost Engine E2E (Real LLM)', () => {
	it('tracks cost from a real OpenAI call', async () => {
		const engine = createCostEngine()
		const apiKey = process.env.OPENAI_API_KEY as string

		const gw = gateway({
			provider: 'openai',
			apiKey,
			model: 'gpt-4o-mini',
			middleware: [engine.middleware()],
		})

		await gw.complete({
			messages: [{ role: 'user', content: 'Say hello' }],
			maxTokens: 10,
			metadata: { agentName: 'test', userId: 'u1', feature: 'chat' },
		})

		const report = engine.getReport()
		expect(report.totalSpend).toBeGreaterThan(0)
		expect(report.totalCalls).toBe(1)
		expect(Object.keys(report.byModel).length).toBeGreaterThan(0)
		expect(report.byAgent.test).toBeDefined()
		expect(report.byUser.u1).toBeDefined()
		expect(report.byFeature.chat).toBeDefined()
	})

	it('enforces budget and rejects when exceeded', async () => {
		const engine = createCostEngine({ totalBudget: 0.000001 })
		const apiKey = process.env.OPENAI_API_KEY as string

		const gw = gateway({
			provider: 'openai',
			apiKey,
			model: 'gpt-4o-mini',
			middleware: [engine.middleware()],
		})

		await expect(
			gw.complete({
				messages: [{ role: 'user', content: 'Say hello' }],
				maxTokens: 10,
			}),
		).rejects.toThrow(/budget/i)
	})
})
