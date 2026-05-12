import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createBudgetedRegressionSuite } from './regression-budgets'

describe('createBudgetedRegressionSuite — outcomes', () => {
	function setup() {
		const suite = createBudgetedRegressionSuite('classifier-v2')
		suite.addCase({ input: 'easy', output: 'cat', score: 1.0 })
		suite.addCase({ input: 'hard', output: 'cat-or-dog', score: 0.8, tolerance: 0.05 })
		suite.addCase({ input: 'critical', output: 'must-be-exact', score: 1.0, maxDelta: 0.2 })
		return suite
	}

	it('classifies an unchanged case (delta within tolerance)', async () => {
		const suite = setup()
		// Custom scorer keeps the score identical to baseline → delta = 0
		const report = await suite.run(
			async (input) => input,
			async (_input, _output) => 1.0,
		)
		expect(report.byOutcome.unchanged).toBeGreaterThan(0)
	})

	it('classifies an improved case (delta > tolerance)', async () => {
		const suite = createBudgetedRegressionSuite('s')
		suite.addCase({ input: 'i', output: 'expected', score: 0.6 })
		const report = await suite.run(
			async () => 'expected',
			async () => 0.95,
		)
		expect(report.byOutcome.improved).toBe(1)
		expect(report.improvedCases[0].delta).toBeCloseTo(0.35)
	})

	it('classifies a regression (delta exceeds tolerance but not maxDelta)', async () => {
		const suite = createBudgetedRegressionSuite('s')
		suite.addCase({ input: 'i', output: 'expected', score: 1.0 })
		const report = await suite.run(
			async () => 'expected',
			async () => 0.85, // delta = -0.15, > default tolerance 0.1
		)
		expect(report.byOutcome.regression).toBe(1)
	})

	it('classifies a critical case (delta exceeds maxDelta)', async () => {
		const suite = createBudgetedRegressionSuite('s')
		suite.addCase({ input: 'i', output: 'expected', score: 1.0, maxDelta: 0.2 })
		const report = await suite.run(
			async () => 'expected',
			async () => 0.5, // delta = -0.5, > maxDelta 0.2
		)
		expect(report.byOutcome.critical).toBe(1)
		expect(report.criticalCases[0].outcome).toBe('critical')
	})

	it('per-case tolerance overrides the default', async () => {
		const suite = createBudgetedRegressionSuite('s')
		suite.addCase({ input: 'tight', output: 'x', score: 1.0, tolerance: 0.02 })
		// delta = -0.05 — outside the tight 0.02 tolerance but inside the default 0.1
		const report = await suite.run(
			async () => 'x',
			async () => 0.95,
		)
		expect(report.perCase[0].outcome).toBe('regression')
	})
})

describe('setDefaults validation', () => {
	it('rejects out-of-range tolerance', () => {
		const suite = createBudgetedRegressionSuite('s')
		expect(() => suite.setDefaults({ tolerance: 1.5, maxDelta: 0.3 })).toThrow(/tolerance/)
	})

	it('rejects out-of-range maxDelta', () => {
		const suite = createBudgetedRegressionSuite('s')
		expect(() => suite.setDefaults({ tolerance: 0.1, maxDelta: -0.1 })).toThrow(/maxDelta/)
	})

	it('rejects maxDelta < tolerance', () => {
		const suite = createBudgetedRegressionSuite('s')
		expect(() => suite.setDefaults({ tolerance: 0.3, maxDelta: 0.1 })).toThrow(/>= tolerance/)
	})
})

describe('addCase semantics', () => {
	it('replaces an existing case with the same input', () => {
		const suite = createBudgetedRegressionSuite('s')
		suite.addCase({ input: 'i', output: 'a', score: 1.0 })
		suite.addCase({ input: 'i', output: 'b', score: 0.9 })
		expect(suite.baseline?.cases).toHaveLength(1)
		expect(suite.baseline?.cases[0].output).toBe('b')
	})

	it('preserves tags', async () => {
		const suite = createBudgetedRegressionSuite('s')
		suite.addCase({ input: 'i', output: 'x', score: 1.0, tags: ['regulated', 'p1'] })
		const report = await suite.run(async () => 'x')
		expect(report.perCase[0].tags).toEqual(['regulated', 'p1'])
	})
})

describe('persistence', () => {
	it('save and load round-trip', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'elsium-reg-'))
		try {
			const path = join(dir, 'baseline.json')
			const s1 = createBudgetedRegressionSuite('s')
			s1.addCase({ input: 'q1', output: 'a', score: 1.0, tolerance: 0.05 })
			await s1.save(path)

			const s2 = createBudgetedRegressionSuite('s')
			await s2.load(path)
			expect(s2.baseline?.cases).toHaveLength(1)
			expect(s2.baseline?.cases[0].tolerance).toBe(0.05)
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})

	it('load() on missing file is a no-op (baseline stays null)', async () => {
		const s = createBudgetedRegressionSuite('s')
		await s.load('/nonexistent/path/baseline.json')
		expect(s.baseline).toBeNull()
	})
})

describe('empty baseline', () => {
	it('returns an empty report when there are no cases', async () => {
		const suite = createBudgetedRegressionSuite('s')
		const runner = vi.fn(async (i: string) => i)
		const report = await suite.run(runner)
		expect(report.totalCases).toBe(0)
		expect(runner).not.toHaveBeenCalled()
	})
})
