import type { Message } from '@elsium-ai/core'

export interface MemoryStore {
	load(agentId: string): Promise<Message[]>
	save(agentId: string, messages: Message[]): Promise<void>
	clear(agentId: string): Promise<void>
}

export function createInMemoryMemoryStore(): MemoryStore {
	const store = new Map<string, Message[]>()

	return {
		async load(agentId: string): Promise<Message[]> {
			return [...(store.get(agentId) ?? [])]
		},

		async save(agentId: string, messages: Message[]): Promise<void> {
			store.set(agentId, [...messages])
		},

		async clear(agentId: string): Promise<void> {
			store.delete(agentId)
		},
	}
}
