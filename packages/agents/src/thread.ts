import type { Message } from '@elsium-ai/core'
import { generateId } from '@elsium-ai/core'
import type { Agent } from './agent'
import type { AgentStream } from './streaming'
import type { AgentResult, AgentRunOptions } from './types'

export interface ThreadConfig {
	id?: string
	agent: Agent
	metadata?: Record<string, unknown>
	store?: ThreadStore
}

export interface ThreadStore {
	load(threadId: string): Promise<ThreadSnapshot | null>
	save(snapshot: ThreadSnapshot): Promise<void>
	delete(threadId: string): Promise<void>
	list(options?: { limit?: number; offset?: number }): Promise<ThreadSummary[]>
}

export interface ThreadSnapshot {
	id: string
	messages: Message[]
	createdAt: number
	updatedAt: number
	metadata?: Record<string, unknown>
}

export interface ThreadSummary {
	id: string
	messageCount: number
	createdAt: number
	updatedAt: number
	lastMessage?: string
	metadata?: Record<string, unknown>
}

export interface Thread {
	readonly id: string
	readonly metadata: Record<string, unknown>
	send(input: string, options?: AgentRunOptions): Promise<AgentResult>
	stream(input: string, options?: AgentRunOptions): AgentStream
	getMessages(): Message[]
	addMessage(message: Message): void
	fork(options?: { id?: string }): Thread
	clear(): void
	save(): Promise<void>
}

export function createThread(config: ThreadConfig): Thread {
	const id = config.id ?? generateId('thread')
	const messages: Message[] = []
	const metadata = { ...config.metadata }
	const createdAt = Date.now()
	let updatedAt = createdAt

	function addMessage(message: Message) {
		messages.push(message)
		updatedAt = Date.now()
		if (config.store) {
			config.store
				.save({
					id,
					messages: [...messages],
					createdAt,
					updatedAt,
					metadata,
				})
				.catch(() => {})
		}
	}

	return {
		id,
		metadata,

		async send(input: string, options: AgentRunOptions = {}): Promise<AgentResult> {
			const userMessage: Message = { role: 'user', content: input }
			addMessage(userMessage)

			const result = await config.agent.chat([...messages], options)

			addMessage(result.message)
			return result
		},

		stream(input: string, options: AgentRunOptions = {}): AgentStream {
			const userMessage: Message = { role: 'user', content: input }
			addMessage(userMessage)

			const agentStream = config.agent.stream(input, options)

			const originalResult = agentStream.result.bind(agentStream)

			const wrappedStream: AgentStream = {
				[Symbol.asyncIterator]() {
					const inner = agentStream[Symbol.asyncIterator]()
					return {
						async next() {
							const iterResult = await inner.next()
							if (!iterResult.done && iterResult.value.type === 'agent_end') {
								addMessage(iterResult.value.result.message)
							}
							return iterResult
						},
					}
				},
				async result() {
					const r = await originalResult()
					return r
				},
			}

			return wrappedStream
		},

		getMessages(): Message[] {
			return [...messages]
		},

		addMessage(message: Message) {
			addMessage(message)
		},

		fork(options?: { id?: string }): Thread {
			const forked = createThread({
				id: options?.id,
				agent: config.agent,
				metadata: { ...metadata, forkedFrom: id },
				store: config.store,
			})
			for (const msg of messages) {
				forked.addMessage({ ...msg })
			}
			return forked
		},

		clear() {
			messages.length = 0
			updatedAt = Date.now()
		},

		async save(): Promise<void> {
			if (!config.store) return
			await config.store.save({
				id,
				messages: [...messages],
				createdAt,
				updatedAt,
				metadata,
			})
		},
	}
}

export async function loadThread(
	threadId: string,
	config: Omit<ThreadConfig, 'id'> & { store: ThreadStore },
): Promise<Thread | null> {
	const snapshot = await config.store.load(threadId)
	if (!snapshot) return null

	const thread = createThread({
		id: threadId,
		agent: config.agent,
		metadata: snapshot.metadata,
		store: config.store,
	})

	for (const msg of snapshot.messages) {
		thread.addMessage(msg)
	}

	return thread
}

export function createInMemoryThreadStore(): ThreadStore {
	const store = new Map<string, ThreadSnapshot>()

	return {
		async load(threadId: string): Promise<ThreadSnapshot | null> {
			const snapshot = store.get(threadId)
			if (!snapshot) return null
			return { ...snapshot, messages: [...snapshot.messages] }
		},

		async save(snapshot: ThreadSnapshot): Promise<void> {
			store.set(snapshot.id, { ...snapshot, messages: [...snapshot.messages] })
		},

		async delete(threadId: string): Promise<void> {
			store.delete(threadId)
		},

		async list(options?: { limit?: number; offset?: number }): Promise<ThreadSummary[]> {
			const limit = options?.limit ?? 50
			const offset = options?.offset ?? 0

			const entries = [...store.values()]
				.sort((a, b) => b.updatedAt - a.updatedAt)
				.slice(offset, offset + limit)

			return entries.map((s) => {
				const lastMsg = s.messages[s.messages.length - 1]
				const lastMessage = lastMsg
					? typeof lastMsg.content === 'string'
						? lastMsg.content.slice(0, 100)
						: undefined
					: undefined

				return {
					id: s.id,
					messageCount: s.messages.length,
					createdAt: s.createdAt,
					updatedAt: s.updatedAt,
					lastMessage,
					metadata: s.metadata,
				}
			})
		},
	}
}
