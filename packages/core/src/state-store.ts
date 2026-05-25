import { ElsiumError } from './errors'

/**
 * Durable key/value store for opaque snapshots — used by the agent runtime
 * to pause and resume mid-execution (e.g. while waiting for human approval).
 *
 * Adapters: the framework ships only an in-memory adapter. Production users
 * wire their own (Redis, Postgres, SQLite, S3) by implementing this shape.
 */
export interface StateStore<TSnapshot = unknown> {
	save(key: string, snapshot: TSnapshot): Promise<void>
	load(key: string): Promise<TSnapshot | undefined>
	delete(key: string): Promise<boolean>
	list?(prefix?: string): Promise<string[]>
}

export interface InMemoryStateStoreConfig {
	maxEntries?: number
}

const DEFAULT_MAX_ENTRIES = 10_000

export function createInMemoryStateStore<TSnapshot = unknown>(
	config: InMemoryStateStoreConfig = {},
): StateStore<TSnapshot> {
	const max = config.maxEntries ?? DEFAULT_MAX_ENTRIES
	const map = new Map<string, TSnapshot>()

	function evictIfNeeded() {
		while (map.size > max) {
			const first = map.keys().next().value
			if (first === undefined) break
			map.delete(first)
		}
	}

	return {
		async save(key, snapshot) {
			if (!key) {
				throw new ElsiumError({
					code: 'VALIDATION_ERROR',
					message: 'StateStore.save: key must be non-empty',
					retryable: false,
				})
			}
			map.set(key, snapshot)
			evictIfNeeded()
		},
		async load(key) {
			return map.get(key)
		},
		async delete(key) {
			return map.delete(key)
		},
		async list(prefix) {
			const keys = Array.from(map.keys())
			return prefix ? keys.filter((k) => k.startsWith(prefix)) : keys
		},
	}
}
