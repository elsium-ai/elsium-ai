import { describe, expect, it } from 'vitest'
import { assessJudgeConsistency, computeJudgeAlignment, runJudgeAlignment } from './judge-alignment'

describe('computeJudgeAlignment', () => {
	it('reports perfect agreement when judge matches human', () => {
		const r = computeJudgeAlignment([
			{ human: 1, judge: 1 },
			{ human: 0, judge: 0 },
			{ human: 1, judge: 1 },
			{ human: 0, judge: 0 },
		])
		expect(r.agreementRate).toBe(1)
		expect(r.cohenKappa).toBe(1)
		expect(r.meanAbsoluteError).toBe(0)
		expect(r.strength).toBe('almost-perfect')
	})

	it('computes Cohen kappa corrected for chance', () => {
		// 8/10 agree, but with class imbalance kappa < agreementRate
		const pairs = [
			{ human: 1, judge: 1 },
			{ human: 1, judge: 1 },
			{ human: 1, judge: 1 },
			{ human: 1, judge: 0 },
			{ human: 1, judge: 1 },
			{ human: 1, judge: 1 },
			{ human: 0, judge: 1 },
			{ human: 0, judge: 0 },
			{ human: 1, judge: 1 },
			{ human: 1, judge: 1 },
		]
		const r = computeJudgeAlignment(pairs)
		expect(r.agreementRate).toBeCloseTo(0.8, 5)
		expect(r.cohenKappa).toBeLessThan(r.agreementRate)
		expect(r.confusion.truePos).toBe(7)
	})

	it('detects a biased judge (low kappa despite some agreement)', () => {
		// Judge says "pass" to everything; humans are mixed
		const pairs = [
			{ human: 1, judge: 1 },
			{ human: 0, judge: 1 },
			{ human: 0, judge: 1 },
			{ human: 1, judge: 1 },
		]
		const r = computeJudgeAlignment(pairs)
		expect(r.cohenKappa).toBeLessThanOrEqual(0)
		expect(r.strength).toBe('poor')
	})

	it('reports MAE and correlation for continuous scores', () => {
		const r = computeJudgeAlignment([
			{ human: 0.9, judge: 0.8 },
			{ human: 0.2, judge: 0.3 },
			{ human: 0.7, judge: 0.6 },
		])
		expect(r.meanAbsoluteError).toBeCloseTo(0.1, 5)
		expect(r.pearson).toBeGreaterThan(0.9)
	})

	it('throws on empty input', () => {
		expect(() => computeJudgeAlignment([])).toThrow()
	})
})

describe('runJudgeAlignment', () => {
	it('runs a scorer over labeled cases and aligns it', async () => {
		const cases = [
			{ output: 'great answer', humanScore: 1 },
			{ output: 'bad answer', humanScore: 0 },
		]
		// scorer that mirrors the human label
		const scorer = (output: string) => (output.startsWith('great') ? 1 : 0)
		const r = await runJudgeAlignment(cases, scorer)
		expect(r.agreementRate).toBe(1)
		expect(r.pairs).toHaveLength(2)
	})
})

describe('assessJudgeConsistency', () => {
	it('flags a perfectly consistent judge', async () => {
		const r = await assessJudgeConsistency(() => 0.8, { runs: 4 })
		expect(r.consistent).toBe(true)
		expect(r.range).toBe(0)
		expect(r.mean).toBeCloseTo(0.8, 5)
	})

	it('flags an inconsistent judge', async () => {
		const values = [0.2, 0.9, 0.5, 0.7]
		let i = 0
		const r = await assessJudgeConsistency(() => values[i++ % values.length], {
			runs: 4,
			tolerance: 0.1,
		})
		expect(r.consistent).toBe(false)
		expect(r.range).toBeCloseTo(0.7, 5)
	})
})
