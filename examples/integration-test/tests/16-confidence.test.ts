import { defineAgent } from '@elsium-ai/agents'
import { mockProvider } from '@elsium-ai/testing'
/**
 * Test 16: Confidence Scoring
 * Verifies: agent confidence config (framework + real LLM)
 */
import { describe, expect, it } from 'vitest'
import { createTestComplete, describeWithLLM } from '../lib/helpers'

describe('16 — Confidence Scoring (Framework)', () => {
	it('agent without confidence returns undefined confidence', async () => {
		const mock = mockProvider({
			defaultResponse: { content: 'No confidence.' },
		})

		const agent = defineAgent(
			{ name: 'no-confidence', system: 'Plain agent.' },
			{ complete: (req) => mock.complete(req) },
		)

		const result = await agent.run('test')
		expect(result.confidence).toBeUndefined()
	})
})

describeWithLLM('16 — Confidence Scoring (Real LLM)', () => {
	it('agent with confidence: true returns confidence scores', async () => {
		const complete = createTestComplete()

		const agent = defineAgent(
			{
				name: 'confident-agent',
				system: 'You answer questions precisely. Keep responses under 10 words.',
				confidence: true,
			},
			{ complete },
		)

		const result = await agent.run('What is the capital of France?')

		expect(result.confidence).toBeDefined()
		expect(typeof result.confidence?.overall).toBe('number')
		expect(result.confidence?.overall).toBeGreaterThanOrEqual(0)
		expect(result.confidence?.overall).toBeLessThanOrEqual(1)
	})

	it('agent with detailed confidence config returns all scores', async () => {
		const complete = createTestComplete()

		const agent = defineAgent(
			{
				name: 'detailed-confidence',
				system: 'You provide precise answers. Keep responses under 10 words.',
				confidence: {
					hallucinationRisk: true,
					relevanceScore: true,
					citationCoverage: true,
				},
			},
			{ complete },
		)

		const result = await agent.run('What is 2+2?')

		expect(result.confidence).toBeDefined()
		expect(typeof result.confidence?.hallucinationRisk).toBe('number')
		expect(typeof result.confidence?.relevanceScore).toBe('number')
		expect(typeof result.confidence?.citationCoverage).toBe('number')
		expect(Array.isArray(result.confidence?.checks)).toBe(true)
	})
})
