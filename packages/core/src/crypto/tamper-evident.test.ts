import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ElsiumError } from '../errors'
import {
	WriteOnceConflictError,
	createFileWriteOnceStore,
	createInMemoryWriteOnceStore,
} from './tamper-evident'

describe('createInMemoryWriteOnceStore', () => {
	it('writes and reads back a string value', async () => {
		const store = createInMemoryWriteOnceStore()
		const receipt = await store.put('proof/001', 'payload')
		expect(receipt.key).toBe('proof/001')
		expect(receipt.size).toBe(7)
		expect(receipt.hash).toMatch(/^[a-f0-9]{64}$/)

		const value = await store.get('proof/001')
		expect(new TextDecoder().decode(value as Uint8Array)).toBe('payload')
	})

	it('rejects double-write to same key', async () => {
		const store = createInMemoryWriteOnceStore()
		await store.put('k', 'a')
		await expect(store.put('k', 'b')).rejects.toThrow(WriteOnceConflictError)
	})

	it('has() reports presence accurately', async () => {
		const store = createInMemoryWriteOnceStore()
		expect(await store.has('k')).toBe(false)
		await store.put('k', 'v')
		expect(await store.has('k')).toBe(true)
	})

	it('list() yields keys matching prefix', async () => {
		const store = createInMemoryWriteOnceStore()
		await store.put('proof/a', '1')
		await store.put('proof/b', '2')
		await store.put('token/x', '3')

		const all: string[] = []
		for await (const k of store.list()) all.push(k)
		expect(all.sort()).toEqual(['proof/a', 'proof/b', 'token/x'])

		const proofs: string[] = []
		for await (const k of store.list('proof/')) proofs.push(k)
		expect(proofs.sort()).toEqual(['proof/a', 'proof/b'])
	})

	it('rejects invalid keys (path traversal, empty)', async () => {
		const store = createInMemoryWriteOnceStore()
		await expect(store.put('', 'x')).rejects.toThrow(ElsiumError)
		await expect(store.put('../escape', 'x')).rejects.toThrow(/\.\./)
		await expect(store.put('/absolute', 'x')).rejects.toThrow(/absolute/)
	})

	it('returns null for missing key', async () => {
		const store = createInMemoryWriteOnceStore()
		expect(await store.get('missing')).toBeNull()
	})

	it('accepts Uint8Array payloads', async () => {
		const store = createInMemoryWriteOnceStore()
		const payload = new Uint8Array([1, 2, 3, 4])
		const receipt = await store.put('bin', payload)
		expect(receipt.size).toBe(4)
		const back = await store.get('bin')
		expect(Array.from(back as Uint8Array)).toEqual([1, 2, 3, 4])
	})
})

describe('createFileWriteOnceStore', () => {
	let dir: string

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'elsium-write-once-'))
	})

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true })
	})

	it('persists to disk and reads back', async () => {
		const store = createFileWriteOnceStore({ dir, fsync: false })
		const receipt = await store.put('proof/x.json', '{"a":1}')
		expect(receipt.size).toBe(7)

		const onDisk = await readFile(join(dir, 'proof/x.json'), 'utf8')
		expect(onDisk).toBe('{"a":1}')

		const back = await store.get('proof/x.json')
		expect(new TextDecoder().decode(back as Uint8Array)).toBe('{"a":1}')
	})

	it('refuses double-write (write-once on disk via O_EXCL)', async () => {
		const store = createFileWriteOnceStore({ dir, fsync: false })
		await store.put('k', 'v1')
		await expect(store.put('k', 'v2')).rejects.toThrow(WriteOnceConflictError)
	})

	it('has() reflects on-disk state', async () => {
		const store = createFileWriteOnceStore({ dir, fsync: false })
		expect(await store.has('k')).toBe(false)
		await store.put('k', 'v')
		expect(await store.has('k')).toBe(true)
	})

	it('get() returns null for missing key without throwing', async () => {
		const store = createFileWriteOnceStore({ dir, fsync: false })
		expect(await store.get('missing')).toBeNull()
	})

	it('list() walks the directory recursively', async () => {
		const store = createFileWriteOnceStore({ dir, fsync: false })
		await store.put('proofs/a.json', '1')
		await store.put('proofs/nested/b.json', '2')
		await store.put('tokens/x.tok', '3')

		const all: string[] = []
		for await (const k of store.list()) all.push(k)
		expect(all.sort()).toEqual(['proofs/a.json', 'proofs/nested/b.json', 'tokens/x.tok'])

		const proofs: string[] = []
		for await (const k of store.list('proofs/')) proofs.push(k)
		expect(proofs.sort()).toEqual(['proofs/a.json', 'proofs/nested/b.json'])
	})

	it('rejects invalid keys (path traversal)', async () => {
		const store = createFileWriteOnceStore({ dir, fsync: false })
		await expect(store.put('../escape.json', 'x')).rejects.toThrow(/\.\./)
		await expect(store.put('/abs.json', 'x')).rejects.toThrow(/absolute/)
	})

	it('throws on empty dir config', () => {
		expect(() => createFileWriteOnceStore({ dir: '' })).toThrow(/non-empty/)
	})

	it('list() returns empty on a non-existent root', async () => {
		const store = createFileWriteOnceStore({ dir: join(dir, 'nope') })
		const keys: string[] = []
		for await (const k of store.list()) keys.push(k)
		expect(keys).toEqual([])
	})
})
