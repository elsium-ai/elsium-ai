import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type PersistedTask, createInMemoryTaskStore, createJsonFileTaskStore } from './task-store'

function makeTask(overrides: Partial<PersistedTask> = {}): PersistedTask {
	return {
		id: 'task_1',
		agentName: 'test-agent',
		input: 'hello',
		status: 'pending',
		result: null,
		error: null,
		createdAt: 1_700_000_000_000,
		startedAt: null,
		completedAt: null,
		metadata: {},
		...overrides,
	}
}

describe('createInMemoryTaskStore', () => {
	it('round-trips a task', async () => {
		const store = createInMemoryTaskStore()
		await store.save(makeTask({ id: 'a' }))

		const loaded = await store.load('a')
		expect(loaded).toMatchObject({ id: 'a', status: 'pending' })
	})

	it('returns null for missing tasks', async () => {
		const store = createInMemoryTaskStore()
		expect(await store.load('missing')).toBeNull()
	})

	it('isolates saved tasks from later mutation of the input object', async () => {
		const store = createInMemoryTaskStore()
		const task = makeTask({ id: 'a', metadata: { tag: 'one' } })
		await store.save(task)

		task.metadata.tag = 'mutated'

		const loaded = await store.load('a')
		expect(loaded?.metadata.tag).toBe('one')
	})

	it('filters by status', async () => {
		const store = createInMemoryTaskStore()
		await store.save(makeTask({ id: 'a', status: 'pending' }))
		await store.save(makeTask({ id: 'b', status: 'running' }))
		await store.save(makeTask({ id: 'c', status: 'completed' }))

		const running = await store.list({ status: 'running' })
		expect(running.map((t) => t.id)).toEqual(['b'])
	})

	it('lists all without filter', async () => {
		const store = createInMemoryTaskStore()
		await store.save(makeTask({ id: 'a' }))
		await store.save(makeTask({ id: 'b' }))

		const all = await store.list()
		expect(all).toHaveLength(2)
	})

	it('deletes tasks', async () => {
		const store = createInMemoryTaskStore()
		await store.save(makeTask({ id: 'a' }))
		await store.delete('a')
		expect(await store.load('a')).toBeNull()
	})
})

describe('createJsonFileTaskStore', () => {
	let dir: string

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'elsium-task-store-'))
	})

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true })
	})

	it('persists a task to disk and reads it back', async () => {
		const store = createJsonFileTaskStore({ dir })
		await store.save(makeTask({ id: 'task_a', status: 'completed' }))

		const loaded = await store.load('task_a')
		expect(loaded).toMatchObject({ id: 'task_a', status: 'completed' })
	})

	it('survives recreation of the store (durable across instances)', async () => {
		const first = createJsonFileTaskStore({ dir })
		await first.save(makeTask({ id: 'task_a', status: 'running' }))

		const second = createJsonFileTaskStore({ dir })
		const loaded = await second.load('task_a')
		expect(loaded?.status).toBe('running')
	})

	it('returns null for missing tasks', async () => {
		const store = createJsonFileTaskStore({ dir })
		expect(await store.load('task_missing')).toBeNull()
	})

	it('lists tasks filtered by status', async () => {
		const store = createJsonFileTaskStore({ dir })
		await store.save(makeTask({ id: 'a', status: 'pending' }))
		await store.save(makeTask({ id: 'b', status: 'pending' }))
		await store.save(makeTask({ id: 'c', status: 'completed' }))

		const pending = await store.list({ status: 'pending' })
		expect(pending.map((t) => t.id).sort()).toEqual(['a', 'b'])
	})

	it('returns empty list when directory is empty', async () => {
		const store = createJsonFileTaskStore({ dir })
		expect(await store.list()).toEqual([])
	})

	it('rejects task ids with path traversal characters', async () => {
		const store = createJsonFileTaskStore({ dir })
		await expect(store.save(makeTask({ id: '../escape' }))).rejects.toThrow(/Invalid task id/)
		await expect(store.load('../escape')).rejects.toThrow(/Invalid task id/)
		await expect(store.delete('../escape')).rejects.toThrow(/Invalid task id/)
	})

	it('rejects task ids with slashes', async () => {
		const store = createJsonFileTaskStore({ dir })
		await expect(store.save(makeTask({ id: 'a/b' }))).rejects.toThrow(/Invalid task id/)
	})

	it('overwrites existing tasks atomically (later save wins)', async () => {
		const store = createJsonFileTaskStore({ dir })
		await store.save(makeTask({ id: 'a', status: 'pending' }))
		await store.save(makeTask({ id: 'a', status: 'completed' }))

		const loaded = await store.load('a')
		expect(loaded?.status).toBe('completed')
	})

	it('deletes a task from disk', async () => {
		const store = createJsonFileTaskStore({ dir })
		await store.save(makeTask({ id: 'a' }))
		await store.delete('a')
		expect(await store.load('a')).toBeNull()
	})

	it('delete is idempotent for missing tasks', async () => {
		const store = createJsonFileTaskStore({ dir })
		await expect(store.delete('does_not_exist')).resolves.toBeUndefined()
	})
})
