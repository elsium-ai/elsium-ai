/**
 * Test 22: Gateway Generate / Structured Output (Real LLM)
 * Verifies: gateway.generate() with Zod schema — typed data back
 */
import { expect, it } from 'vitest'
import { z } from 'zod'
import { assertNonEmptyString, createTestGateway, describeWithLLM } from '../lib/helpers'

describeWithLLM('22 — Gateway Generate (Real LLM)', () => {
	it('returns typed data matching a Zod schema', async () => {
		const gw = createTestGateway('gpt-4o')

		const schema = z.object({
			name: z.string(),
			capital: z.string(),
			population: z.number(),
		})

		const result = await gw.generate({
			messages: [{ role: 'user', content: 'Give me basic facts about France.' }],
			schema,
			maxTokens: 100,
			system: 'Respond with JSON only. Keep it brief.',
		})

		expect(result.data).toBeDefined()
		expect(typeof result.data.name).toBe('string')
		expect(typeof result.data.capital).toBe('string')
		expect(typeof result.data.population).toBe('number')

		expect(result.response).toBeDefined()
		assertNonEmptyString(result.response.id)
	})
})
