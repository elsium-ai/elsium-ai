import { ElsiumError } from '@elsium-ai/core'
import { describe, expect, it } from 'vitest'
import { type CostAttribution, type CostRecord, createLocalCostStore } from './cost-store'

function rec(overrides: Partial<CostRecord> = {}): CostRecord {
	return {
		attribution: { model: 'gpt-5' },
		cost: 0.01,
		inputTokens: 100,
		outputTokens: 50,
		timestamp: 1_000,
		...overrides,
	}
}

describe('LocalCostStore — record + aggregate', () => {
	it('aggregates by model', async () => {
		const store = createLocalCostStore()
		await store.record(rec({ attribution: { model: 'gpt-5' }, cost: 0.5 }))
		await store.record(rec({ attribution: { model: 'gpt-5' }, cost: 0.3 }))
		await store.record(rec({ attribution: { model: 'claude-sonnet-4-6' }, cost: 0.2 }))

		const buckets = await store.aggregate('model')
		const byKey = Object.fromEntries(buckets.map((b) => [b.key, b]))
		expect(byKey['gpt-5'].cost).toBeCloseTo(0.8)
		expect(byKey['gpt-5'].calls).toBe(2)
		expect(byKey['claude-sonnet-4-6'].cost).toBeCloseTo(0.2)
	})

	it('aggregates by tenant and excludes records without the dimension', async () => {
		const store = createLocalCostStore()
		await store.record(rec({ attribution: { model: 'm', tenant: 'acme' }, cost: 1 }))
		await store.record(rec({ attribution: { model: 'm' }, cost: 5 })) // no tenant

		const buckets = await store.aggregate('tenant')
		expect(buckets).toHaveLength(1)
		expect(buckets[0]).toMatchObject({ key: 'acme', cost: 1, calls: 1 })
	})

	it('filter narrows aggregation to a partial attribution', async () => {
		const store = createLocalCostStore()
		await store.record(rec({ attribution: { model: 'm', tenant: 'acme', user: 'a' }, cost: 1 }))
		await store.record(rec({ attribution: { model: 'm', tenant: 'acme', user: 'b' }, cost: 2 }))
		await store.record(rec({ attribution: { model: 'm', tenant: 'globex', user: 'a' }, cost: 9 }))

		const acmeByUser = await store.aggregate('user', { tenant: 'acme' })
		const byKey = Object.fromEntries(acmeByUser.map((b) => [b.key, b]))
		expect(byKey.a.cost).toBe(1)
		expect(byKey.b.cost).toBe(2)
		expect(byKey).not.toHaveProperty('a-globex') // sanity
	})

	it('window restricts aggregation to a time range', async () => {
		const store = createLocalCostStore()
		await store.record(rec({ timestamp: 100 }))
		await store.record(rec({ timestamp: 200 }))
		await store.record(rec({ timestamp: 300 }))

		const mid = await store.aggregate('model', undefined, { fromMs: 150, toMs: 250 })
		expect(mid[0].calls).toBe(1)
	})

	it('tracks firstAt / lastAt across aggregated records', async () => {
		const store = createLocalCostStore()
		await store.record(rec({ timestamp: 100 }))
		await store.record(rec({ timestamp: 50 }))
		await store.record(rec({ timestamp: 200 }))

		const [b] = await store.aggregate('model')
		expect(b.firstAt).toBe(50)
		expect(b.lastAt).toBe(200)
	})
})

describe('LocalCostStore — reserve / commit / release', () => {
	const attr: CostAttribution = { model: 'gpt-5', tenant: 'acme' }

	it('reserve returns a token with the requested amount', async () => {
		const store = createLocalCostStore()
		const token = await store.reserve(attr, 0.5)
		expect(token.reservedAmount).toBe(0.5)
		expect(token.attribution.tenant).toBe('acme')
	})

	it('commit records the actual cost (may differ from reservation)', async () => {
		const store = createLocalCostStore()
		const token = await store.reserve(attr, 0.5)
		await store.commit(token, 0.6)

		const buckets = await store.aggregate('tenant')
		expect(buckets[0].cost).toBeCloseTo(0.6)
	})

	it('release drops a reservation without recording', async () => {
		const store = createLocalCostStore()
		const token = await store.reserve(attr, 0.5)
		await store.release(token)

		const buckets = await store.aggregate('tenant')
		expect(buckets).toHaveLength(0)
	})

	it('commit on a released or unknown reservation throws', async () => {
		const store = createLocalCostStore()
		const token = await store.reserve(attr, 0.5)
		await store.release(token)
		await expect(store.commit(token, 0.5)).rejects.toThrow(ElsiumError)
	})

	it('reserve rejects negative or non-finite estimatedCost', async () => {
		const store = createLocalCostStore()
		await expect(store.reserve(attr, -1)).rejects.toThrow(/non-negative/)
		await expect(store.reserve(attr, Number.NaN)).rejects.toThrow(/non-negative finite/)
	})

	it('expired reservations are purged on the next reserve', async () => {
		let t = 0
		const store = createLocalCostStore({
			reservationTtlMs: 10,
			now: () => t,
		})
		await store.reserve(attr, 0.1)
		t = 100 // ttl elapsed
		const newToken = await store.reserve(attr, 0.2) // triggers purge
		// Old token can no longer commit
		await expect(store.commit({ ...newToken, id: 'rsv_expired' }, 0.1)).rejects.toThrow(ElsiumError)
	})
})

describe('LocalCostStore — defensive copy semantics', () => {
	it('mutating the attribution object after record does not affect stored data', async () => {
		const store = createLocalCostStore()
		const attribution: CostAttribution = { model: 'm', tenant: 'acme' }
		await store.record({
			attribution,
			cost: 1,
			inputTokens: 0,
			outputTokens: 0,
			timestamp: 0,
		})

		// Mutate after-the-fact — should not affect the store
		;(attribution as { tenant?: string }).tenant = 'mutated'

		const buckets = await store.aggregate('tenant')
		expect(buckets[0].key).toBe('acme')
	})
})
