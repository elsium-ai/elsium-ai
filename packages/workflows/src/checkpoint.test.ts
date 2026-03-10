import { describe, expect, it, vi } from 'vitest'
import { createInMemoryCheckpointStore, defineResumableWorkflow } from './checkpoint'

function step(name: string, handler: (input: unknown) => Promise<unknown>) {
	return { name, handler }
}

describe('createInMemoryCheckpointStore', () => {
	it('saves and loads checkpoints', async () => {
		const store = createInMemoryCheckpointStore()

		const checkpoint = {
			workflowId: 'wf-1',
			workflowName: 'test',
			status: 'running' as const,
			input: 'input',
			currentStepIndex: 0,
			stepResults: [],
			outputs: {},
			createdAt: Date.now(),
			updatedAt: Date.now(),
		}

		await store.save(checkpoint)
		const loaded = await store.load('wf-1')

		expect(loaded).toEqual(checkpoint)
	})

	it('returns null for non-existent checkpoint', async () => {
		const store = createInMemoryCheckpointStore()
		expect(await store.load('nope')).toBeNull()
	})

	it('deletes checkpoints', async () => {
		const store = createInMemoryCheckpointStore()

		await store.save({
			workflowId: 'wf-1',
			workflowName: 'test',
			status: 'completed',
			input: 'x',
			currentStepIndex: 0,
			stepResults: [],
			outputs: {},
			createdAt: Date.now(),
			updatedAt: Date.now(),
		})

		await store.delete('wf-1')
		expect(await store.load('wf-1')).toBeNull()
	})

	it('lists checkpoints with optional name filter', async () => {
		const store = createInMemoryCheckpointStore()

		await store.save({
			workflowId: 'wf-1',
			workflowName: 'alpha',
			status: 'completed',
			input: 'a',
			currentStepIndex: 0,
			stepResults: [],
			outputs: {},
			createdAt: Date.now(),
			updatedAt: Date.now(),
		})

		await store.save({
			workflowId: 'wf-2',
			workflowName: 'beta',
			status: 'running',
			input: 'b',
			currentStepIndex: 0,
			stepResults: [],
			outputs: {},
			createdAt: Date.now(),
			updatedAt: Date.now(),
		})

		const all = await store.list()
		expect(all).toHaveLength(2)

		const alphaOnly = await store.list('alpha')
		expect(alphaOnly).toHaveLength(1)
		expect(alphaOnly[0].workflowId).toBe('wf-1')
	})
})

describe('defineResumableWorkflow', () => {
	it('saves checkpoints for each step during execution', async () => {
		const store = createInMemoryCheckpointStore()
		const saveSpy = vi.spyOn(store, 'save')

		const workflow = defineResumableWorkflow({
			name: 'test-wf',
			checkpointStore: store,
			steps: [
				step('step-a', async (input: unknown) => `${input}-a`),
				step('step-b', async (input: unknown) => `${input}-b`),
			],
		})

		const result = await workflow.run('start', { workflowId: 'wf-test' })

		expect(result.status).toBe('completed')
		expect(result.outputs['step-a']).toBe('start-a')
		expect(result.outputs['step-b']).toBe('start-a-b')
		expect(saveSpy).toHaveBeenCalled()
	})

	it('creates a failed checkpoint when a step fails', async () => {
		const store = createInMemoryCheckpointStore()

		const workflow = defineResumableWorkflow({
			name: 'fail-wf',
			checkpointStore: store,
			steps: [
				step('step-ok', async (input: unknown) => `${input}-ok`),
				step('step-fail', async () => {
					throw new Error('boom')
				}),
			],
		})

		const result = await workflow.run('start', { workflowId: 'wf-fail' })

		expect(result.status).toBe('failed')

		const checkpoint = await store.load('wf-fail')
		expect(checkpoint).not.toBeNull()
		expect(checkpoint?.status).toBe('failed')
		expect(checkpoint?.currentStepIndex).toBe(1)
	})

	it('resumes a failed workflow from the failed step', async () => {
		const store = createInMemoryCheckpointStore()

		let failOnce = true
		const workflow = defineResumableWorkflow({
			name: 'resume-wf',
			checkpointStore: store,
			steps: [
				step('step-1', async (input: unknown) => `${input}-1`),
				step('step-2', async (input: unknown) => {
					if (failOnce) {
						failOnce = false
						throw new Error('transient')
					}
					return `${input}-2`
				}),
				step('step-3', async (input: unknown) => `${input}-3`),
			],
		})

		const firstRun = await workflow.run('start', { workflowId: 'wf-resume' })
		expect(firstRun.status).toBe('failed')

		const resumed = await workflow.resume('wf-resume')
		expect(resumed.status).toBe('completed')
		expect(resumed.outputs['step-2']).toBe('start-1-2')
		expect(resumed.outputs['step-3']).toBe('start-1-2-3')
	})

	it('returns completed result when resuming an already-completed workflow', async () => {
		const store = createInMemoryCheckpointStore()

		const workflow = defineResumableWorkflow({
			name: 'done-wf',
			checkpointStore: store,
			steps: [step('step-1', async (input: unknown) => `${input}-done`)],
		})

		await workflow.run('x', { workflowId: 'wf-done' })
		const result = await workflow.resume('wf-done')

		expect(result.status).toBe('completed')
	})

	it('throws when resuming a non-existent workflow', async () => {
		const store = createInMemoryCheckpointStore()

		const workflow = defineResumableWorkflow({
			name: 'test',
			checkpointStore: store,
			steps: [],
		})

		await expect(workflow.resume('nope')).rejects.toThrow('No checkpoint found')
	})

	it('listCheckpoints filters by workflow name', async () => {
		const store = createInMemoryCheckpointStore()

		const wf1 = defineResumableWorkflow({
			name: 'wf-alpha',
			checkpointStore: store,
			steps: [step('s1', async () => 'ok')],
		})

		const wf2 = defineResumableWorkflow({
			name: 'wf-beta',
			checkpointStore: store,
			steps: [step('s1', async () => 'ok')],
		})

		await wf1.run('a', { workflowId: 'a1' })
		await wf2.run('b', { workflowId: 'b1' })

		const alphaCheckpoints = await wf1.listCheckpoints()
		expect(alphaCheckpoints).toHaveLength(1)
		expect(alphaCheckpoints[0].workflowName).toBe('wf-alpha')
	})
})
