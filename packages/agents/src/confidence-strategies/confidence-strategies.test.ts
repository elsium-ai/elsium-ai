import type { LLMResponse } from '@elsium-ai/core'
import { describe, expect, it } from 'vitest'
import {
	ConfidenceTooLowError,
	createMajorityVoter,
	createSimilarityVoter,
	judgeEnsemble,
	logprobScore,
	requireConfidence,
	selfConsistency,
} from './index'
import type { ConfidenceSample, GenerateSample, Judge } from './types'

function makeSequenceGen<T>(values: T[]): GenerateSample<T> {
	let i = 0
	return async () => {
		const value = values[Math.min(i, values.length - 1)]
		i++
		return { value }
	}
}

describe('createMajorityVoter', () => {
	it('selects the most-frequent value', () => {
		const voter = createMajorityVoter<string>()
		const samples: ConfidenceSample<string>[] = [
			{ value: 'A' },
			{ value: 'B' },
			{ value: 'A' },
			{ value: 'A' },
			{ value: 'C' },
		]
		const result = voter.vote(samples)
		expect(result.winner).toBe('A')
		expect(result.confidence).toBe(0.6)
	})

	it('canonicalizes objects so key order does not matter', () => {
		const voter = createMajorityVoter<{ a: number; b: number }>()
		const samples: ConfidenceSample<{ a: number; b: number }>[] = [
			{ value: { a: 1, b: 2 } },
			{ value: { b: 2, a: 1 } },
		]
		const result = voter.vote(samples)
		expect(result.confidence).toBe(1)
	})
})

describe('createSimilarityVoter', () => {
	it('clusters semantically equivalent samples and reports cluster confidence', async () => {
		const voter = createSimilarityVoter<string>({
			similarity: (a, b) => (a.toLowerCase() === b.toLowerCase() ? 1 : 0),
			threshold: 0.9,
		})
		const samples: ConfidenceSample<string>[] = [
			{ value: 'paris' },
			{ value: 'PARIS' },
			{ value: 'london' },
		]
		const result = await voter.vote(samples)
		expect(result.winner.toLowerCase()).toBe('paris')
		expect(result.confidence).toBeCloseTo(2 / 3, 5)
	})

	it('throws on empty samples list', async () => {
		const voter = createSimilarityVoter<string>({ similarity: () => 1 })
		await expect(voter.vote([])).rejects.toThrow(/at least one sample/)
	})
})

describe('selfConsistency strategy', () => {
	it('returns the majority value with confidence = winners / total', async () => {
		const gen = makeSequenceGen([{ city: 'Paris' }, { city: 'London' }, { city: 'Paris' }])
		const strategy = selfConsistency<{ city: string }>({ samples: 3 })
		const score = await strategy.score(gen)
		expect(score.value.city).toBe('Paris')
		expect(score.confidence).toBeCloseTo(2 / 3, 5)
		expect(score.strategy).toContain('self-consistency(3,majority)')
		expect(score.samples).toHaveLength(3)
	})

	it('uses an injected voter when provided', async () => {
		const gen = makeSequenceGen(['paris', 'PARIS'])
		const voter = createSimilarityVoter<string>({
			similarity: (a, b) => (a.toLowerCase() === b.toLowerCase() ? 1 : 0),
		})
		const strategy = selfConsistency({ samples: 2, voter })
		const score = await strategy.score(gen)
		expect(score.confidence).toBe(1)
	})

	it('rejects non-positive samples count', () => {
		expect(() => selfConsistency({ samples: 0 })).toThrow(/positive integer/)
	})
})

describe('judgeEnsemble strategy', () => {
	const judge = (name: string, s: number): Judge<string> => ({
		name,
		async score() {
			return { score: s }
		},
	})

	it('averages judge scores by default', async () => {
		const strategy = judgeEnsemble({ judges: [judge('a', 0.8), judge('b', 0.6)] })
		const score = await strategy.score(async () => ({ value: 'answer' }))
		expect(score.confidence).toBeCloseTo(0.7, 5)
		expect(score.details?.aggregator).toBe('mean')
	})

	it('honors min aggregator', async () => {
		const strategy = judgeEnsemble({
			judges: [judge('a', 0.9), judge('b', 0.3)],
			aggregator: 'min',
		})
		const score = await strategy.score(async () => ({ value: 'answer' }))
		expect(score.confidence).toBe(0.3)
	})

	it('honors median aggregator', async () => {
		const strategy = judgeEnsemble({
			judges: [judge('a', 0.1), judge('b', 0.4), judge('c', 0.9)],
			aggregator: 'median',
		})
		const score = await strategy.score(async () => ({ value: 'answer' }))
		expect(score.confidence).toBe(0.4)
	})

	it('requires at least one judge', () => {
		expect(() => judgeEnsemble({ judges: [] })).toThrow(/at least one judge/)
	})
})

describe('logprobScore strategy', () => {
	function rawWithLogprobs(logprobs: number[]): LLMResponse {
		return {
			id: 'r',
			message: { role: 'assistant', content: 'x', metadata: { logprobs } },
			usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
			cost: { inputCost: 0, outputCost: 0, totalCost: 0, currency: 'USD' },
			model: 'm',
			provider: 'p',
			stopReason: 'end_turn',
			latencyMs: 0,
			traceId: 't',
		}
	}

	it('extracts logprobs from metadata and aggregates geometric mean by default', async () => {
		const raw = rawWithLogprobs([Math.log(0.9), Math.log(0.5), Math.log(0.7)])
		const strategy = logprobScore<string>()
		const score = await strategy.score(async () => ({ value: 'x', raw }))
		expect(score.confidence).toBeCloseTo(
			Math.exp((Math.log(0.9) + Math.log(0.5) + Math.log(0.7)) / 3),
			5,
		)
	})

	it('uses fallback confidence when logprobs are missing', async () => {
		const raw: LLMResponse = {
			id: 'r',
			message: { role: 'assistant', content: 'x' },
			usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
			cost: { inputCost: 0, outputCost: 0, totalCost: 0, currency: 'USD' },
			model: 'm',
			provider: 'p',
			stopReason: 'end_turn',
			latencyMs: 0,
			traceId: 't',
		}
		const strategy = logprobScore<string>({ fallbackConfidence: 0.42 })
		const score = await strategy.score(async () => ({ value: 'x', raw }))
		expect(score.confidence).toBe(0.42)
	})

	it('honors a custom extractLogprobs', async () => {
		const raw = rawWithLogprobs([])
		const strategy = logprobScore<string>({
			extractLogprobs: () => [Math.log(0.99), Math.log(0.99)],
			aggregator: 'min',
		})
		const score = await strategy.score(async () => ({ value: 'x', raw }))
		expect(score.confidence).toBeCloseTo(0.99, 4)
	})

	it('accepts logprobs as { token, logprob } objects', async () => {
		const raw: LLMResponse = {
			id: 'r',
			message: {
				role: 'assistant',
				content: 'x',
				metadata: {
					logprobs: [
						{ token: 'a', logprob: Math.log(0.8) },
						{ token: 'b', logprob: Math.log(0.6) },
					],
				},
			},
			usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
			cost: { inputCost: 0, outputCost: 0, totalCost: 0, currency: 'USD' },
			model: 'm',
			provider: 'p',
			stopReason: 'end_turn',
			latencyMs: 0,
			traceId: 't',
		}
		const strategy = logprobScore<string>({ aggregator: 'mean' })
		const score = await strategy.score(async () => ({ value: 'x', raw }))
		expect(score.confidence).toBeCloseTo((0.8 + 0.6) / 2, 5)
	})
})

describe('requireConfidence — threshold gate', () => {
	const passingStrategy = {
		name: 'always-09',
		async score(generate: GenerateSample<string>) {
			const s = await generate()
			return { value: s.value, confidence: 0.9, strategy: 'always-09', samples: [s] }
		},
	}

	const lowStrategy = {
		name: 'always-04',
		async score(generate: GenerateSample<string>) {
			const s = await generate()
			return { value: s.value, confidence: 0.4, strategy: 'always-04', samples: [s] }
		},
	}

	it('returns status=ok when confidence meets threshold', async () => {
		const r = await requireConfidence(async () => ({ value: 'x' }), {
			strategy: passingStrategy,
			min: 0.8,
		})
		expect(r.status).toBe('ok')
		expect(r.confidence).toBe(0.9)
	})

	it('throws ConfidenceTooLowError on abort below threshold', async () => {
		await expect(
			requireConfidence(async () => ({ value: 'x' }), {
				strategy: lowStrategy,
				min: 0.8,
			}),
		).rejects.toBeInstanceOf(ConfidenceTooLowError)
	})

	it('returns status=escalated when below=escalate', async () => {
		const r = await requireConfidence(async () => ({ value: 'x' }), {
			strategy: lowStrategy,
			min: 0.8,
			below: 'escalate',
		})
		expect(r.status).toBe('escalated')
		expect(r.value).toBe('x')
	})

	it('invokes custom escalation callback below threshold', async () => {
		const r = await requireConfidence(async () => ({ value: 'x' }), {
			strategy: lowStrategy,
			min: 0.8,
			below: async () => ({
				value: 'human-corrected',
				confidence: 0.95,
				strategy: 'human-review',
				samples: [{ value: 'human-corrected' }],
			}),
		})
		expect(r.status).toBe('ok')
		expect(r.value).toBe('human-corrected')
		expect(r.confidence).toBe(0.95)
		expect(r.escalatedScore?.confidence).toBe(0.95)
	})

	it('keeps status=escalated when callback still returns low confidence', async () => {
		const r = await requireConfidence(async () => ({ value: 'x' }), {
			strategy: lowStrategy,
			min: 0.8,
			below: async () => ({
				value: 'x',
				confidence: 0.5,
				strategy: 'human-review',
				samples: [{ value: 'x' }],
			}),
		})
		expect(r.status).toBe('escalated')
	})

	it('fires onLowConfidence hook on threshold miss', async () => {
		const seen: number[] = []
		await requireConfidence(async () => ({ value: 'x' }), {
			strategy: lowStrategy,
			min: 0.8,
			below: 'escalate',
			onLowConfidence: (s) => seen.push(s.confidence),
		})
		expect(seen).toEqual([0.4])
	})

	it('rejects invalid min thresholds', async () => {
		await expect(
			requireConfidence(async () => ({ value: 'x' }), {
				strategy: passingStrategy,
				min: 1.5,
			}),
		).rejects.toThrow(/min must be a finite number/)
	})
})

describe('cross-strategy: VAG + CAG composition', () => {
	it('selfConsistency samples can be fed to judgeEnsemble agreement count', async () => {
		const gen = makeSequenceGen(['answer-A', 'answer-A', 'answer-A', 'answer-B', 'answer-A'])
		const sc = await selfConsistency<string>({ samples: 5 }).score(gen)
		expect(sc.confidence).toBeCloseTo(0.8, 5)

		const judge: Judge<string> = {
			name: 'sample-agreement',
			async score(value) {
				const agreement = sc.samples?.filter((s) => s.value === value).length ?? 0
				const total = sc.samples?.length ?? 1
				return { score: agreement / total }
			},
		}
		const je = await judgeEnsemble({ judges: [judge] }).score(async () => ({ value: sc.value }))
		expect(je.confidence).toBeCloseTo(0.8, 5)
	})
})
