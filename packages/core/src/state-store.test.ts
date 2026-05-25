import { describe, expect, it } from 'vitest'
import { createInMemoryStateStore } from './state-store'

describe('createInMemoryStateStore', () => {
	it('saves and loads opaque snapshots', async () => {
		const store = createInMemoryStateStore<{ a: number }>()
		await store.save('k1', { a: 42 })
		expect(await store.load('k1')).toEqual({ a: 42 })
	})

	it('returns undefined for missing keys', async () => {
		const store = createInMemoryStateStore()
		expect(await store.load('missing')).toBeUndefined()
	})

	it('deletes entries', async () => {
		const store = createInMemoryStateStore()
		await store.save('k1', 'v')
		expect(await store.delete('k1')).toBe(true)
		expect(await store.load('k1')).toBeUndefined()
		expect(await store.delete('k1')).toBe(false)
	})

	it('lists keys with optional prefix', async () => {
		const store = createInMemoryStateStore()
		await store.save('user:1', 'a')
		await store.save('user:2', 'b')
		await store.save('agent:3', 'c')
		expect((await store.list?.('user:'))?.sort()).toEqual(['user:1', 'user:2'])
		expect((await store.list?.())?.length).toBe(3)
	})

	it('evicts oldest entries when maxEntries exceeded', async () => {
		const store = createInMemoryStateStore({ maxEntries: 2 })
		await store.save('k1', 1)
		await store.save('k2', 2)
		await store.save('k3', 3)
		expect(await store.load('k1')).toBeUndefined()
		expect(await store.load('k2')).toBe(2)
		expect(await store.load('k3')).toBe(3)
	})

	it('rejects empty keys', async () => {
		const store = createInMemoryStateStore()
		await expect(store.save('', 'x')).rejects.toThrow('non-empty')
	})
})
