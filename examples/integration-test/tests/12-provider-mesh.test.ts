/**
 * Test 12: Provider Mesh (Real LLM)
 * Verifies: createProviderMesh with real OpenAI — fallback strategy
 */
import { expect, it } from 'vitest'
import { assertNonEmptyString, describeWithLLM } from '../lib/helpers'

describeWithLLM('12 — Provider Mesh (Real LLM)', () => {
	it('mesh with real OpenAI provider completes', async () => {
		const { createProviderMesh } = await import('@elsium-ai/gateway')
		const apiKey = process.env.OPENAI_API_KEY as string

		const mesh = createProviderMesh({
			providers: [
				{
					name: 'openai',
					config: { apiKey },
					model: 'gpt-4o-mini',
				},
			],
			strategy: 'fallback',
		})

		expect(mesh.providers).toContain('openai')
		expect(mesh.strategy).toBe('fallback')

		const response = await mesh.complete({
			messages: [{ role: 'user', content: 'Say hello.' }],
			maxTokens: 10,
			system: 'Respond in one word.',
		})

		expect(response.message.role).toBe('assistant')
		assertNonEmptyString(response.message.content)
		expect(response.id).toBeDefined()
		expect(response.usage.totalTokens).toBeGreaterThan(0)
		expect(response.cost.totalCost).toBeGreaterThan(0)
		expect(response.provider).toBe('openai')
	})

	it('mesh falls back from invalid to valid provider', async () => {
		const { createProviderMesh } = await import('@elsium-ai/gateway')
		const apiKey = process.env.OPENAI_API_KEY as string

		const mesh = createProviderMesh({
			providers: [
				{
					name: 'openai',
					config: { apiKey: 'sk-invalid-key-for-fallback-test' },
					model: 'gpt-4o-mini',
				},
				{
					name: 'openai',
					config: { apiKey },
					model: 'gpt-4o-mini',
				},
			],
			strategy: 'fallback',
		})

		const response = await mesh.complete({
			messages: [{ role: 'user', content: 'Say ok.' }],
			maxTokens: 5,
		})

		expect(response.message.role).toBe('assistant')
		assertNonEmptyString(response.message.content)
	})
})
