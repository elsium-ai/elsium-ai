import { describe, expect, it } from 'vitest'
import type { EvalDataset } from './dataset'
import {
	type AnnotatedCase,
	createDatasetManifest,
	hashDataset,
	summarizeAnnotations,
} from './dataset-provenance'

const cases: AnnotatedCase[] = [
	{
		name: 'c1',
		annotations: [
			{ annotator: 'alice', label: 1 },
			{ annotator: 'bob', label: 1 },
			{ annotator: 'carol', label: 1 },
		],
	},
	{
		name: 'c2',
		annotations: [
			{ annotator: 'alice', label: 1 },
			{ annotator: 'bob', label: 0 },
			{ annotator: 'carol', label: 0 },
		],
	},
]

describe('summarizeAnnotations', () => {
	it('computes gold label and per-case agreement', () => {
		const r = summarizeAnnotations(cases)
		expect(r.cases[0].goldLabel).toBe('pass')
		expect(r.cases[0].agreement).toBe(1)
		expect(r.cases[1].goldLabel).toBe('fail') // 2 of 3 said fail
		expect(r.cases[1].agreement).toBeCloseTo(2 / 3, 5)
		expect(r.annotators).toHaveLength(3)
	})

	it('flags disputed cases below the threshold', () => {
		const r = summarizeAnnotations(cases, { disputeBelow: 0.8 })
		expect(r.disputedCases).toContain('c2')
		expect(r.disputedCases).not.toContain('c1')
	})

	it('computes Fleiss kappa with uniform rater counts', () => {
		const r = summarizeAnnotations(cases)
		expect(r.fleissKappa).not.toBeNull()
		expect(typeof r.fleissKappa).toBe('number')
	})

	it('returns null kappa when rater counts are not uniform', () => {
		const uneven: AnnotatedCase[] = [
			{
				name: 'a',
				annotations: [
					{ annotator: 'x', label: 1 },
					{ annotator: 'y', label: 1 },
				],
			},
			{ name: 'b', annotations: [{ annotator: 'x', label: 0 }] },
		]
		expect(summarizeAnnotations(uneven).fleissKappa).toBeNull()
	})

	it('handles categorical labels', () => {
		const cat: AnnotatedCase[] = [
			{
				name: 'tone',
				annotations: [
					{ annotator: 'a', label: 'positive' },
					{ annotator: 'b', label: 'positive' },
					{ annotator: 'c', label: 'neutral' },
				],
			},
		]
		const r = summarizeAnnotations(cat)
		expect(r.cases[0].goldLabel).toBe('positive')
	})

	it('throws on empty input', () => {
		expect(() => summarizeAnnotations([])).toThrow()
	})
})

describe('hashDataset / createDatasetManifest', () => {
	const ds: EvalDataset = {
		name: 'quiz',
		version: '1',
		cases: [
			{ name: 'b', input: 'second' },
			{ name: 'a', input: 'first' },
		],
	}

	it('is deterministic and order-independent', async () => {
		const reordered: EvalDataset = { ...ds, cases: [...ds.cases].reverse() }
		expect(await hashDataset(ds)).toBe(await hashDataset(reordered))
	})

	it('changes when content changes', async () => {
		const changed: EvalDataset = {
			...ds,
			cases: [
				{ name: 'a', input: 'CHANGED' },
				{ name: 'b', input: 'second' },
			],
		}
		expect(await hashDataset(ds)).not.toBe(await hashDataset(changed))
	})

	it('builds a manifest with case count and content hash', async () => {
		const m = await createDatasetManifest(ds)
		expect(m.name).toBe('quiz')
		expect(m.caseCount).toBe(2)
		expect(m.contentHash).toMatch(/^[0-9a-f]{64}$/)
	})
})
