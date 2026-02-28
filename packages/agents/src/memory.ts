import type { Message } from '@elsium-ai/core'
import { extractText } from '@elsium-ai/core'

export type MemoryStrategy = 'sliding-window' | 'token-limited' | 'unlimited'

export interface MemoryConfig {
	strategy: MemoryStrategy
	maxTokens?: number
	maxMessages?: number
}

export interface Memory {
	readonly strategy: MemoryStrategy
	add(message: Message): void
	getMessages(): Message[]
	clear(): void
	getTokenEstimate(): number
}

export function createMemory(config: MemoryConfig): Memory {
	const messages: Message[] = []

	const maxTokens = config.maxTokens ?? 128_000
	const maxMessages = config.maxMessages ?? 100

	function estimateTokens(msg: Message): number {
		const text = extractText(msg.content)
		// Rough estimate: ~4 chars per token
		return Math.ceil(text.length / 4)
	}

	function trimToTokenLimit() {
		if (config.strategy === 'unlimited') return

		let totalTokens = messages.reduce((sum, m) => sum + estimateTokens(m), 0)

		while (totalTokens > maxTokens && messages.length > 1) {
			const removed = messages.shift()
			if (removed) {
				totalTokens -= estimateTokens(removed)
			}
		}
	}

	function trimToMessageLimit() {
		while (messages.length > maxMessages) {
			messages.shift()
		}
	}

	return {
		strategy: config.strategy,

		add(message: Message) {
			messages.push(message)

			switch (config.strategy) {
				case 'sliding-window':
					trimToMessageLimit()
					break
				case 'token-limited':
					trimToTokenLimit()
					break
				case 'unlimited':
					break
			}
		},

		getMessages(): Message[] {
			return [...messages]
		},

		clear() {
			messages.length = 0
		},

		getTokenEstimate(): number {
			return messages.reduce((sum, m) => sum + estimateTokens(m), 0)
		},
	}
}
