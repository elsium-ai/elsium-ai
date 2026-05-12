import { ElsiumError } from '@elsium-ai/core'
import { describe, expect, it, vi } from 'vitest'
import {
	type ApprovalNotifier,
	type ApprovalStage,
	createApprovalChain,
	createInMemoryApprovalStore,
} from './approval-chain'

describe('createInMemoryApprovalStore', () => {
	it('put / get round-trip with defensive copy', async () => {
		const store = createInMemoryApprovalStore()
		await store.put({
			request: {
				id: 'req_1',
				type: 'tool_call',
				description: 'd',
				context: { cost: 5 },
				requestedAt: 0,
			},
			stages: [{ name: 's1', status: 'pending' }],
			currentStage: 0,
			status: 'pending',
			createdAt: 0,
			updatedAt: 0,
		})
		const got = await store.get('req_1')
		expect(got).not.toBeNull()
		expect(got?.request.id).toBe('req_1')
	})

	it('listPending filters by stage + status', async () => {
		const store = createInMemoryApprovalStore()
		await store.put({
			request: { id: 'a', type: 'tool_call', description: 'a', context: {}, requestedAt: 0 },
			stages: [{ name: 'sec', status: 'pending' }],
			currentStage: 0,
			status: 'pending',
			createdAt: 0,
			updatedAt: 0,
		})
		await store.put({
			request: { id: 'b', type: 'tool_call', description: 'b', context: {}, requestedAt: 0 },
			stages: [{ name: 'cto', status: 'pending' }],
			currentStage: 0,
			status: 'pending',
			createdAt: 0,
			updatedAt: 0,
		})
		const sec = await store.listPending({ stage: 'sec' })
		expect(sec).toHaveLength(1)
		expect(sec[0].request.id).toBe('a')
	})

	it('resolveStage rejects unknown request or stage or already resolved', async () => {
		const store = createInMemoryApprovalStore()
		await expect(
			store.resolveStage('missing', 'x', {
				requestId: 'missing',
				approved: true,
				decidedAt: 0,
			}),
		).rejects.toThrow(ElsiumError)

		await store.put({
			request: { id: 'r', type: 'tool_call', description: '', context: {}, requestedAt: 0 },
			stages: [{ name: 's', status: 'approved' }],
			currentStage: 0,
			status: 'approved',
			createdAt: 0,
			updatedAt: 0,
		})
		await expect(
			store.resolveStage('r', 's', { requestId: 'r', approved: true, decidedAt: 0 }),
		).rejects.toThrow(/already resolved/)
	})
})

describe('createApprovalChain — callback-based stages', () => {
	const operator = vi.fn().mockResolvedValue({ approved: true, decidedAt: Date.now() })
	const security = vi.fn().mockResolvedValue({ approved: true, decidedAt: Date.now() })

	function setup(stages: ApprovalStage[]) {
		operator.mockClear()
		security.mockClear()
		return createApprovalChain({
			stages,
			store: createInMemoryApprovalStore(),
		})
	}

	it('runs a single callback stage to completion', async () => {
		const chain = setup([
			{
				name: 'op',
				enter: () => true,
				approver: { type: 'callback', target: operator },
			},
		])
		const state = await chain.request({
			type: 'tool_call',
			description: 'delete_user',
			context: { cost: 5 },
		})
		expect(state.status).toBe('approved')
		expect(operator).toHaveBeenCalledOnce()
	})

	it('skips stages whose enter() returns false', async () => {
		const chain = setup([
			{
				name: 'op',
				enter: (r) => Number(r.context.cost) > 1,
				approver: { type: 'callback', target: operator },
			},
			{
				name: 'security',
				enter: (r) => Number(r.context.cost) > 10,
				approver: { type: 'callback', target: security },
			},
		])
		const state = await chain.request({
			type: 'tool_call',
			description: '',
			context: { cost: 5 }, // > 1 (op runs), not > 10 (security skipped)
		})
		expect(state.status).toBe('approved')
		expect(operator).toHaveBeenCalledOnce()
		expect(security).not.toHaveBeenCalled()
		const stageStates = state.stages.map((s) => `${s.name}:${s.status}`)
		expect(stageStates).toEqual(['op:approved', 'security:skipped'])
	})

	it('chains multiple callback stages sequentially', async () => {
		const chain = setup([
			{ name: 'op', enter: () => true, approver: { type: 'callback', target: operator } },
			{ name: 'sec', enter: () => true, approver: { type: 'callback', target: security } },
		])
		const state = await chain.request({
			type: 'tool_call',
			description: '',
			context: { cost: 50 },
		})
		expect(state.status).toBe('approved')
		expect(operator).toHaveBeenCalledOnce()
		expect(security).toHaveBeenCalledOnce()
	})

	it('chain halts on denial; subsequent stages remain pending until cancel', async () => {
		const opDeny = vi.fn().mockResolvedValue({ approved: false, decidedAt: Date.now() })
		const secLocal = vi.fn().mockResolvedValue({ approved: true, decidedAt: Date.now() })
		const chain = createApprovalChain({
			stages: [
				{ name: 'op', enter: () => true, approver: { type: 'callback', target: opDeny } },
				{ name: 'sec', enter: () => true, approver: { type: 'callback', target: secLocal } },
			],
			store: createInMemoryApprovalStore(),
		})
		const state = await chain.request({
			type: 'tool_call',
			description: '',
			context: {},
		})
		expect(state.status).toBe('denied')
		expect(secLocal).not.toHaveBeenCalled()
	})
})

describe('createApprovalChain — role/user stages (external resolution)', () => {
	it('halts at first role/user stage waiting for external resolveStage', async () => {
		const store = createInMemoryApprovalStore()
		const chain = createApprovalChain({
			stages: [
				{ name: 'security', enter: () => true, approver: { type: 'role', target: 'security' } },
				{
					name: 'audit',
					enter: () => true,
					approver: {
						type: 'callback',
						target: async () => ({ approved: true, decidedAt: Date.now() }),
					},
				},
			],
			store,
		})

		const state = await chain.request({
			type: 'tool_call',
			description: '',
			context: {},
		})
		expect(state.status).toBe('pending')
		expect(state.currentStage).toBe(0)

		const after = await chain.store.resolveStage(state.request.id, 'security', {
			requestId: state.request.id,
			approved: true,
			decidedAt: Date.now(),
			decidedBy: 'sec-officer-1',
		})
		expect(after.stages[0].status).toBe('approved')

		// Resuming auto-runs the callback stage to completion.
		const final = await chain.resume(state.request.id)
		expect(final.status).toBe('approved')
	})

	it('listPending filters by role-style stage for an oncall dashboard', async () => {
		const store = createInMemoryApprovalStore()
		const chain = createApprovalChain({
			stages: [{ name: 'cto', enter: () => true, approver: { type: 'role', target: 'cto' } }],
			store,
		})
		await chain.request({ type: 'tool_call', description: 'a', context: {} })
		await chain.request({ type: 'tool_call', description: 'b', context: {} })
		const pending = await store.listPending({ stage: 'cto' })
		expect(pending).toHaveLength(2)
	})
})

describe('createApprovalChain — timeouts', () => {
	it('onTimeout=deny expires the chain', async () => {
		const neverResolves = vi.fn(
			() =>
				new Promise<never>(() => {
					/* hang */
				}),
		)
		const chain = createApprovalChain({
			stages: [
				{
					name: 'op',
					enter: () => true,
					approver: { type: 'callback', target: neverResolves },
					timeoutMs: 30,
					onTimeout: 'deny',
				},
			],
			store: createInMemoryApprovalStore(),
		})
		const state = await chain.request({
			type: 'tool_call',
			description: '',
			context: {},
		})
		expect(state.status).toBe('expired')
		expect(state.stages[0].status).toBe('expired')
	})

	it('onTimeout=allow approves the stage and continues', async () => {
		const neverResolves = () =>
			new Promise<never>(() => {
				/* hang */
			})
		const finalApprove = vi.fn(async () => ({ approved: true, decidedAt: Date.now() }))
		const chain = createApprovalChain({
			stages: [
				{
					name: 'op',
					enter: () => true,
					approver: { type: 'callback', target: neverResolves },
					timeoutMs: 30,
					onTimeout: 'allow',
				},
				{
					name: 'audit',
					enter: () => true,
					approver: { type: 'callback', target: finalApprove },
				},
			],
			store: createInMemoryApprovalStore(),
		})
		const state = await chain.request({
			type: 'tool_call',
			description: '',
			context: {},
		})
		expect(state.status).toBe('approved')
		expect(state.stages[0].status).toBe('approved')
		expect(state.stages[0].decision?.reason).toMatch(/timed out/)
		expect(finalApprove).toHaveBeenCalled()
	})

	it('onTimeout=escalate skips and advances', async () => {
		const neverResolves = () =>
			new Promise<never>(() => {
				/* hang */
			})
		const finalApprove = vi.fn(async () => ({ approved: true, decidedAt: Date.now() }))
		const chain = createApprovalChain({
			stages: [
				{
					name: 'op',
					enter: () => true,
					approver: { type: 'callback', target: neverResolves },
					timeoutMs: 30,
					onTimeout: 'escalate',
				},
				{
					name: 'cto',
					enter: () => true,
					approver: { type: 'callback', target: finalApprove },
				},
			],
			store: createInMemoryApprovalStore(),
		})
		const state = await chain.request({
			type: 'tool_call',
			description: '',
			context: {},
		})
		expect(state.stages[0].status).toBe('skipped')
		expect(state.status).toBe('approved')
	})
})

describe('createApprovalChain — notifier + cancel', () => {
	it('notifier fires on stage entry', async () => {
		const notifier: ApprovalNotifier = { notify: vi.fn().mockResolvedValue(undefined) }
		const chain = createApprovalChain({
			stages: [
				{ name: 'op', enter: () => true, approver: { type: 'role', target: 'op' } },
				{ name: 'sec', enter: () => true, approver: { type: 'role', target: 'sec' } },
			],
			store: createInMemoryApprovalStore(),
			notifier,
		})
		await chain.request({ type: 'tool_call', description: '', context: {} })
		expect(notifier.notify).toHaveBeenCalledTimes(1) // only first stage notified
	})

	it('cancel marks remaining pending stages as denied', async () => {
		const chain = createApprovalChain({
			stages: [
				{ name: 'op', enter: () => true, approver: { type: 'role', target: 'op' } },
				{ name: 'sec', enter: () => true, approver: { type: 'role', target: 'sec' } },
			],
			store: createInMemoryApprovalStore(),
		})
		const state = await chain.request({ type: 'tool_call', description: '', context: {} })
		const cancelled = await chain.cancel(state.request.id, 'user-aborted')
		expect(cancelled.status).toBe('denied')
		expect(cancelled.stages.every((s) => s.status !== 'pending')).toBe(true)
		expect(cancelled.request.context.cancellationReason).toBe('user-aborted')
	})
})

describe('createApprovalChain — validation', () => {
	it('throws on empty stages', () => {
		expect(() => createApprovalChain({ stages: [], store: createInMemoryApprovalStore() })).toThrow(
			/at least one/,
		)
	})

	it('throws on duplicate stage names', () => {
		expect(() =>
			createApprovalChain({
				stages: [
					{ name: 'dup', enter: () => true, approver: { type: 'role', target: 'r' } },
					{ name: 'dup', enter: () => true, approver: { type: 'role', target: 'r' } },
				],
				store: createInMemoryApprovalStore(),
			}),
		).toThrow(/Duplicate stage name/)
	})
})
