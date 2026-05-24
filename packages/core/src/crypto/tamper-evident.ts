import { createHash } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { ElsiumError } from '../errors'

export interface WriteReceipt {
	key: string
	hash: string
	size: number
	writtenAt: number
}

export interface WriteOnceStore {
	put(key: string, value: Uint8Array | string): Promise<WriteReceipt>
	get(key: string): Promise<Uint8Array | null>
	has(key: string): Promise<boolean>
	list(prefix?: string): AsyncIterable<string>
}

function toBytes(value: Uint8Array | string): Uint8Array {
	if (typeof value === 'string') return new TextEncoder().encode(value)
	return value
}

function hashHex(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex')
}

function assertValidKey(key: string): void {
	if (typeof key !== 'string' || key.trim() === '') {
		throw new ElsiumError({
			code: 'VALIDATION_ERROR',
			message: 'WriteOnceStore key must be a non-empty string',
			retryable: false,
		})
	}
	if (key.includes('..') || key.startsWith('/') || key.startsWith('\\')) {
		throw new ElsiumError({
			code: 'VALIDATION_ERROR',
			message: 'WriteOnceStore key must not contain ".." or absolute paths',
			retryable: false,
		})
	}
}

export class WriteOnceConflictError extends ElsiumError {
	constructor(key: string) {
		super({
			code: 'VALIDATION_ERROR',
			message: `WriteOnceStore key "${key}" already exists (write-once semantics)`,
			retryable: false,
			metadata: { key },
		})
		this.name = 'WriteOnceConflictError'
	}
}

export function createInMemoryWriteOnceStore(): WriteOnceStore {
	const data = new Map<string, Uint8Array>()
	const receipts = new Map<string, WriteReceipt>()

	return {
		async put(key, value) {
			assertValidKey(key)
			if (data.has(key)) throw new WriteOnceConflictError(key)

			const bytes = toBytes(value)
			data.set(key, bytes)
			const receipt: WriteReceipt = {
				key,
				hash: hashHex(bytes),
				size: bytes.byteLength,
				writtenAt: Date.now(),
			}
			receipts.set(key, receipt)
			return receipt
		},
		async get(key) {
			assertValidKey(key)
			return data.get(key) ?? null
		},
		async has(key) {
			assertValidKey(key)
			return data.has(key)
		},
		async *list(prefix) {
			for (const key of data.keys()) {
				if (!prefix || key.startsWith(prefix)) yield key
			}
		},
	}
}

export interface FileWriteOnceStoreConfig {
	dir: string
	fsync?: boolean
}

async function readDirRecursive(root: string, relative = ''): Promise<string[]> {
	const here = relative === '' ? root : join(root, relative)
	let entries: Dirent[]
	try {
		entries = (await readdir(here, { withFileTypes: true })) as unknown as Dirent[]
	} catch (e) {
		const err = e as NodeJS.ErrnoException
		if (err.code === 'ENOENT') return []
		throw e
	}

	const results: string[] = []
	for (const entry of entries) {
		const name = String(entry.name)
		const childRelative = relative === '' ? name : `${relative}/${name}`
		if (entry.isDirectory()) {
			results.push(...(await readDirRecursive(root, childRelative)))
		} else if (entry.isFile()) {
			results.push(childRelative)
		}
	}
	return results
}

export function createFileWriteOnceStore(config: FileWriteOnceStoreConfig): WriteOnceStore {
	if (!config.dir || typeof config.dir !== 'string') {
		throw new ElsiumError({
			code: 'CONFIG_ERROR',
			message: 'FileWriteOnceStore requires a non-empty `dir`',
			retryable: false,
		})
	}

	const root = config.dir
	const fsyncEnabled = config.fsync ?? true

	const fullPath = (key: string): string => join(root, key)

	return {
		async put(key, value) {
			assertValidKey(key)
			const bytes = toBytes(value)
			const path = fullPath(key)
			await mkdir(dirname(path), { recursive: true })

			try {
				await writeFile(path, bytes, { flag: 'wx', flush: fsyncEnabled })
			} catch (e) {
				const err = e as NodeJS.ErrnoException
				if (err.code === 'EEXIST') throw new WriteOnceConflictError(key)
				throw new ElsiumError({
					code: 'UNKNOWN',
					message: `Failed to write key "${key}": ${err.message}`,
					retryable: false,
					cause: err,
				})
			}

			return {
				key,
				hash: hashHex(bytes),
				size: bytes.byteLength,
				writtenAt: Date.now(),
			}
		},

		async get(key) {
			assertValidKey(key)
			try {
				const buf = await readFile(fullPath(key))
				return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
			} catch (e) {
				const err = e as NodeJS.ErrnoException
				if (err.code === 'ENOENT') return null
				throw e
			}
		},

		async has(key) {
			assertValidKey(key)
			try {
				await readFile(fullPath(key))
				return true
			} catch (e) {
				const err = e as NodeJS.ErrnoException
				if (err.code === 'ENOENT') return false
				throw e
			}
		},

		async *list(prefix) {
			const all = await readDirRecursive(root)
			for (const key of all) {
				if (!prefix || key.startsWith(prefix)) yield key
			}
		},
	}
}
