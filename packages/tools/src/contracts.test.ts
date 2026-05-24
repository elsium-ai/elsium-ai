import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createInMemoryIdempotencyStore } from './contracts'
import { defineTool } from './define'

describe('Tool contracts — dry-run', () => {
	it('skips a write-level handler when ctx.dryRun is true and returns dryRun: true', async () => {
		let handlerCalled = 0
		const transferTool = defineTool({
			name: 'transferFunds',
			description: 'move money',
			input: z.object({ amount: z.number(), to: z.string() }),
			sideEffectLevel: 'destructive',
			handler: async (input) => {
				handlerCalled++
				return { ok: true, ref: input.to }
			},
			dryRunHandler: (input) => ({ ok: true, ref: `PREVIEW:${input.to}` }),
		})

		const result = await transferTool.execute({ amount: 100, to: 'acct-X' }, { dryRun: true })
		expect(result.success).toBe(true)
		expect(result.dryRun).toBe(true)
		expect(handlerCalled).toBe(0)
		expect((result.data as { ref: string }).ref).toContain('PREVIEW')
	})

	it('still runs the handler under dryRun for a read-level tool', async () => {
		let called = 0
		const readTool = defineTool({
			name: 'getBalance',
			description: 'read account balance',
			input: z.object({ account: z.string() }),
			sideEffectLevel: 'read',
			handler: async () => {
				called++
				return { balance: 9000 }
			},
		})

		const result = await readTool.execute({ account: 'X' }, { dryRun: true })
		expect(called).toBe(1)
		expect(result.dryRun).toBeUndefined()
		expect(result.success).toBe(true)
	})

	it('returns undefined data when dryRun is requested but no dryRunHandler is provided', async () => {
		const tool = defineTool({
			name: 'sendEmail',
			description: 'send',
			input: z.object({ to: z.string() }),
			sideEffectLevel: 'write',
			handler: async () => ({ sent: true }),
		})
		const result = await tool.execute({ to: 'a@b.com' }, { dryRun: true })
		expect(result.dryRun).toBe(true)
		expect(result.data).toBeUndefined()
	})
})

describe('Tool contracts — preconditions', () => {
	it('runs all preconditions; tool executes only when every check passes', async () => {
		let executed = 0
		const tool = defineTool({
			name: 'op',
			description: 'op',
			input: z.object({ x: z.number() }),
			preconditions: [
				{ name: 'positive', check: async (i) => ({ ok: i.x > 0 }) },
				{ name: 'small', check: async (i) => ({ ok: i.x < 100 }) },
			],
			handler: async (i) => {
				executed++
				return i.x * 2
			},
		})

		const ok = await tool.execute({ x: 10 })
		expect(ok.success).toBe(true)
		expect(executed).toBe(1)
	})

	it('aggregates failures and skips the handler', async () => {
		let executed = 0
		const tool = defineTool({
			name: 'op',
			description: 'op',
			input: z.object({ x: z.number() }),
			preconditions: [
				{ name: 'positive', check: async (i) => ({ ok: i.x > 0, reason: 'must be positive' }) },
				{ name: 'small', check: async (i) => ({ ok: i.x < 100, reason: 'must be < 100' }) },
			],
			handler: async () => {
				executed++
				return 'never'
			},
		})

		const r = await tool.execute({ x: -1 })
		expect(r.success).toBe(false)
		expect(executed).toBe(0)
		expect(r.preconditionFailures).toEqual([{ name: 'positive', reason: 'must be positive' }])
		expect(r.error).toContain('precondition denied')
	})
})

describe('Tool contracts — idempotency', () => {
	it('returns cached result on the second call with the same key', async () => {
		let handlerCalls = 0
		const store = createInMemoryIdempotencyStore()
		const tool = defineTool({
			name: 'charge',
			description: 'charge',
			input: z.object({ txId: z.string(), amount: z.number() }),
			idempotencyKey: (i) => i.txId,
			idempotencyStore: store,
			handler: async (i) => {
				handlerCalls++
				return { ok: true, amount: i.amount }
			},
		})

		const a = await tool.execute({ txId: 'tx-1', amount: 50 })
		const b = await tool.execute({ txId: 'tx-1', amount: 50 })
		expect(handlerCalls).toBe(1)
		expect(a.idempotent).toBeUndefined()
		expect(b.idempotent).toBe(true)
		expect(b.data).toEqual(a.data)
	})

	it('different keys → no dedupe', async () => {
		let handlerCalls = 0
		const store = createInMemoryIdempotencyStore()
		const tool = defineTool({
			name: 'charge',
			description: 'charge',
			input: z.object({ txId: z.string() }),
			idempotencyKey: (i) => i.txId,
			idempotencyStore: store,
			handler: async () => {
				handlerCalls++
				return { ok: true }
			},
		})
		await tool.execute({ txId: 'a' })
		await tool.execute({ txId: 'b' })
		expect(handlerCalls).toBe(2)
	})

	it('idempotencyKey without a store is a no-op (handler runs every time)', async () => {
		let calls = 0
		const tool = defineTool({
			name: 'charge',
			description: 'charge',
			input: z.object({ txId: z.string() }),
			idempotencyKey: (i) => i.txId,
			handler: async () => {
				calls++
				return { ok: true }
			},
		})
		await tool.execute({ txId: 'a' })
		await tool.execute({ txId: 'a' })
		expect(calls).toBe(2)
	})

	it('idempotencyStore.delete invalidates the cache', async () => {
		const store = createInMemoryIdempotencyStore()
		let calls = 0
		const tool = defineTool({
			name: 'charge',
			description: 'charge',
			input: z.object({ txId: z.string() }),
			idempotencyKey: (i) => i.txId,
			idempotencyStore: store,
			handler: async () => {
				calls++
				return { calls }
			},
		})
		await tool.execute({ txId: 'a' })
		expect(await store.delete('charge', 'a')).toBe(true)
		await tool.execute({ txId: 'a' })
		expect(calls).toBe(2)
	})

	it('exposes sideEffectLevel on the tool', () => {
		const tool = defineTool({
			name: 't',
			description: 't',
			input: z.object({}),
			sideEffectLevel: 'destructive',
			handler: async () => ({}),
		})
		expect(tool.sideEffectLevel).toBe('destructive')
	})
})
