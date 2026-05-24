import { describe, expect, it } from 'vitest'
import { askHuman, createInMemoryAskHumanStore, resolveAskHuman } from './ask-human'

describe('askHuman — responder mode', () => {
	it('resolves immediately when the responder returns', async () => {
		const decision = await askHuman({
			question: 'Approve $5,000 transfer?',
			options: ['approve', 'reject'] as const,
			timeoutMs: '5s',
			responder: async (req) => ({
				status: 'approved',
				option: 'approve',
				decidedBy: 'jane@org',
				decidedAt: Date.now(),
				reason: `q: ${req.question}`,
			}),
		})
		expect(decision.status).toBe('approved')
		expect(decision.option).toBe('approve')
		expect(decision.decidedBy).toBe('jane@org')
	})

	it('returns timeout status when the responder never finishes within timeoutMs', async () => {
		const decision = await askHuman({
			question: 'q',
			options: ['approve'],
			timeoutMs: 50,
			responder: () => new Promise(() => {}),
		})
		expect(decision.status).toBe('timeout')
		expect(decision.reason).toContain('no response')
	})

	it('returns rejected when onTimeout="reject"', async () => {
		const decision = await askHuman({
			question: 'q',
			options: ['approve'],
			timeoutMs: 50,
			onTimeout: 'reject',
			responder: () => new Promise(() => {}),
		})
		expect(decision.status).toBe('rejected')
	})
})

describe('askHuman — store/durable mode', () => {
	it('blocks until resolveAskHuman is called from outside the loop', async () => {
		const store = createInMemoryAskHumanStore()
		const pending = askHuman({
			question: 'q',
			options: ['approve', 'reject'] as const,
			timeoutMs: '5s',
			store,
			requestId: 'req_1',
		})

		// give the polling loop a tick to start
		await new Promise((r) => setTimeout(r, 50))

		await resolveAskHuman(store, 'req_1', {
			status: 'approved',
			option: 'approve',
			requestId: 'req_1',
			approved: true,
		} as never)

		const decision = await pending
		expect(decision.status).toBe('approved')
		expect(decision.option).toBe('approve')
	})

	it('persists the pending request in the store', async () => {
		const store = createInMemoryAskHumanStore()
		const promise = askHuman({
			question: 'q',
			options: ['approve'],
			timeoutMs: 100,
			store,
			requestId: 'req_2',
		})
		await new Promise((r) => setTimeout(r, 20))
		const pending = await store.listPending()
		expect(pending).toHaveLength(1)
		expect(pending[0].request.id).toBe('req_2')
		await promise
	})

	it('returns timeout when no decision arrives before deadline', async () => {
		const store = createInMemoryAskHumanStore()
		const decision = await askHuman({
			question: 'q',
			options: ['approve'],
			timeoutMs: 80,
			store,
			requestId: 'req_3',
		})
		expect(decision.status).toBe('timeout')
	})
})

describe('askHuman — input validation', () => {
	it('throws when question is empty', async () => {
		await expect(
			askHuman({ question: '', options: ['approve'], responder: async () => ({}) as never }),
		).rejects.toThrow(/non-empty question/)
	})

	it('throws when options is empty', async () => {
		await expect(
			askHuman({ question: 'q', options: [], responder: async () => ({}) as never }),
		).rejects.toThrow(/at least one option/)
	})

	it('throws when neither responder nor store is supplied', async () => {
		await expect(askHuman({ question: 'q', options: ['approve'] })).rejects.toThrow(
			/responder callback or a store/,
		)
	})

	it('parses string durations (5s, 2m, 1h, 24h, 7d)', async () => {
		const start = Date.now()
		const decision = await askHuman({
			question: 'q',
			options: ['approve'],
			timeoutMs: '50ms',
			responder: () => new Promise(() => {}),
		})
		expect(decision.status).toBe('timeout')
		expect(Date.now() - start).toBeGreaterThanOrEqual(40)
		expect(Date.now() - start).toBeLessThan(500)
	})
})

describe('resolveAskHuman', () => {
	it('throws when the request id is not in the store', async () => {
		const store = createInMemoryAskHumanStore()
		await expect(
			resolveAskHuman(store, 'missing', { status: 'approved' } as never),
		).rejects.toThrow(/not found/)
	})
})
