import { type FileHandle, mkdir, open } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createLogger } from '@elsium-ai/core'
import type { AuditEvent } from './audit'
import type { AuditSink } from './audit-sink'

const log = createLogger()

export interface JsonlSinkConfig {
	path: string
	fsync?: boolean
}

export function createJsonlSink(config: JsonlSinkConfig): AuditSink {
	const { path, fsync = true } = config
	let handle: FileHandle | null = null
	let initPromise: Promise<FileHandle> | null = null
	let writeChain: Promise<unknown> = Promise.resolve()

	async function getHandle(): Promise<FileHandle> {
		if (handle) return handle
		if (initPromise) return initPromise
		initPromise = (async () => {
			await mkdir(dirname(path), { recursive: true })
			handle = await open(path, 'a')
			return handle
		})()
		return initPromise
	}

	function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
		const previous = writeChain
		const next = previous.catch(() => {}).then(fn)
		writeChain = next
		return next
	}

	return {
		name: 'jsonl',

		async send(events: AuditEvent[]): Promise<void> {
			if (events.length === 0) return
			return withWriteLock(async () => {
				const fh = await getHandle()
				const payload = `${events.map((e) => JSON.stringify(e)).join('\n')}\n`
				await fh.appendFile(payload, 'utf8')
				if (fsync) {
					try {
						await fh.sync()
					} catch (err) {
						log.warn('jsonl sink fsync failed', { error: err })
					}
				}
			})
		},

		async shutdown(): Promise<void> {
			await withWriteLock(async () => {
				if (handle) {
					try {
						if (fsync) await handle.sync()
					} finally {
						await handle.close()
						handle = null
					}
				}
			})
		},
	}
}
