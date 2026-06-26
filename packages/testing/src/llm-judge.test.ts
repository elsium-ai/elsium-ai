import { describe, expect, it } from 'vitest'
import { createRubricJudge } from './llm-judge'

const CRITERIA = [
	{ name: 'correctness', description: 'Is the answer factually correct?', weight: 2 },
	{ name: 'tone', description: 'Is the tone appropriate?', weight: 1 },
]

describe('createRubricJudge', () => {
	it('computes a weighted score from a structured response', async () => {
		const generate = async () =>
			JSON.stringify({
				scores: [
					{ name: 'correctness', score: 10, reasoning: 'accurate' },
					{ name: 'tone', score: 5, reasoning: 'a bit terse' },
				],
			})
		const judge = createRubricJudge({ generate, criteria: CRITERIA })
		const result = await judge.evaluate('some output')

		expect(result.breakdown).toHaveLength(2)
		expect(result.score).toBeCloseTo((1 * 2 + 0.5 * 1) / 3)
		expect(result.breakdown[0].score).toBe(1)
		expect(result.breakdown[1].reasoning).toBe('a bit terse')
	})

	it('is usable as an LLMJudge callback returning score + reasoning', async () => {
		const generate = async () =>
			'```json\n{"scores":[{"name":"correctness","score":8,"reasoning":"ok"},{"name":"tone","score":10,"reasoning":"great"}]}\n```'
		const judge = createRubricJudge({ generate, criteria: CRITERIA })
		const { score, reasoning } = await judge('prompt')
		expect(score).toBeCloseTo((0.8 * 2 + 1 * 1) / 3)
		expect(reasoning).toContain('correctness')
	})

	it('honors a custom scale', async () => {
		const generate = async () =>
			JSON.stringify({ scores: [{ name: 'correctness', score: 50, reasoning: 'half' }] })
		const judge = createRubricJudge({
			generate,
			criteria: [{ name: 'correctness', description: 'x' }],
			scale: 100,
		})
		const result = await judge.evaluate('out')
		expect(result.score).toBeCloseTo(0.5)
	})

	it('defaults missing criteria to zero', async () => {
		const generate = async () =>
			JSON.stringify({ scores: [{ name: 'correctness', score: 10, reasoning: 'good' }] })
		const judge = createRubricJudge({ generate, criteria: CRITERIA })
		const result = await judge.evaluate('out')
		const tone = result.breakdown.find((b) => b.name === 'tone')
		expect(tone?.score).toBe(0)
		expect(tone?.reasoning).toContain('No score')
	})

	it('returns a zero score with reasoning when the response is unparseable', async () => {
		const judge = createRubricJudge({
			generate: async () => 'not json at all',
			criteria: CRITERIA,
		})
		const result = await judge.evaluate('out')
		expect(result.score).toBe(0)
		expect(result.reasoning).toContain('Failed to parse')
		expect(result.breakdown).toEqual([])
	})

	it('clamps scores above the scale', async () => {
		const generate = async () =>
			JSON.stringify({ scores: [{ name: 'correctness', score: 999, reasoning: 'x' }] })
		const judge = createRubricJudge({
			generate,
			criteria: [{ name: 'correctness', description: 'x' }],
		})
		const result = await judge.evaluate('out')
		expect(result.score).toBe(1)
	})
})
