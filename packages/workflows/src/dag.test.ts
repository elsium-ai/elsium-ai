import { describe, expect, it, vi } from 'vitest'
import { defineDagWorkflow } from './dag'
import type { DagStepConfig } from './types'

describe('defineDagWorkflow', () => {
	describe('topological ordering', () => {
		it('steps with no deps run before steps that depend on them', async () => {
			const order: string[] = []

			const steps: DagStepConfig[] = [
				{
					name: 'C',
					dependsOn: ['B'],
					handler: async () => {
						order.push('C')
						return 'c'
					},
				},
				{
					name: 'B',
					dependsOn: ['A'],
					handler: async () => {
						order.push('B')
						return 'b'
					},
				},
				{
					name: 'A',
					handler: async () => {
						order.push('A')
						return 'a'
					},
				},
			]

			const workflow = defineDagWorkflow({ name: 'test', steps })
			const result = await workflow.run('input')

			expect(result.status).toBe('completed')
			expect(order.indexOf('A')).toBeLessThan(order.indexOf('B'))
			expect(order.indexOf('B')).toBeLessThan(order.indexOf('C'))
		})
	})

	describe('parallel wave execution', () => {
		it('independent steps in the same wave run in parallel', async () => {
			const startTimes: Record<string, number> = {}
			const endTimes: Record<string, number> = {}

			const steps: DagStepConfig[] = [
				{
					name: 'A',
					handler: async () => {
						startTimes.A = Date.now()
						await new Promise((r) => setTimeout(r, 30))
						endTimes.A = Date.now()
						return 'a'
					},
				},
				{
					name: 'B',
					handler: async () => {
						startTimes.B = Date.now()
						await new Promise((r) => setTimeout(r, 30))
						endTimes.B = Date.now()
						return 'b'
					},
				},
				{
					name: 'C',
					dependsOn: ['A', 'B'],
					handler: async () => 'c',
				},
			]

			const workflow = defineDagWorkflow({ name: 'parallel-test', steps })
			const result = await workflow.run('input')

			expect(result.status).toBe('completed')
			// A and B started before either finished — they ran in parallel
			expect(startTimes.A).toBeLessThan(endTimes.B)
			expect(startTimes.B).toBeLessThan(endTimes.A)
		})
	})

	describe('cycle detection', () => {
		it('throws an error when a circular dependency exists', async () => {
			const steps: DagStepConfig[] = [
				{
					name: 'A',
					dependsOn: ['B'],
					handler: async () => 'a',
				},
				{
					name: 'B',
					dependsOn: ['A'],
					handler: async () => 'b',
				},
			]

			const workflow = defineDagWorkflow({ name: 'cycle-test', steps })
			await expect(workflow.run('input')).rejects.toThrow(/cycle detected/i)
		})
	})

	describe('missing dependency', () => {
		it('throws an error when dependsOn references an unknown step', async () => {
			const steps: DagStepConfig[] = [
				{
					name: 'A',
					dependsOn: ['nonexistent'],
					handler: async () => 'a',
				},
			]

			const workflow = defineDagWorkflow({ name: 'missing-dep-test', steps })
			await expect(workflow.run('input')).rejects.toThrow(/unknown step/i)
		})
	})

	describe('basic DAG: A → B → C', () => {
		it('executes steps in order and produces correct outputs', async () => {
			const steps: DagStepConfig[] = [
				{
					name: 'A',
					handler: async (input) => `${input}-A`,
				},
				{
					name: 'B',
					dependsOn: ['A'],
					handler: async (input) => `${input}-B`,
				},
				{
					name: 'C',
					dependsOn: ['B'],
					handler: async (input) => `${input}-C`,
				},
			]

			const workflow = defineDagWorkflow({ name: 'abc-workflow', steps })
			const result = await workflow.run('start')

			expect(result.status).toBe('completed')
			expect(result.name).toBe('abc-workflow')
			expect(result.steps).toHaveLength(3)

			// A receives the initial input
			expect(result.outputs.A).toBe('start-A')
			// B receives A's output as input
			expect(result.outputs.B).toBe('start-A-B')
			// C receives B's output as input
			expect(result.outputs.C).toBe('start-A-B-C')

			const stepNames = result.steps.map((s) => s.name)
			expect(stepNames.indexOf('A')).toBeLessThan(stepNames.indexOf('B'))
			expect(stepNames.indexOf('B')).toBeLessThan(stepNames.indexOf('C'))
		})

		it('calls onStepComplete for each step', async () => {
			const completed: string[] = []

			const steps: DagStepConfig[] = [
				{ name: 'A', handler: async () => 'a' },
				{ name: 'B', dependsOn: ['A'], handler: async () => 'b' },
				{ name: 'C', dependsOn: ['B'], handler: async () => 'c' },
			]

			const workflow = defineDagWorkflow({
				name: 'abc-workflow',
				steps,
				onStepComplete: async (result) => {
					completed.push(result.name)
				},
			})

			await workflow.run('input')
			expect(completed).toEqual(['A', 'B', 'C'])
		})

		it('calls onComplete with the workflow result', async () => {
			const onComplete = vi.fn()

			const steps: DagStepConfig[] = [{ name: 'A', handler: async () => 'a' }]

			const workflow = defineDagWorkflow({ name: 'abc-workflow', steps, onComplete })
			await workflow.run('input')

			expect(onComplete).toHaveBeenCalledOnce()
			const [workflowResult] = onComplete.mock.calls[0]
			expect(workflowResult.status).toBe('completed')
			expect(workflowResult.name).toBe('abc-workflow')
		})

		it('stops execution and marks workflow as failed when a step fails', async () => {
			const ranSteps: string[] = []

			const steps: DagStepConfig[] = [
				{
					name: 'A',
					handler: async () => {
						ranSteps.push('A')
						throw new Error('step A failed')
					},
				},
				{
					name: 'B',
					dependsOn: ['A'],
					handler: async () => {
						ranSteps.push('B')
						return 'b'
					},
				},
			]

			const workflow = defineDagWorkflow({ name: 'fail-test', steps })
			const result = await workflow.run('input')

			expect(result.status).toBe('failed')
			expect(ranSteps).not.toContain('B')
		})
	})
})
