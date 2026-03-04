import type { Message } from './types'

// Model-aware character-to-token ratios
const MODEL_RATIOS: Record<string, number> = {
	cl100k_base: 4,
	'gpt-4o': 4,
	'gpt-4o-mini': 4,
	o1: 4,
	'o1-mini': 4,
	'o3-mini': 4,
	'claude-opus-4-6': 3.5,
	'claude-sonnet-4-6': 3.5,
	'claude-haiku-4-5-20251001': 3.5,
	'gemini-2.0-flash': 4,
	'gemini-2.0-flash-lite': 4,
	'gemini-2.5-pro-preview-05-06': 4,
	'gemini-2.5-flash-preview-04-17': 4,
}

function getRatio(model?: string): number {
	if (!model) return 4
	if (MODEL_RATIOS[model]) return MODEL_RATIOS[model]
	if (model.startsWith('claude')) return 3.5
	if (model.startsWith('gemini')) return 4
	if (model.startsWith('gpt') || model.startsWith('o1') || model.startsWith('o3')) return 4
	return 4
}

function extractMessageText(msg: Message): string {
	if (typeof msg.content === 'string') return msg.content
	return msg.content
		.filter((p) => p.type === 'text' && 'text' in p)
		.map((p) => (p as { text: string }).text)
		.join('')
}

export function countTokens(text: string, model?: string): number {
	const ratio = getRatio(model)
	return Math.ceil(text.length / ratio) + 4
}

export type ContextStrategy = 'truncate' | 'summarize' | 'sliding-window'

export interface ContextManagerConfig {
	maxTokens: number
	strategy: ContextStrategy
	reserveTokens?: number
	summarizer?: (messages: Message[]) => Promise<string>
}

export interface ContextManager {
	fit(messages: Message[], system?: string): Promise<Message[]>
	estimateTokens(messages: Message[]): number
}

export function createContextManager(config: ContextManagerConfig): ContextManager {
	const { maxTokens, strategy, reserveTokens = 0 } = config
	const budget = maxTokens - reserveTokens

	function estimateMessageTokens(msg: Message): number {
		return countTokens(extractMessageText(msg)) + 4
	}

	function estimateTokens(messages: Message[]): number {
		return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0)
	}

	async function fitTruncate(messages: Message[], system?: string): Promise<Message[]> {
		let available = budget
		if (system) available -= countTokens(system)

		const result: Message[] = []
		// Keep messages from the end (newest first)
		for (let i = messages.length - 1; i >= 0; i--) {
			const tokens = estimateMessageTokens(messages[i])
			if (available - tokens < 0 && result.length > 0) break
			available -= tokens
			result.unshift(messages[i])
		}
		return result
	}

	async function fitSummarize(messages: Message[], system?: string): Promise<Message[]> {
		if (!config.summarizer) return fitTruncate(messages, system)

		let available = budget
		if (system) available -= countTokens(system)

		const total = estimateTokens(messages)
		if (total <= available) return messages

		// Split: summarize older messages, keep recent ones
		const keepCount = Math.max(1, Math.floor(messages.length / 3))
		const toSummarize = messages.slice(0, messages.length - keepCount)
		const toKeep = messages.slice(messages.length - keepCount)

		const summary = await config.summarizer(toSummarize)
		const summaryMsg: Message = {
			role: 'system',
			content: `Previous conversation summary: ${summary}`,
		}
		return [summaryMsg, ...toKeep]
	}

	async function fitSlidingWindow(messages: Message[], system?: string): Promise<Message[]> {
		let available = budget
		if (system) available -= countTokens(system)

		const result: Message[] = []
		for (let i = messages.length - 1; i >= 0; i--) {
			const tokens = estimateMessageTokens(messages[i])
			if (available - tokens < 0 && result.length > 0) break
			available -= tokens
			result.unshift(messages[i])
		}
		return result
	}

	return {
		estimateTokens,

		async fit(messages: Message[], system?: string): Promise<Message[]> {
			const total = estimateTokens(messages)
			let available = budget
			if (system) available -= countTokens(system)
			if (total <= available) return messages

			switch (strategy) {
				case 'truncate':
					return fitTruncate(messages, system)
				case 'summarize':
					return fitSummarize(messages, system)
				case 'sliding-window':
					return fitSlidingWindow(messages, system)
			}
		},
	}
}
