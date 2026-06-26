import { describe, expect, it } from 'vitest'
import type { LLMJudge } from './eval'
import {
	answerRelevancy,
	contextPrecision,
	contextRecall,
	faithfulness,
	formatRagEvalReport,
	runRagEval,
} from './rag-eval'

const perfectJudge: LLMJudge = async () => ({ score: 1, reasoning: 'fully supported' })
const harshJudge: LLMJudge = async () => ({ score: 0, reasoning: 'fabricated' })
const outOfRangeJudge: LLMJudge = async () => ({ score: 5, reasoning: 'overflow' })

describe('faithfulness / answerRelevancy', () => {
	it('returns the judge score for grounded answers', async () => {
		const result = await faithfulness({
			answer: 'The policy covers flood damage.',
			contexts: ['Clause 4: flood damage is covered.'],
			judge: perfectJudge,
		})
		expect(result.score).toBe(1)
		expect(result.reasoning).toBe('fully supported')
	})

	it('clamps out-of-range judge scores to [0,1]', async () => {
		const result = await answerRelevancy({
			question: 'Is flooding covered?',
			answer: 'Yes.',
			judge: outOfRangeJudge,
		})
		expect(result.score).toBe(1)
	})

	it('reports zero for fabricated answers', async () => {
		const result = await faithfulness({
			answer: 'Aliens approved this claim.',
			contexts: ['Clause 4: flood damage is covered.'],
			judge: harshJudge,
		})
		expect(result.score).toBe(0)
	})
})

describe('contextPrecision', () => {
	it('rank-weights relevant retrieved contexts', () => {
		const result = contextPrecision({
			contexts: ['a', 'b', 'c'],
			relevant: ['a', 'c'],
		})
		expect(result.score).toBeCloseTo((1 / 1 + 2 / 3) / 2)
	})

	it('scores zero when nothing relevant was retrieved', () => {
		expect(contextPrecision({ contexts: ['x'], relevant: ['y'] }).score).toBe(0)
	})
})

describe('contextRecall', () => {
	it('measures fraction of relevant contexts retrieved', () => {
		expect(contextRecall({ contexts: ['a'], relevant: ['a', 'b'] }).score).toBeCloseTo(0.5)
	})

	it('treats no expected relevant contexts as full recall', () => {
		expect(contextRecall({ contexts: [], relevant: [] }).score).toBe(1)
	})
})

describe('runRagEval', () => {
	it('aggregates judge and reference-based metrics', async () => {
		const result = await runRagEval({
			name: 'rag-suite',
			judge: perfectJudge,
			cases: [
				{
					question: 'Is flooding covered?',
					answer: 'Yes, clause 4 covers it.',
					contexts: ['Clause 4: flood damage is covered.', 'Clause 9: unrelated.'],
					relevant: ['Clause 4: flood damage is covered.'],
				},
			],
		})
		expect(result.aggregate.faithfulness).toBe(1)
		expect(result.aggregate.answerRelevancy).toBe(1)
		expect(result.aggregate.contextPrecision).toBeCloseTo(1)
		expect(result.aggregate.contextRecall).toBe(1)
		expect(result.aggregate.overall).toBeGreaterThan(0)
	})

	it('works reference-free when no relevant set is given', async () => {
		const result = await runRagEval({
			name: 'judge-only',
			judge: perfectJudge,
			cases: [{ question: 'q', answer: 'a', contexts: ['ctx'] }],
		})
		expect(result.aggregate.contextPrecision).toBeUndefined()
		expect(result.aggregate.faithfulness).toBe(1)
	})

	it('works judge-free with only reference metrics and supports concurrency', async () => {
		const result = await runRagEval({
			name: 'reference-only',
			concurrency: 2,
			cases: [
				{ question: 'q1', answer: 'a1', contexts: ['a'], relevant: ['a'] },
				{ question: 'q2', answer: 'a2', contexts: ['x'], relevant: ['y'] },
			],
		})
		expect(result.aggregate.faithfulness).toBeUndefined()
		expect(result.aggregate.contextRecall).toBeCloseTo(0.5)
		const report = formatRagEvalReport(result)
		expect(report).toContain('RAG Eval')
		expect(report).toContain('ctx-recall')
	})
})
