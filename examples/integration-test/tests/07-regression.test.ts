import { createRegressionSuite } from '@elsium-ai/testing'
/**
 * Test 07: Regression Testing
 * Verifies: createRegressionSuite
 */
import { describe, expect, it } from 'vitest'

describe('07 — Regression Suite', () => {
	it('creates a regression suite with cases', () => {
		const suite = createRegressionSuite('my-regression')

		expect(suite.baseline).toBeNull()

		suite.addCase('hello', 'Hello!', 1.0)
		suite.addCase('goodbye', 'Bye!', 0.9)

		expect(suite.baseline).not.toBeNull()
		expect(suite.baseline?.cases).toHaveLength(2)
	})

	it('runs regression and detects no regressions on stable output', async () => {
		const suite = createRegressionSuite('stable-test')

		suite.addCase('input-a', 'output-a', 1.0)
		suite.addCase('input-b', 'output-b', 1.0)

		const result = await suite.run(async (input) => input.replace('input', 'output'))

		expect(result.totalCases).toBe(2)
		expect(result.regressions).toHaveLength(0)
	})

	it('detects regressions when output changes', async () => {
		const suite = createRegressionSuite('drift-test')

		suite.addCase('hello', 'Hello!', 1.0)

		const result = await suite.run(
			async () => 'Completely different',
			async (_input, output) => (output === 'Hello!' ? 1.0 : 0.2),
		)

		expect(result.regressions.length).toBeGreaterThan(0)
	})
})
