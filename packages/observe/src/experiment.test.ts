import { describe, expect, it } from 'vitest'
import { createExperiment } from './experiment'
import type { ExperimentVariant } from './experiment'

// ─── createExperiment ───────────────────────────────────────────

describe('createExperiment', () => {
	const defaultVariants: ExperimentVariant[] = [
		{ name: 'control', weight: 50, config: { model: 'gpt-4o' } },
		{ name: 'treatment', weight: 50, config: { model: 'claude-sonnet-4-6' } },
	]

	it('throws when variants array is empty', () => {
		expect(() => createExperiment({ name: 'test-exp', variants: [] })).toThrow(
			'Experiment must have at least one variant',
		)
	})

	it('assigns a variant based on weight distribution', () => {
		const experiment = createExperiment({
			name: 'test-exp',
			variants: defaultVariants,
		})

		const counts: Record<string, number> = { control: 0, treatment: 0 }
		// With random assignment, run many times and check distribution
		for (let i = 0; i < 1000; i++) {
			const variant = experiment.assign()
			counts[variant.name]++
		}

		// With 50/50 weight, each should get roughly 500 (within tolerance)
		expect(counts.control).toBeGreaterThan(300)
		expect(counts.treatment).toBeGreaterThan(300)
	})

	it('assigns deterministically with the same userId', () => {
		const experiment = createExperiment({
			name: 'test-exp',
			variants: defaultVariants,
		})

		const first = experiment.assign('user-123')
		const second = experiment.assign('user-123')
		const third = experiment.assign('user-123')

		expect(first.name).toBe(second.name)
		expect(second.name).toBe(third.name)
	})

	it('different userIds may get different variants', () => {
		const experiment = createExperiment({
			name: 'test-exp',
			variants: defaultVariants,
		})

		const assignments = new Set<string>()
		// Try many users to see if we get both variants
		for (let i = 0; i < 100; i++) {
			const variant = experiment.assign(`user-${i}`)
			assignments.add(variant.name)
		}

		// With 50/50 weights and 100 users, we should see both variants
		expect(assignments.size).toBe(2)
	})

	it('returns the variant config', () => {
		const experiment = createExperiment({
			name: 'test-exp',
			variants: defaultVariants,
		})

		const variant = experiment.assign('user-42')
		expect(variant.config).toBeDefined()
		expect(typeof variant.config).toBe('object')
		// Config should be one of the defined variants
		const validConfigs = defaultVariants.map((v) => v.config)
		expect(validConfigs).toContainEqual(variant.config)
	})

	it('records metrics for a variant', () => {
		const experiment = createExperiment({
			name: 'test-exp',
			variants: defaultVariants,
		})

		experiment.record('control', { latency: 100 })
		experiment.record('control', { latency: 200 })
		experiment.record('treatment', { latency: 150 })

		const results = experiment.results()

		expect(results.variants.control.metrics.latency.sum).toBe(300)
		expect(results.variants.control.metrics.latency.count).toBe(2)
		expect(results.variants.control.metrics.latency.avg).toBe(150)

		expect(results.variants.treatment.metrics.latency.sum).toBe(150)
		expect(results.variants.treatment.metrics.latency.count).toBe(1)
		expect(results.variants.treatment.metrics.latency.avg).toBe(150)
	})

	it('records multiple metric keys', () => {
		const experiment = createExperiment({
			name: 'test-exp',
			variants: defaultVariants,
		})

		experiment.record('control', { latency: 100, cost: 0.01 })
		experiment.record('control', { latency: 200, cost: 0.02 })

		const results = experiment.results()

		expect(results.variants.control.metrics.latency.avg).toBe(150)
		expect(results.variants.control.metrics.cost.avg).toBeCloseTo(0.015)
	})

	it('ignores record for unknown variant', () => {
		const experiment = createExperiment({
			name: 'test-exp',
			variants: defaultVariants,
		})

		// Should not throw
		experiment.record('nonexistent', { latency: 100 })

		const results = experiment.results()
		expect(results.variants.nonexistent).toBeUndefined()
	})

	it('tracks assignment counts in results', () => {
		const experiment = createExperiment({
			name: 'test-exp',
			variants: defaultVariants,
		})

		experiment.assign('user-1')
		experiment.assign('user-2')
		experiment.assign('user-3')

		const results = experiment.results()
		expect(results.totalAssignments).toBe(3)
		expect(results.name).toBe('test-exp')

		const totalFromVariants =
			results.variants.control.assignments + results.variants.treatment.assignments
		expect(totalFromVariants).toBe(3)
	})

	it('results returns empty metrics when nothing recorded', () => {
		const experiment = createExperiment({
			name: 'test-exp',
			variants: defaultVariants,
		})

		const results = experiment.results()

		expect(results.variants.control.metrics).toEqual({})
		expect(results.variants.treatment.metrics).toEqual({})
		expect(results.totalAssignments).toBe(0)
	})

	it('handles uneven weight distribution', () => {
		const experiment = createExperiment({
			name: 'test-exp',
			variants: [
				{ name: 'control', weight: 90, config: {} },
				{ name: 'treatment', weight: 10, config: {} },
			],
		})

		const counts: Record<string, number> = { control: 0, treatment: 0 }
		for (let i = 0; i < 1000; i++) {
			const variant = experiment.assign()
			counts[variant.name]++
		}

		// Control should get significantly more assignments
		expect(counts.control).toBeGreaterThan(counts.treatment)
		expect(counts.control).toBeGreaterThan(700) // ~90% of 1000
	})

	it('works with a single variant', () => {
		const experiment = createExperiment({
			name: 'single-variant',
			variants: [{ name: 'only', weight: 100, config: { model: 'test' } }],
		})

		const variant = experiment.assign('user-1')
		expect(variant.name).toBe('only')

		const variant2 = experiment.assign()
		expect(variant2.name).toBe('only')
	})
})
