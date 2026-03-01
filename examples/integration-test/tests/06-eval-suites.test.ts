import { runEvalSuite } from '@elsium-ai/testing'
/**
 * Test 06: Eval Suites
 * Verifies: runEvalSuite, EvalCase, EvalCriterion
 */
import { describe, expect, it } from 'vitest'

describe('06 — Eval Suites', () => {
	it('runs an eval suite with criteria', async () => {
		const result = await runEvalSuite({
			name: 'greeting-eval',
			cases: [
				{
					name: 'says hello',
					input: 'greet the user',
					criteria: [
						{ type: 'contains', value: 'Hello' },
						{ type: 'length_min', value: 3 },
					],
				},
				{
					name: 'says goodbye',
					input: 'say goodbye',
					criteria: [{ type: 'contains', value: 'Goodbye' }],
				},
			],
			runner: async (input) => {
				if (input.includes('greet')) return 'Hello there!'
				return 'Goodbye, friend!'
			},
		})

		expect(result.name).toBe('greeting-eval')
		expect(result.total).toBe(2)
		expect(result.passed).toBe(2)
		expect(result.failed).toBe(0)
		expect(result.score).toBe(1)
		expect(result.durationMs).toBeGreaterThanOrEqual(0)
	})

	it('reports failures correctly', async () => {
		const result = await runEvalSuite({
			name: 'fail-eval',
			cases: [
				{
					name: 'should fail',
					input: 'test',
					criteria: [{ type: 'contains', value: 'MISSING_WORD' }],
				},
			],
			runner: async () => 'This does not contain the expected word.',
		})

		expect(result.passed).toBe(0)
		expect(result.failed).toBe(1)
		expect(result.score).toBe(0)
	})

	it('supports json_valid criterion', async () => {
		const result = await runEvalSuite({
			name: 'json-eval',
			cases: [
				{
					name: 'valid json',
					input: 'give json',
					criteria: [{ type: 'json_valid' }],
				},
			],
			runner: async () => '{"key": "value"}',
		})

		expect(result.passed).toBe(1)
	})

	it('supports custom criterion', async () => {
		const result = await runEvalSuite({
			name: 'custom-eval',
			cases: [
				{
					name: 'custom check',
					input: 'test',
					criteria: [
						{
							type: 'custom',
							name: 'length-check',
							fn: (output: string) => output.length > 5,
						},
					],
				},
			],
			runner: async () => 'This is long enough',
		})

		expect(result.passed).toBe(1)
	})
})
