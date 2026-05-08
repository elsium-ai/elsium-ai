import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { TaskStatus } from '../async-agent'
import type { AgentResult } from '../types'

export interface PersistedTaskError {
	message: string
	stack?: string
}

export interface PersistedTask {
	id: string
	agentName: string
	input: string
	status: TaskStatus
	result: AgentResult | null
	error: PersistedTaskError | null
	createdAt: number
	startedAt: number | null
	completedAt: number | null
	metadata: Record<string, unknown>
}

export interface TaskStoreFilter {
	status?: TaskStatus
}

export interface TaskStore {
	save(task: PersistedTask): Promise<void>
	load(taskId: string): Promise<PersistedTask | null>
	list(filter?: TaskStoreFilter): Promise<PersistedTask[]>
	delete(taskId: string): Promise<void>
}

export function createInMemoryTaskStore(): TaskStore {
	const store = new Map<string, PersistedTask>()

	return {
		async save(task: PersistedTask): Promise<void> {
			store.set(task.id, structuredClone(task))
		},
		async load(taskId: string): Promise<PersistedTask | null> {
			const task = store.get(taskId)
			return task ? structuredClone(task) : null
		},
		async list(filter?: TaskStoreFilter): Promise<PersistedTask[]> {
			const all = [...store.values()].map((t) => structuredClone(t))
			return filter?.status ? all.filter((t) => t.status === filter.status) : all
		},
		async delete(taskId: string): Promise<void> {
			store.delete(taskId)
		},
	}
}

export interface JsonFileTaskStoreConfig {
	dir: string
}

const TASK_ID_PATTERN = /^[a-zA-Z0-9_-]+$/

function assertSafeTaskId(taskId: string): void {
	if (!TASK_ID_PATTERN.test(taskId)) {
		throw new Error(`Invalid task id format: ${taskId}`)
	}
}

export function createJsonFileTaskStore(config: JsonFileTaskStoreConfig): TaskStore {
	const { dir } = config
	let initialized = false
	let initPromise: Promise<void> | null = null

	async function ensureDir(): Promise<void> {
		if (initialized) return
		if (initPromise) return initPromise
		initPromise = mkdir(dir, { recursive: true }).then(() => {
			initialized = true
		})
		return initPromise
	}

	function pathFor(taskId: string): string {
		assertSafeTaskId(taskId)
		return join(dir, `${taskId}.json`)
	}

	async function readDirSafe(): Promise<string[]> {
		try {
			await ensureDir()
			return await readdir(dir)
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
			throw err
		}
	}

	async function readTaskFile(path: string): Promise<PersistedTask | null> {
		try {
			const raw = await readFile(path, 'utf8')
			return JSON.parse(raw) as PersistedTask
		} catch {
			return null
		}
	}

	return {
		async save(task: PersistedTask): Promise<void> {
			await ensureDir()
			const path = pathFor(task.id)
			const tmp = `${path}.tmp`
			await writeFile(tmp, JSON.stringify(task), 'utf8')
			await rename(tmp, path)
		},

		async load(taskId: string): Promise<PersistedTask | null> {
			try {
				const path = pathFor(taskId)
				const raw = await readFile(path, 'utf8')
				return JSON.parse(raw) as PersistedTask
			} catch (err) {
				if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
				throw err
			}
		},

		async list(filter?: TaskStoreFilter): Promise<PersistedTask[]> {
			const files = await readDirSafe()
			const candidates = files.filter((f) => f.endsWith('.json') && !f.endsWith('.tmp'))
			const loaded = await Promise.all(candidates.map((f) => readTaskFile(join(dir, f))))
			const tasks = loaded.filter((t): t is PersistedTask => t !== null)
			return filter?.status ? tasks.filter((t) => t.status === filter.status) : tasks
		},

		async delete(taskId: string): Promise<void> {
			try {
				await unlink(pathFor(taskId))
			} catch (err) {
				if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
			}
		},
	}
}
