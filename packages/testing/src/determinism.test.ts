import { describe, expect, it } from 'vitest'
import { assertDeterministic, assertStable } from './determinism'

describe('assertDeterministic', () => {
	it('passes for deterministic function', async () => {
		const result = await assertDeterministic(async () => 'always same', { runs: 3 })

		expect(result.deterministic).toBe(true)
		expect(result.uniqueOutputs).toBe(1)
		expect(result.variance).toBe(0)
		expect(result.runs).toBe(3)
	})

	it('throws for non-deterministic function', async () => {
		let counter = 0
		await expect(
			assertDeterministic(async () => `output-${counter++}`, { runs: 3 }),
		).rejects.toThrow('Non-deterministic')
	})

	it('passes with tolerance for some variance', async () => {
		let counter = 0
		const result = await assertDeterministic(async () => (counter++ < 2 ? 'same' : 'different'), {
			runs: 3,
			tolerance: 0.5,
		})

		expect(result.deterministic).toBe(true)
	})

	it('propagates seed to function', async () => {
		const seeds: Array<number | undefined> = []
		await assertDeterministic(
			async (seed) => {
				seeds.push(seed)
				return 'test'
			},
			{ runs: 2, seed: 42 },
		)

		expect(seeds).toEqual([42, 42])
	})

	it('returns all outputs', async () => {
		const result = await assertDeterministic(async () => 'hello', { runs: 3 })
		expect(result.outputs).toEqual(['hello', 'hello', 'hello'])
	})

	it('defaults to 5 runs', async () => {
		const result = await assertDeterministic(async () => 'test')
		expect(result.runs).toBe(5)
		expect(result.outputs).toHaveLength(5)
	})
})

describe('assertStable', () => {
	it('reports stable for consistent function', async () => {
		const result = await assertStable(async () => 'consistent', { runs: 3, intervalMs: 10 })

		expect(result.stable).toBe(true)
		expect(result.uniqueOutputs).toBe(1)
		expect(result.variance).toBe(0)
	})

	it('reports unstable for varying function', async () => {
		let counter = 0
		const result = await assertStable(async () => `output-${counter++}`, {
			runs: 3,
			intervalMs: 10,
		})

		expect(result.stable).toBe(false)
		expect(result.uniqueOutputs).toBe(3)
	})

	it('includes timestamps in outputs', async () => {
		const result = await assertStable(async () => 'test', { runs: 2, intervalMs: 10 })

		expect(result.outputs).toHaveLength(2)
		expect(result.outputs[0].timestamp).toBeGreaterThan(0)
		expect(result.outputs[1].timestamp).toBeGreaterThanOrEqual(result.outputs[0].timestamp)
	})

	it('propagates seed', async () => {
		const seeds: Array<number | undefined> = []
		await assertStable(
			async (seed) => {
				seeds.push(seed)
				return 'test'
			},
			{ runs: 2, seed: 42, intervalMs: 10 },
		)

		expect(seeds).toEqual([42, 42])
	})

	it('spaces runs by intervalMs', async () => {
		const timestamps: number[] = []
		await assertStable(
			async () => {
				timestamps.push(Date.now())
				return 'test'
			},
			{ runs: 3, intervalMs: 50 },
		)

		// Check that runs are spaced by at least 40ms (giving some tolerance)
		for (let i = 1; i < timestamps.length; i++) {
			expect(timestamps[i] - timestamps[i - 1]).toBeGreaterThanOrEqual(40)
		}
	})
})
