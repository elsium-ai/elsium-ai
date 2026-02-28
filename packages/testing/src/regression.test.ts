import { describe, expect, it } from 'vitest'
import { createRegressionSuite } from './regression'
import { createReplayPlayer, createReplayRecorder } from './replay'

describe('Regression Suite', () => {
	it('should create empty suite', () => {
		const suite = createRegressionSuite('test-suite')
		expect(suite.baseline).toBeNull()
	})

	it('should add cases to baseline', () => {
		const suite = createRegressionSuite('test-suite')
		suite.addCase('Hello', 'Hi there!', 0.9)
		suite.addCase('How are you?', 'I am good.', 0.8)

		expect(suite.baseline).not.toBeNull()
		expect(suite.baseline?.cases).toHaveLength(2)
	})

	it('should update existing cases', () => {
		const suite = createRegressionSuite('test-suite')
		suite.addCase('Hello', 'Hi!', 0.7)
		suite.addCase('Hello', 'Hey there!', 0.9)

		expect(suite.baseline?.cases).toHaveLength(1)
		expect(suite.baseline?.cases[0].output).toBe('Hey there!')
		expect(suite.baseline?.cases[0].score).toBe(0.9)
	})

	it('should detect regressions', async () => {
		const suite = createRegressionSuite('test-suite')
		suite.addCase('What is 2+2?', '4', 1.0)
		suite.addCase('Capital of France?', 'Paris', 1.0)

		const result = await suite.run(
			async (input) => {
				if (input === 'What is 2+2?') return 'Maybe 5?'
				if (input === 'Capital of France?') return 'Paris'
				return ''
			},
			async (_input, output) => {
				return output.includes('4') || output.includes('Paris') ? 1.0 : 0.3
			},
		)

		expect(result.regressions.length).toBeGreaterThan(0)
		expect(result.totalCases).toBe(2)
	})

	it('should detect improvements', async () => {
		const suite = createRegressionSuite('test-suite')
		suite.addCase('Hello', 'Hi', 0.3)

		const result = await suite.run(
			async () => 'Hello! How can I help you today?',
			async () => 0.9,
		)

		expect(result.improvements.length).toBeGreaterThan(0)
	})

	it('should handle empty baseline', async () => {
		const suite = createRegressionSuite('test-suite')

		const result = await suite.run(async () => 'response')
		expect(result.totalCases).toBe(0)
		expect(result.regressions).toHaveLength(0)
	})
})

describe('Replay', () => {
	it('should record and replay', async () => {
		const recorder = createReplayRecorder()
		const mockComplete = async () => ({
			id: 'msg_1',
			message: { role: 'assistant' as const, content: 'Hello!' },
			usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
			cost: { inputCost: 0.001, outputCost: 0.002, totalCost: 0.003, currency: 'USD' as const },
			model: 'test-model',
			provider: 'test',
			stopReason: 'end_turn' as const,
			latencyMs: 100,
			traceId: 'trc_1',
		})

		const wrapped = recorder.wrap(mockComplete)
		await wrapped({ messages: [{ role: 'user', content: 'Hi' }] })

		expect(recorder.getEntries()).toHaveLength(1)

		const json = recorder.toJSON()
		const player = createReplayPlayer(json)

		expect(player.remaining).toBe(1)

		const replayed = await player.complete({ messages: [{ role: 'user', content: 'Hi' }] })
		expect(replayed.message.content).toBe('Hello!')
		expect(player.remaining).toBe(0)
	})

	it('should throw when replay exhausted', async () => {
		const player = createReplayPlayer([])

		await expect(player.complete({ messages: [{ role: 'user', content: 'Hi' }] })).rejects.toThrow(
			'no more recorded responses',
		)
	})

	it('should clear recorder', () => {
		const recorder = createReplayRecorder()
		recorder.clear()
		expect(recorder.getEntries()).toHaveLength(0)
	})
})
