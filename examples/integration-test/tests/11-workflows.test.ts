import { defineWorkflow, step } from '@elsium-ai/workflows'
/**
 * Test 11: Workflows
 * Verifies: defineWorkflow, step
 */
import { describe, expect, it } from 'vitest'

describe('11 — Workflows', () => {
	it('step() creates a step config', () => {
		const s = step('greet', {
			handler: async (input: string) => `Hello, ${input}!`,
		})

		expect(s.name).toBe('greet')
		expect(typeof s.handler).toBe('function')
	})

	it('defineWorkflow creates a runnable workflow', async () => {
		const workflow = defineWorkflow({
			name: 'greeting-pipeline',
			steps: [
				step('normalize', {
					handler: async (input: string) => input.trim().toLowerCase(),
				}),
				step('greet', {
					handler: async (input: string) => `Hello, ${input}!`,
				}),
			],
		})

		expect(workflow.name).toBe('greeting-pipeline')

		const result = await workflow.run('  World  ')

		expect(result.status).toBe('completed')
		expect(result.steps).toHaveLength(2)
		expect(result.totalDurationMs).toBeGreaterThanOrEqual(0)
	})

	it('workflow steps execute sequentially', async () => {
		const order: string[] = []

		const workflow = defineWorkflow({
			name: 'sequence-test',
			steps: [
				step('step-1', {
					handler: async (input: number) => {
						order.push('first')
						return input + 1
					},
				}),
				step('step-2', {
					handler: async (input: number) => {
						order.push('second')
						return input * 2
					},
				}),
				step('step-3', {
					handler: async (input: number) => {
						order.push('third')
						return input + 10
					},
				}),
			],
		})

		const result = await workflow.run(5)

		expect(order).toEqual(['first', 'second', 'third'])
		expect(result.status).toBe('completed')
	})

	it('workflow with onStepComplete callback', async () => {
		const completedSteps: string[] = []

		const workflow = defineWorkflow({
			name: 'callback-test',
			steps: [
				step('a', { handler: async () => 'done-a' }),
				step('b', { handler: async () => 'done-b' }),
			],
			onStepComplete: (result) => {
				completedSteps.push(result.name)
			},
		})

		await workflow.run(null)

		expect(completedSteps).toEqual(['a', 'b'])
	})

	it('workflow with conditional step', async () => {
		const workflow = defineWorkflow({
			name: 'conditional-test',
			steps: [
				step('always', { handler: async (input: number) => input }),
				step('conditional', {
					handler: async (input: number) => input * 100,
					condition: (input: number) => input > 10,
				}),
			],
		})

		const result = await workflow.run(5)

		// The conditional step should have been skipped
		expect(result.status).toBe('completed')
	})
})
