import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { EvalSuiteResult } from './eval'
import { compareResults, formatComparison, loadBaseline, saveBaseline } from './eval-compare'
import type { EvalBaseline } from './eval-compare'

const TEST_DIR = join(import.meta.dirname, '__test-baselines__')

beforeAll(async () => {
	await mkdir(TEST_DIR, { recursive: true })
})

afterAll(async () => {
	await rm(TEST_DIR, { recursive: true, force: true })
})

function makeSuiteResult(overrides?: Partial<EvalSuiteResult>): EvalSuiteResult {
	return {
		name: 'test-suite',
		total: 2,
		passed: 2,
		failed: 0,
		score: 1.0,
		durationMs: 100,
		results: [
			{
				name: 'case-1',
				passed: true,
				score: 1.0,
				criteria: [],
				input: 'hello',
				output: 'world',
				durationMs: 50,
				tags: [],
			},
			{
				name: 'case-2',
				passed: true,
				score: 1.0,
				criteria: [],
				input: 'foo',
				output: 'bar',
				durationMs: 50,
				tags: [],
			},
		],
		...overrides,
	}
}

describe('saveBaseline and loadBaseline', () => {
	it('saves and loads a baseline', async () => {
		const result = makeSuiteResult()
		const filePath = await saveBaseline(result, TEST_DIR)

		expect(filePath).toContain('test-suite.baseline.json')

		const loaded = await loadBaseline('test-suite', TEST_DIR)

		expect(loaded).not.toBeNull()
		expect(loaded?.name).toBe('test-suite')
		expect(loaded?.score).toBe(1.0)
		expect(loaded?.results).toHaveLength(2)
		expect(loaded?.timestamp).toBeGreaterThan(0)
	})

	it('returns null for missing baseline', async () => {
		const loaded = await loadBaseline('nonexistent', TEST_DIR)
		expect(loaded).toBeNull()
	})
})

describe('compareResults', () => {
	it('identifies regressions', () => {
		const baseline: EvalBaseline = {
			name: 'test-suite',
			timestamp: Date.now(),
			score: 1.0,
			results: [
				{ name: 'case-1', passed: true, score: 1.0 },
				{ name: 'case-2', passed: true, score: 1.0 },
			],
		}

		const current = makeSuiteResult({
			score: 0.5,
			passed: 1,
			failed: 1,
			results: [
				{
					name: 'case-1',
					passed: true,
					score: 1.0,
					criteria: [],
					input: 'hello',
					output: 'world',
					durationMs: 50,
					tags: [],
				},
				{
					name: 'case-2',
					passed: false,
					score: 0.0,
					criteria: [],
					input: 'foo',
					output: 'wrong',
					durationMs: 50,
					tags: [],
				},
			],
		})

		const comparison = compareResults(baseline, current)

		expect(comparison.regression).toBe(true)
		expect(comparison.delta).toBe(-0.5)
		expect(comparison.regressions).toHaveLength(1)
		expect(comparison.regressions[0].name).toBe('case-2')
		expect(comparison.improvements).toHaveLength(0)
	})

	it('identifies improvements', () => {
		const baseline: EvalBaseline = {
			name: 'test-suite',
			timestamp: Date.now(),
			score: 0.5,
			results: [
				{ name: 'case-1', passed: true, score: 1.0 },
				{ name: 'case-2', passed: false, score: 0.0 },
			],
		}

		const current = makeSuiteResult({
			score: 1.0,
			passed: 2,
			failed: 0,
		})

		const comparison = compareResults(baseline, current)

		expect(comparison.regression).toBe(false)
		expect(comparison.delta).toBe(0.5)
		expect(comparison.improvements).toHaveLength(1)
		expect(comparison.improvements[0].name).toBe('case-2')
		expect(comparison.regressions).toHaveLength(0)
	})

	it('detects regression when previously passing case fails', () => {
		const baseline: EvalBaseline = {
			name: 'test-suite',
			timestamp: Date.now(),
			score: 1.0,
			results: [
				{ name: 'case-1', passed: true, score: 1.0 },
				{ name: 'case-2', passed: true, score: 1.0 },
			],
		}

		const current = makeSuiteResult({
			score: 1.0,
			results: [
				{
					name: 'case-1',
					passed: false,
					score: 0.5,
					criteria: [],
					input: 'hello',
					output: 'partial',
					durationMs: 50,
					tags: [],
				},
				{
					name: 'case-2',
					passed: true,
					score: 1.0,
					criteria: [],
					input: 'foo',
					output: 'bar',
					durationMs: 50,
					tags: [],
				},
			],
		})

		const comparison = compareResults(baseline, current)

		expect(comparison.regression).toBe(true)
	})
})

describe('formatComparison', () => {
	it('formats comparison with regressions and improvements', () => {
		const output = formatComparison({
			baselineName: 'baseline-suite',
			currentName: 'current-suite',
			baselineScore: 0.8,
			currentScore: 0.6,
			delta: -0.2,
			regressions: [{ name: 'case-1', baselineScore: 1.0, currentScore: 0.5 }],
			improvements: [{ name: 'case-2', baselineScore: 0.0, currentScore: 1.0 }],
			regression: true,
		})

		expect(output).toContain('baseline-suite')
		expect(output).toContain('current-suite')
		expect(output).toContain('80.0%')
		expect(output).toContain('60.0%')
		expect(output).toContain('-20.0%')
		expect(output).toContain('Regressions (1)')
		expect(output).toContain('case-1')
		expect(output).toContain('Improvements (1)')
		expect(output).toContain('case-2')
		expect(output).toContain('REGRESSION DETECTED')
	})

	it('shows OK when no regression', () => {
		const output = formatComparison({
			baselineName: 'a',
			currentName: 'b',
			baselineScore: 0.5,
			currentScore: 1.0,
			delta: 0.5,
			regressions: [],
			improvements: [],
			regression: false,
		})

		expect(output).toContain('OK')
		expect(output).not.toContain('REGRESSION')
	})
})
