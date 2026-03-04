import { createLogger } from './logger'

const log = createLogger()

const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export interface Registry<T> {
	register(name: string, factory: T): void
	get(name: string): T | undefined
	list(): string[]
	has(name: string): boolean
	unregister(name: string): boolean
}

export function createRegistry<T>(label: string): Registry<T> {
	const entries = new Map<string, T>()

	return {
		register(name: string, factory: T): void {
			if (BLOCKED_KEYS.has(name)) {
				log.warn(`Registry(${label}): rejected blocked key "${name}"`)
				return
			}
			entries.set(name, factory)
			log.debug(`Registry(${label}): registered "${name}"`)
		},

		get(name: string): T | undefined {
			if (BLOCKED_KEYS.has(name)) return undefined
			return entries.get(name)
		},

		list(): string[] {
			return Array.from(entries.keys())
		},

		has(name: string): boolean {
			if (BLOCKED_KEYS.has(name)) return false
			return entries.has(name)
		},

		unregister(name: string): boolean {
			if (BLOCKED_KEYS.has(name)) return false
			const deleted = entries.delete(name)
			if (deleted) {
				log.debug(`Registry(${label}): unregistered "${name}"`)
			}
			return deleted
		},
	}
}
