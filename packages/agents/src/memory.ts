import type { CompletionRequest, LLMResponse, Message } from '@elsium-ai/core'
import { extractText } from '@elsium-ai/core'
import type { MemoryStore } from './stores/memory-store'

export type MemoryStrategy = 'sliding-window' | 'token-limited' | 'summary' | 'unlimited'

export type SummarizeFn = (messages: Message[]) => Promise<string>

export interface MemoryConfig {
	strategy: MemoryStrategy
	maxTokens?: number
	maxMessages?: number
	store?: MemoryStore
	agentId?: string
	summarize?: SummarizeFn
}

export interface Memory {
	readonly strategy: MemoryStrategy
	add(message: Message): void
	getMessages(): Message[]
	clear(): void
	getTokenEstimate(): number
	loadFromStore(): Promise<void>
	saveToStore(): Promise<void>
	summarizeIfNeeded(): Promise<void>
}

export function createMemory(config: MemoryConfig): Memory {
	const messages: Message[] = []

	const maxTokens = config.maxTokens ?? 128_000
	const maxMessages = config.maxMessages ?? 100

	function estimateTokens(msg: Message): number {
		const text = extractText(msg.content)
		// Conservative estimate: ~1.5 chars per token (English averages ~1.3)
		// Intentionally over-counts to prevent budget overruns
		return Math.ceil(text.length / 1.5) + 4 // +4 for message overhead (role, formatting)
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

	let summaryPending = false

	function needsSummarization(): boolean {
		if (config.strategy !== 'summary') return false
		if (!config.summarize) return false
		return messages.length > maxMessages
	}

	async function runSummarization() {
		if (summaryPending || !config.summarize) return
		if (messages.length <= maxMessages) return

		summaryPending = true
		try {
			const keepCount = Math.floor(maxMessages / 2)
			const toSummarize = messages.splice(0, messages.length - keepCount)
			const summaryText = await config.summarize(toSummarize)
			messages.unshift({
				role: 'system',
				content: `[Conversation summary]: ${summaryText}`,
			})
		} finally {
			summaryPending = false
		}

		if (config.store && config.agentId) {
			config.store.save(config.agentId, [...messages]).catch(() => {})
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
				case 'summary':
					break
				case 'unlimited':
					break
			}

			if (config.store && config.agentId) {
				config.store.save(config.agentId, [...messages]).catch(() => {})
			}
		},

		getMessages(): Message[] {
			return [...messages]
		},

		clear() {
			messages.length = 0
			if (config.store && config.agentId) {
				config.store.clear(config.agentId).catch(() => {})
			}
		},

		getTokenEstimate(): number {
			return messages.reduce((sum, m) => sum + estimateTokens(m), 0)
		},

		async loadFromStore(): Promise<void> {
			if (!config.store || !config.agentId) return
			const stored = await config.store.load(config.agentId)
			messages.length = 0
			messages.push(...stored)
		},

		async saveToStore(): Promise<void> {
			if (!config.store || !config.agentId) return
			await config.store.save(config.agentId, [...messages])
		},

		async summarizeIfNeeded(): Promise<void> {
			if (needsSummarization()) {
				await runSummarization()
			}
		},
	}
}

const SUMMARIZE_SYSTEM =
	'You are a conversation summarizer. Given a conversation, produce a concise summary that preserves all key facts, decisions, user preferences, and context needed to continue the conversation. Be factual and complete. Do not add commentary.'

export function createSummarizeFn(
	complete: (request: CompletionRequest) => Promise<LLMResponse>,
): SummarizeFn {
	return async (messages: Message[]): Promise<string> => {
		const text = messages.map((m) => `${m.role}: ${extractText(m.content)}`).join('\n')
		const response = await complete({
			messages: [{ role: 'user', content: `Summarize this conversation:\n\n${text}` }],
			system: SUMMARIZE_SYSTEM,
		})
		return extractText(response.message.content)
	}
}
