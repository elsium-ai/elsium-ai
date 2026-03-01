import { defineAgent, runParallel, runSequential, runSupervisor } from '@elsium-ai/agents'
/**
 * Test 23: Multi-Agent Orchestration (Real LLM)
 * Verifies: runSequential, runParallel, runSupervisor with real agents
 */
import { expect, it } from 'vitest'
import { assertNonEmptyString, createTestComplete, describeWithLLM } from '../lib/helpers'

describeWithLLM('23 — Multi-Agent Orchestration (Real LLM)', () => {
	it('runSequential chains agent outputs', async () => {
		const complete = createTestComplete()

		const summarizer = defineAgent(
			{
				name: 'summarizer',
				system: 'Summarize the input in one sentence. Keep it under 15 words.',
			},
			{ complete },
		)

		const translator = defineAgent(
			{
				name: 'translator',
				system: 'Translate the input to French. Keep it under 15 words.',
			},
			{ complete },
		)

		const results = await runSequential(
			[summarizer, translator],
			'The quick brown fox jumped over the lazy dog near the river bank.',
		)

		expect(results).toHaveLength(2)
		assertNonEmptyString(results[0].message.content)
		assertNonEmptyString(results[1].message.content)
	})

	it('runParallel runs agents concurrently', async () => {
		const complete = createTestComplete()

		const poet = defineAgent(
			{ name: 'poet', system: 'Write a one-line poem about the topic. Under 10 words.' },
			{ complete },
		)

		const scientist = defineAgent(
			{ name: 'scientist', system: 'State one scientific fact about the topic. Under 10 words.' },
			{ complete },
		)

		const results = await runParallel([poet, scientist], 'the moon')

		expect(results).toHaveLength(2)
		assertNonEmptyString(results[0].message.content)
		assertNonEmptyString(results[1].message.content)
	})

	it('runSupervisor delegates to workers and synthesizes', async () => {
		const complete = createTestComplete()

		const supervisor = defineAgent(
			{
				name: 'supervisor',
				system:
					'You coordinate workers. Synthesize their perspectives into one sentence. Under 20 words.',
			},
			{ complete },
		)

		const optimist = defineAgent(
			{ name: 'optimist', system: 'Give a positive perspective. Under 10 words.' },
			{ complete },
		)

		const realist = defineAgent(
			{ name: 'realist', system: 'Give a realistic perspective. Under 10 words.' },
			{ complete },
		)

		const result = await runSupervisor(supervisor, [optimist, realist], 'What is the future of AI?')

		expect(result.message).toBeDefined()
		assertNonEmptyString(result.message.content)
	})
})
