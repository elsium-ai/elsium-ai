import { describe, expect, it } from 'vitest'
import {
	computeClassificationReport,
	computeConfusionMatrix,
	formatClassificationReport,
	formatConfusionMatrix,
	runClassificationEval,
} from './classification'

const CASES = [
	{ predicted: 'APPROVE', actual: 'APPROVE' },
	{ predicted: 'APPROVE', actual: 'APPROVE' },
	{ predicted: 'DENY', actual: 'DENY' },
	{ predicted: 'DENY', actual: 'REVIEW' },
	{ predicted: 'REVIEW', actual: 'REVIEW' },
	{ predicted: 'APPROVE', actual: 'DENY' },
]

describe('computeConfusionMatrix', () => {
	it('builds a square matrix indexed by sorted labels', () => {
		const cm = computeConfusionMatrix(CASES)
		expect(cm.labels).toEqual(['APPROVE', 'DENY', 'REVIEW'])
		expect(cm.matrix).toEqual([
			[2, 0, 0],
			[1, 1, 0],
			[0, 1, 1],
		])
	})

	it('respects an explicit label set and ignores out-of-set labels', () => {
		const cm = computeConfusionMatrix(
			[
				{ predicted: 'YES', actual: 'YES' },
				{ predicted: 'MAYBE', actual: 'NO' },
			],
			{ labels: ['YES', 'NO'] },
		)
		expect(cm.labels).toEqual(['YES', 'NO'])
		expect(cm.matrix).toEqual([
			[1, 0],
			[0, 0],
		])
	})
})

describe('computeClassificationReport', () => {
	it('computes accuracy, per-label and averaged metrics', () => {
		const report = computeClassificationReport(CASES)
		expect(report.total).toBe(6)
		expect(report.correct).toBe(4)
		expect(report.accuracy).toBeCloseTo(4 / 6)

		const approve = report.perLabel.find((m) => m.label === 'APPROVE')
		expect(approve?.support).toBe(2)
		expect(approve?.recall).toBeCloseTo(1)
		expect(approve?.precision).toBeCloseTo(2 / 3)
		expect(approve?.f1).toBeCloseTo((2 * (2 / 3)) / (2 / 3 + 1))

		expect(report.micro.precision).toBeCloseTo(report.accuracy)
		expect(report.macro.precision).toBeGreaterThan(0)
		expect(report.weighted.recall).toBeGreaterThan(0)
	})

	it('returns zeroed metrics for empty input without dividing by zero', () => {
		const report = computeClassificationReport([])
		expect(report.total).toBe(0)
		expect(report.accuracy).toBe(0)
		expect(report.macro.f1).toBe(0)
		expect(report.perLabel).toEqual([])
	})
})

describe('runClassificationEval', () => {
	it('runs a classifier and reports metrics', async () => {
		const result = await runClassificationEval({
			name: 'claims',
			labels: ['APPROVE', 'DENY'],
			cases: [
				{ input: 'low risk', expected: 'APPROVE' },
				{ input: 'fraud', expected: 'DENY' },
				{ input: 'edge', expected: 'DENY' },
			],
			runner: async (input) => (input === 'fraud' ? 'DENY' : 'APPROVE'),
		})
		expect(result.report.total).toBe(3)
		expect(result.predictions[0].correct).toBe(true)
		expect(result.predictions[2].correct).toBe(false)
		expect(result.report.accuracy).toBeCloseTo(2 / 3)
	})

	it('captures runner errors as incorrect predictions', async () => {
		const result = await runClassificationEval({
			name: 'errors',
			cases: [{ input: 'boom', expected: 'APPROVE' }],
			runner: async () => {
				throw new Error('model down')
			},
		})
		expect(result.predictions[0].correct).toBe(false)
		expect(result.predictions[0].error).toBe('model down')
	})

	it('supports concurrency batching', async () => {
		const result = await runClassificationEval({
			name: 'batched',
			concurrency: 2,
			cases: [
				{ input: 'a', expected: 'A' },
				{ input: 'b', expected: 'B' },
				{ input: 'c', expected: 'A' },
			],
			runner: async (input) => input.toUpperCase(),
		})
		expect(result.predictions).toHaveLength(3)
		expect(result.report.accuracy).toBeCloseTo(2 / 3)
	})
})

describe('formatting', () => {
	it('renders a confusion matrix and a report without throwing', () => {
		const report = computeClassificationReport(CASES)
		const cm = formatConfusionMatrix(report.confusion)
		expect(cm).toContain('Confusion Matrix')
		expect(cm).toContain('APPROVE')

		const text = formatClassificationReport(report)
		expect(text).toContain('Classification Report')
		expect(text).toContain('accuracy')
		expect(text).toContain('%')
	})
})
