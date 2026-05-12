import { describe, expect, it } from 'vitest'
import { type DriftSample, type SimilarityProvider, detectDrift } from './drift'

function sample(input: string, output: string, extra: Partial<DriftSample> = {}): DriftSample {
	return { input, output, ...extra }
}

describe('detectDrift — no drift baseline', () => {
	it('identical baseline and current yields 100% match and zero drift', async () => {
		const baseline = [sample('q1', 'answer one'), sample('q2', 'answer two')]
		const current = [...baseline]
		const report = await detectDrift({ baseline, current })

		expect(report.comparedCount).toBe(2)
		expect(report.exactMatchRate).toBe(1)
		expect(report.meanLengthDelta).toBe(0)
		expect(report.toolCallDivergence).toBe(0)
		expect(report.overallDrift).toBe(0)
		expect(report.mismatchedInputs).toEqual([])
	})
})

describe('detectDrift — length drift', () => {
	it('current outputs longer than baseline → positive meanLengthDelta and non-zero drift', async () => {
		const baseline = [sample('q1', 'short'), sample('q2', 'short')]
		const current = [sample('q1', 'much longer answer'), sample('q2', 'much longer answer')]
		const report = await detectDrift({ baseline, current })

		expect(report.exactMatchRate).toBe(0)
		expect(report.meanLengthDelta).toBeGreaterThan(0)
		expect(report.meanAbsoluteLengthDelta).toBeGreaterThan(0)
		expect(report.overallDrift).toBeGreaterThan(0)
	})

	it('outputs shorter on average → negative meanLengthDelta', async () => {
		const baseline = [sample('q1', 'long original answer here')]
		const current = [sample('q1', 'short')]
		const report = await detectDrift({ baseline, current })
		expect(report.meanLengthDelta).toBeLessThan(0)
		expect(report.meanAbsoluteLengthDelta).toBeGreaterThan(0)
	})
})

describe('detectDrift — tool-call divergence', () => {
	it('baseline calls tool A, current calls tool B → toolCallDivergence = 1', async () => {
		const baseline = [sample('q1', 'x', { toolCalls: ['search'] })]
		const current = [sample('q1', 'x', { toolCalls: ['compute'] })]
		const report = await detectDrift({ baseline, current })
		expect(report.toolCallDivergence).toBe(1)
		// Output text is identical → exactMatch is true; tool divergence still pushes drift
		expect(report.exactMatchRate).toBe(1)
		expect(report.overallDrift).toBeGreaterThan(0)
	})

	it('identical tool calls → zero divergence', async () => {
		const baseline = [sample('q1', 'x', { toolCalls: ['a', 'b'] })]
		const current = [sample('q1', 'x', { toolCalls: ['a', 'b'] })]
		const report = await detectDrift({ baseline, current })
		expect(report.toolCallDivergence).toBe(0)
	})

	it('partial overlap → fractional Jaccard distance', async () => {
		const baseline = [sample('q1', 'x', { toolCalls: ['a', 'b'] })]
		const current = [sample('q1', 'x', { toolCalls: ['b', 'c'] })]
		const report = await detectDrift({ baseline, current })
		// |{a,b} ∩ {b,c}| = 1, |union| = 3 → distance = 1 - 1/3 ≈ 0.6667
		expect(report.toolCallDivergence).toBeCloseTo(2 / 3, 3)
	})
})

describe('detectDrift — mismatched inputs', () => {
	it('inputs present only in baseline are reported, not compared', async () => {
		const baseline = [sample('q1', 'a'), sample('q2', 'b')]
		const current = [sample('q1', 'a')]
		const report = await detectDrift({ baseline, current })
		expect(report.comparedCount).toBe(1)
		expect(report.mismatchedInputs).toContain('q2')
	})

	it('inputs present only in current are reported, not compared', async () => {
		const baseline = [sample('q1', 'a')]
		const current = [sample('q1', 'a'), sample('q-new', 'b')]
		const report = await detectDrift({ baseline, current })
		expect(report.comparedCount).toBe(1)
		expect(report.mismatchedInputs).toContain('q-new')
	})

	it('no overlap at all yields zeroed metrics and the full mismatched list', async () => {
		const baseline = [sample('q1', 'a')]
		const current = [sample('q2', 'b')]
		const report = await detectDrift({ baseline, current })
		expect(report.comparedCount).toBe(0)
		expect(report.mismatchedInputs.sort()).toEqual(['q1', 'q2'])
		expect(report.overallDrift).toBe(0)
	})
})

describe('detectDrift — semantic similarity (pluggable)', () => {
	const constantSim = (value: number): SimilarityProvider => ({
		similarity: async () => value,
	})

	it('high similarity yields lower drift than low similarity (everything else equal)', async () => {
		const baseline = [sample('q1', 'A long original answer')]
		const current = [sample('q1', 'A long original answer slightly modified')]

		const highSimReport = await detectDrift({
			baseline,
			current,
			similarity: constantSim(0.95),
		})
		const lowSimReport = await detectDrift({
			baseline,
			current,
			similarity: constantSim(0.1),
		})

		expect(highSimReport.meanSimilarity).toBeCloseTo(0.95)
		expect(lowSimReport.meanSimilarity).toBeCloseTo(0.1)
		expect(highSimReport.overallDrift).toBeLessThan(lowSimReport.overallDrift)
	})

	it('low similarity contributes to overall drift', async () => {
		const baseline = [sample('q1', 'A original answer')]
		const current = [sample('q1', 'Totally different content')]
		const report = await detectDrift({
			baseline,
			current,
			similarity: constantSim(0.1),
		})
		expect(report.meanSimilarity).toBeCloseTo(0.1)
		expect(report.overallDrift).toBeGreaterThan(0.3)
	})

	it('clamps similarity scores to [0, 1] defensively', async () => {
		const baseline = [sample('q1', 'a')]
		const current = [sample('q1', 'b')]
		const report = await detectDrift({
			baseline,
			current,
			similarity: { similarity: async () => 5 }, // out of range
		})
		expect(report.meanSimilarity).toBeLessThanOrEqual(1)
		expect(report.meanSimilarity).toBeGreaterThanOrEqual(0)
	})
})

describe('detectDrift — weights customization', () => {
	it('renormalizes custom weights so the score stays in [0, 1]', async () => {
		const baseline = [sample('q1', 'a')]
		const current = [sample('q1', 'b')]
		const report = await detectDrift({
			baseline,
			current,
			weights: { exactMismatch: 10, length: 1, toolCalls: 1, semantic: 0 },
		})
		expect(report.overallDrift).toBeGreaterThanOrEqual(0)
		expect(report.overallDrift).toBeLessThanOrEqual(1)
	})

	it('throws when weights sum to zero', async () => {
		await expect(
			detectDrift({
				baseline: [sample('q1', 'a')],
				current: [sample('q1', 'b')],
				weights: { exactMismatch: 0, length: 0, toolCalls: 0, semantic: 0 },
			}),
		).rejects.toThrow(/positive number/)
	})
})

describe('detectDrift — per-input detail', () => {
	it('returns per-input rows with deltas for downstream UI', async () => {
		const baseline = [sample('q1', 'cat', { toolCalls: ['a'] })]
		const current = [sample('q1', 'cats', { toolCalls: ['b'] })]
		const report = await detectDrift({ baseline, current })
		expect(report.perInput).toHaveLength(1)
		const row = report.perInput[0]
		expect(row.input).toBe('q1')
		expect(row.exactMatch).toBe(false)
		expect(row.lengthDelta).toBe(1)
		expect(row.toolCallsBaseline).toEqual(['a'])
		expect(row.toolCallsCurrent).toEqual(['b'])
	})
})
