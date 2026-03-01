import { gateway } from '@elsium-ai/gateway'
import { createProvenanceTracker } from '@elsium-ai/observe'
import {
	assertDeterministic,
	createPinStore,
	createReplayRecorder,
	pinOutput,
} from '@elsium-ai/testing'
/**
 * Test 37: Reproducibility Tools
 * Verifies: replay recording, output pinning, assertDeterministic, provenance — all with real LLM
 */
import { expect, it } from 'vitest'
import { describeWithLLM } from '../lib/helpers'

describeWithLLM('37 — Reproducibility Tools (Real LLM)', () => {
	it('replay recorder captures and replays a real call', async () => {
		const apiKey = process.env.OPENAI_API_KEY as string
		const gw = gateway({
			provider: 'openai',
			apiKey,
			model: 'gpt-4o-mini',
		})

		const recorder = createReplayRecorder()
		const wrappedComplete = recorder.wrap((req) => gw.complete({ ...req, maxTokens: 10 }))

		const original = await wrappedComplete({
			messages: [{ role: 'user', content: 'Say hello' }],
		})

		const entries = recorder.getEntries()
		expect(entries).toHaveLength(1)

		// Replay returns the same content
		const { createReplayPlayer } = await import('@elsium-ai/testing')
		const player = createReplayPlayer(entries)
		const replayed = await player.complete({
			messages: [{ role: 'user', content: 'Say hello' }],
		})

		expect(replayed.message.content).toBe(original.message.content)
	})

	it('output pinning: first call is new, second is match or mismatch', async () => {
		const apiKey = process.env.OPENAI_API_KEY as string
		const gw = gateway({
			provider: 'openai',
			apiKey,
			model: 'gpt-4o-mini',
		})

		const store = createPinStore()
		const prompt = 'What is 2+2? Answer with just the number.'
		const config = { prompt, model: 'gpt-4o-mini', temperature: 0 }

		const runner = async () => {
			const response = await gw.complete({
				messages: [{ role: 'user', content: prompt }],
				maxTokens: 5,
				temperature: 0,
			})
			return response.message.content
		}

		const first = await pinOutput('math-test', store, runner, config)
		expect(first.status).toBe('new')

		const second = await pinOutput('math-test', store, runner, config)
		expect(['match', 'mismatch']).toContain(second.status)
	})

	it('assertDeterministic with real LLM and tolerance 1.0', async () => {
		const apiKey = process.env.OPENAI_API_KEY as string
		const gw = gateway({
			provider: 'openai',
			apiKey,
			model: 'gpt-4o-mini',
		})

		const result = await assertDeterministic(
			async () => {
				const response = await gw.complete({
					messages: [{ role: 'user', content: 'Say hello' }],
					maxTokens: 5,
					temperature: 0,
				})
				return response.message.content
			},
			{ runs: 3, tolerance: 1.0 },
		)

		expect(result.runs).toBe(3)
		expect(result.outputs).toHaveLength(3)
		expect(result.variance).toBeGreaterThanOrEqual(0)
	})

	it('provenance tracks a real LLM call lineage', async () => {
		const apiKey = process.env.OPENAI_API_KEY as string
		const gw = gateway({
			provider: 'openai',
			apiKey,
			model: 'gpt-4o-mini',
		})

		const provenance = createProvenanceTracker()

		const response = await gw.complete({
			messages: [{ role: 'user', content: 'What is TypeScript?' }],
			maxTokens: 20,
		})

		const record = provenance.record({
			prompt: 'What is TypeScript?',
			model: 'gpt-4o-mini',
			config: { maxTokens: 20 },
			input: 'What is TypeScript?',
			output: response.message.content,
			traceId: response.traceId,
		})

		const lineage = provenance.getLineage(record.outputHash)
		expect(lineage).toHaveLength(1)
		expect(lineage[0].outputHash).toBe(record.outputHash)
	})
})
