export interface SharedMemory {
	get<T = unknown>(key: string): T | undefined
	set<T = unknown>(key: string, value: T): void
	getAll(): Record<string, unknown>
	clear(): void
}

export function createSharedMemory(): SharedMemory {
	const store = new Map<string, unknown>()

	return {
		get<T = unknown>(key: string): T | undefined {
			return store.get(key) as T | undefined
		},

		set<T = unknown>(key: string, value: T): void {
			if (key === '__proto__' || key === 'constructor' || key === 'prototype') return
			store.set(key, value)
		},

		getAll(): Record<string, unknown> {
			const result: Record<string, unknown> = {}
			for (const [key, value] of store) {
				result[key] = value
			}
			return result
		},

		clear(): void {
			store.clear()
		},
	}
}
