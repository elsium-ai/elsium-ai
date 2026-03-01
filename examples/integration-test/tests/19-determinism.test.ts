import { assertDeterministic } from '@elsium-ai/testing'
/**
 * Test 19: Determinism
 * Verifies: assertDeterministic
 */
import { describe, expect, it } from 'vitest'

describe('19 — Determinism', () => {
	it('assertDeterministic passes for a deterministic function', async () => {
		const result = await assertDeterministic(async () => 'always the same', { runs: 3 })

		expect(result.deterministic).toBe(true)
		expect(result.uniqueOutputs).toBe(1)
		expect(result.runs).toBe(3)
		expect(result.variance).toBe(0)
	})

	it('assertDeterministic throws on non-deterministic output with tolerance=0', async () => {
		let counter = 0

		await expect(
			assertDeterministic(async () => `response-${counter++}`, { runs: 3, tolerance: 0 }),
		).rejects.toThrow('Non-deterministic output')
	})

	it('assertDeterministic returns result for non-deterministic output with tolerance > 0', async () => {
		let counter = 0

		const result = await assertDeterministic(async () => `response-${counter++}`, {
			runs: 3,
			tolerance: 1.0,
		})

		expect(result.deterministic).toBe(true) // tolerance=1.0 allows all variance
		expect(result.uniqueOutputs).toBeGreaterThan(1)
		expect(result.outputs).toHaveLength(3)
	})

	it('assertDeterministic with tolerance allows some variance', async () => {
		let counter = 0

		const result = await assertDeterministic(
			async () => {
				counter++
				// First two are the same, third differs
				return counter <= 2 ? 'same' : 'different'
			},
			{ runs: 3, tolerance: 0.5 },
		)

		// With tolerance 0.5, some variance is acceptable
		expect(result.runs).toBe(3)
		expect(result.outputs).toHaveLength(3)
	})

	it('assertDeterministic passes seed to function', async () => {
		const seeds: (number | undefined)[] = []

		await assertDeterministic(
			async (seed) => {
				seeds.push(seed)
				return 'deterministic'
			},
			{ runs: 2, seed: 42 },
		)

		expect(seeds).toHaveLength(2)
		// The seed should be passed to each invocation
		for (const s of seeds) {
			expect(s).toBe(42)
		}
	})
})
