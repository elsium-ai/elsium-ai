import { describe, expect, it, vi } from 'vitest'
import {
	type IdempotentStepConfig,
	createInMemoryIdempotentCheckpointStore,
	defaultIdempotencyKey,
	executeIdempotentStep,
	resolveIdempotencyKey,
} from './idempotent-checkpoint'
import { step } from './step'

const baseContext = {
	workflowName: 'wf',
	stepIndex: 0,
	previousOutputs: {},
}

describe('defaultIdempotencyKey', () => {
	it('returns the same hash for equivalent inputs regardless of key order', async () => {
		const a = await defaultIdempotencyKey({ user: 'alice', count: 1 })
		const b = await defaultIdempotencyKey({ count: 1, user: 'alice' })
		expect(a).toBe(b)
	})

	it('returns different hashes for different inputs', async () => {
		expect(await defaultIdempotencyKey({ a: 1 })).not.toBe(await defaultIdempotencyKey({ a: 2 }))
	})

	it('handles arrays, primitives, null deterministically', async () => {
		expect(await defaultIdempotencyKey([1, 2, 3])).toBe(await defaultIdempotencyKey([1, 2, 3]))
		expect(await defaultIdempotencyKey(null)).toBe(await defaultIdempotencyKey(null))
		expect(await defaultIdempotencyKey('hello')).toBe(await defaultIdempotencyKey('hello'))
	})
})

describe('resolveIdempotencyKey', () => {
	it('returns null when step is not idempotent', async () => {
		const s: IdempotentStepConfig = step('s', { handler: async () => 'x' })
		expect(await resolveIdempotencyKey(s, { foo: 1 })).toBeNull()
	})

	it('uses custom idempotencyKey when provided', async () => {
		const s: IdempotentStepConfig<{ id: string }, unknown> = {
			...step('s', { handler: async () => 'x' }),
			idempotent: true,
			idempotencyKey: (input) => `user:${input.id}`,
		}
		expect(await resolveIdempotencyKey(s, { id: '42' })).toBe('user:42')
	})

	it('defaults to a stable SHA-256 over input', async () => {
		const s: IdempotentStepConfig = {
			...step('s', { handler: async () => 'x' }),
			idempotent: true,
		}
		const k = await resolveIdempotencyKey(s, { hello: 'world' })
		expect(k).toMatch(/^[0-9a-f]{64}$/)
	})
})

describe('executeIdempotentStep — side-effect protection', () => {
	it('first call executes; second call with same input returns cached result and does NOT re-run handler', async () => {
		const sideEffect = vi.fn(async (input: { x: number }) => ({ doubled: input.x * 2 }))
		const stepConfig: IdempotentStepConfig<{ x: number }, { doubled: number }> = {
			...step('double', { handler: sideEffect }),
			idempotent: true,
		}
		const store = createInMemoryIdempotentCheckpointStore()

		const r1 = await executeIdempotentStep({
			workflowId: 'wf_1',
			step: stepConfig,
			input: { x: 5 },
			context: baseContext,
			store,
		})
		expect(r1.status).toBe('completed')
		expect(r1.data).toEqual({ doubled: 10 })
		expect(sideEffect).toHaveBeenCalledTimes(1)

		const r2 = await executeIdempotentStep({
			workflowId: 'wf_1',
			step: stepConfig,
			input: { x: 5 },
			context: baseContext,
			store,
		})
		expect(r2.status).toBe('completed')
		expect(r2.data).toEqual({ doubled: 10 })
		expect(sideEffect).toHaveBeenCalledTimes(1) // NOT re-invoked
	})

	it('different inputs to the same step produce different cache entries', async () => {
		const sideEffect = vi.fn(async (input: { x: number }) => ({ doubled: input.x * 2 }))
		const stepConfig: IdempotentStepConfig<{ x: number }, { doubled: number }> = {
			...step('double', { handler: sideEffect }),
			idempotent: true,
		}
		const store = createInMemoryIdempotentCheckpointStore()

		await executeIdempotentStep({
			workflowId: 'wf_1',
			step: stepConfig,
			input: { x: 5 },
			context: baseContext,
			store,
		})
		await executeIdempotentStep({
			workflowId: 'wf_1',
			step: stepConfig,
			input: { x: 7 },
			context: baseContext,
			store,
		})
		expect(sideEffect).toHaveBeenCalledTimes(2)
	})

	it('cache is scoped per workflowId — same input under a different workflow re-executes', async () => {
		const sideEffect = vi.fn(async (input: { x: number }) => input.x)
		const stepConfig: IdempotentStepConfig<{ x: number }, number> = {
			...step('s', { handler: sideEffect }),
			idempotent: true,
		}
		const store = createInMemoryIdempotentCheckpointStore()

		await executeIdempotentStep({
			workflowId: 'wf_a',
			step: stepConfig,
			input: { x: 1 },
			context: baseContext,
			store,
		})
		await executeIdempotentStep({
			workflowId: 'wf_b',
			step: stepConfig,
			input: { x: 1 },
			context: baseContext,
			store,
		})
		expect(sideEffect).toHaveBeenCalledTimes(2)
	})

	it('caches failures and replays them on re-execution', async () => {
		const handler = vi.fn(async () => {
			throw new Error('external API 500')
		})
		const stepConfig: IdempotentStepConfig = {
			...step('flaky', { handler }),
			idempotent: true,
		}
		const store = createInMemoryIdempotentCheckpointStore()

		const r1 = await executeIdempotentStep({
			workflowId: 'wf_1',
			step: stepConfig,
			input: { foo: 1 },
			context: baseContext,
			store,
		})
		expect(r1.status).toBe('failed')
		expect(r1.error).toContain('external API 500')

		const r2 = await executeIdempotentStep({
			workflowId: 'wf_1',
			step: stepConfig,
			input: { foo: 1 },
			context: baseContext,
			store,
		})
		expect(r2.status).toBe('failed')
		expect(handler).toHaveBeenCalledTimes(1) // failure replayed from cache, not re-invoked
	})

	it('non-idempotent steps bypass the store entirely', async () => {
		const sideEffect = vi.fn(async () => 'x')
		const stepConfig: IdempotentStepConfig = step('s', { handler: sideEffect })
		const store = createInMemoryIdempotentCheckpointStore()

		await executeIdempotentStep({
			workflowId: 'wf_1',
			step: stepConfig,
			input: { x: 1 },
			context: baseContext,
			store,
		})
		await executeIdempotentStep({
			workflowId: 'wf_1',
			step: stepConfig,
			input: { x: 1 },
			context: baseContext,
			store,
		})
		expect(sideEffect).toHaveBeenCalledTimes(2)
		const history = await store.listStepHistory('wf_1')
		expect(history).toHaveLength(0) // nothing recorded
	})

	it('custom idempotencyKey collapses semantically equivalent inputs', async () => {
		const sideEffect = vi.fn(async (input: { msg: string; trace?: string }) => input.msg)
		const stepConfig: IdempotentStepConfig<{ msg: string; trace?: string }, string> = {
			...step('s', { handler: sideEffect }),
			idempotent: true,
			idempotencyKey: (input) => input.msg, // ignore trace
		}
		const store = createInMemoryIdempotentCheckpointStore()

		await executeIdempotentStep({
			workflowId: 'wf_1',
			step: stepConfig,
			input: { msg: 'send-email', trace: 'a' },
			context: baseContext,
			store,
		})
		await executeIdempotentStep({
			workflowId: 'wf_1',
			step: stepConfig,
			input: { msg: 'send-email', trace: 'b' },
			context: baseContext,
			store,
		})
		expect(sideEffect).toHaveBeenCalledTimes(1)
	})
})

describe('IdempotentCheckpointStore — history + delete', () => {
	const stepConfig: IdempotentStepConfig = {
		...step('s', { handler: async () => 'ok' }),
		idempotent: true,
	}

	it('listStepHistory returns every recorded step for a workflow', async () => {
		const store = createInMemoryIdempotentCheckpointStore()
		await executeIdempotentStep({
			workflowId: 'wf_1',
			step: stepConfig,
			input: { a: 1 },
			context: baseContext,
			store,
		})
		await executeIdempotentStep({
			workflowId: 'wf_1',
			step: stepConfig,
			input: { a: 2 },
			context: baseContext,
			store,
		})
		const history = await store.listStepHistory('wf_1')
		expect(history).toHaveLength(2)
	})

	it('delete(workflowId) clears step results for that workflow only', async () => {
		const store = createInMemoryIdempotentCheckpointStore()
		await executeIdempotentStep({
			workflowId: 'wf_a',
			step: stepConfig,
			input: { x: 1 },
			context: baseContext,
			store,
		})
		await executeIdempotentStep({
			workflowId: 'wf_b',
			step: stepConfig,
			input: { x: 1 },
			context: baseContext,
			store,
		})

		await store.delete('wf_a')

		expect(await store.listStepHistory('wf_a')).toHaveLength(0)
		expect(await store.listStepHistory('wf_b')).toHaveLength(1)
	})
})
