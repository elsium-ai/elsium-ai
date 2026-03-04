import type { Message } from '@elsium-ai/core'
import { describe, expect, it } from 'vitest'
import { createInMemoryMemoryStore } from './memory-store'

// ─── createInMemoryMemoryStore ──────────────────────────────────

describe('createInMemoryMemoryStore', () => {
	it('saves and loads messages for an agentId', async () => {
		const store = createInMemoryMemoryStore()
		const messages: Message[] = [
			{ role: 'user', content: 'hello' },
			{ role: 'assistant', content: 'hi there' },
		]

		await store.save('agent-1', messages)
		const loaded = await store.load('agent-1')

		expect(loaded).toEqual(messages)
	})

	it('returns a copy of messages (not the same reference)', async () => {
		const store = createInMemoryMemoryStore()
		const messages: Message[] = [{ role: 'user', content: 'hello' }]

		await store.save('agent-1', messages)
		const loaded = await store.load('agent-1')

		expect(loaded).toEqual(messages)
		expect(loaded).not.toBe(messages)
	})

	it('returns empty array for unknown agentId', async () => {
		const store = createInMemoryMemoryStore()
		const loaded = await store.load('unknown-agent')

		expect(loaded).toEqual([])
	})

	it('clears messages for an agentId', async () => {
		const store = createInMemoryMemoryStore()
		const messages: Message[] = [{ role: 'user', content: 'hello' }]

		await store.save('agent-1', messages)
		await store.clear('agent-1')
		const loaded = await store.load('agent-1')

		expect(loaded).toEqual([])
	})

	it('clear on unknown agentId does not throw', async () => {
		const store = createInMemoryMemoryStore()
		await expect(store.clear('nonexistent')).resolves.toBeUndefined()
	})

	it('saves independently for different agentIds', async () => {
		const store = createInMemoryMemoryStore()

		await store.save('agent-1', [{ role: 'user', content: 'hello from 1' }])
		await store.save('agent-2', [{ role: 'user', content: 'hello from 2' }])

		const loaded1 = await store.load('agent-1')
		const loaded2 = await store.load('agent-2')

		expect(loaded1).toEqual([{ role: 'user', content: 'hello from 1' }])
		expect(loaded2).toEqual([{ role: 'user', content: 'hello from 2' }])
	})

	it('overwrites previous messages on save', async () => {
		const store = createInMemoryMemoryStore()

		await store.save('agent-1', [{ role: 'user', content: 'first' }])
		await store.save('agent-1', [{ role: 'user', content: 'second' }])

		const loaded = await store.load('agent-1')
		expect(loaded).toEqual([{ role: 'user', content: 'second' }])
	})
})
