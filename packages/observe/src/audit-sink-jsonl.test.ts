import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AuditEvent } from './audit'
import { createJsonlSink } from './audit-sink-jsonl'

function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
	return {
		id: 'audit_1',
		sequenceId: 1,
		type: 'llm_call',
		timestamp: 1_700_000_000_000,
		data: { provider: 'anthropic' },
		hash: 'a'.repeat(64),
		previousHash: '0'.repeat(64),
		...overrides,
	}
}

describe('createJsonlSink', () => {
	let dir: string

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'elsium-jsonl-'))
	})

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true })
	})

	it('writes events as newline-delimited JSON', async () => {
		const path = join(dir, 'audit.jsonl')
		const sink = createJsonlSink({ path, fsync: false })

		const events = [makeEvent({ id: 'a' }), makeEvent({ id: 'b', sequenceId: 2 })]
		await sink.send(events)
		await sink.shutdown?.()

		const raw = await readFile(path, 'utf8')
		const lines = raw.trim().split('\n')

		expect(lines).toHaveLength(2)
		expect(JSON.parse(lines[0])).toMatchObject({ id: 'a', sequenceId: 1 })
		expect(JSON.parse(lines[1])).toMatchObject({ id: 'b', sequenceId: 2 })
	})

	it('appends across multiple send calls (does not overwrite)', async () => {
		const path = join(dir, 'audit.jsonl')
		const sink = createJsonlSink({ path, fsync: false })

		await sink.send([makeEvent({ id: 'first' })])
		await sink.send([makeEvent({ id: 'second', sequenceId: 2 })])
		await sink.shutdown?.()

		const raw = await readFile(path, 'utf8')
		const lines = raw
			.trim()
			.split('\n')
			.map((l) => JSON.parse(l))

		expect(lines.map((l) => l.id)).toEqual(['first', 'second'])
	})

	it('creates parent directories if missing', async () => {
		const path = join(dir, 'nested', 'deeper', 'audit.jsonl')
		const sink = createJsonlSink({ path, fsync: false })

		await sink.send([makeEvent()])
		await sink.shutdown?.()

		const raw = await readFile(path, 'utf8')
		expect(raw.trim()).not.toBe('')
	})

	it('survives many concurrent sends without corrupting JSONL', async () => {
		const path = join(dir, 'audit.jsonl')
		const sink = createJsonlSink({ path, fsync: false })

		const concurrent = Array.from({ length: 25 }, (_, i) =>
			sink.send([makeEvent({ id: `e${i}`, sequenceId: i + 1 })]),
		)
		await Promise.all(concurrent)
		await sink.shutdown?.()

		const raw = await readFile(path, 'utf8')
		const lines = raw.trim().split('\n')
		expect(lines).toHaveLength(25)
		for (const line of lines) {
			expect(() => JSON.parse(line)).not.toThrow()
		}
	})

	it('skips empty event arrays', async () => {
		const path = join(dir, 'audit.jsonl')
		const sink = createJsonlSink({ path, fsync: false })

		await sink.send([])
		await sink.shutdown?.()

		await expect(readFile(path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
	})

	it('shutdown is idempotent', async () => {
		const path = join(dir, 'audit.jsonl')
		const sink = createJsonlSink({ path, fsync: false })

		await sink.send([makeEvent()])
		await sink.shutdown?.()
		await expect(sink.shutdown?.()).resolves.toBeUndefined()
	})
})
