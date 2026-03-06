import type { CompletionRequest, LLMResponse } from '@elsium-ai/core'
import { createStream } from '@elsium-ai/core'
import { describe, expect, it } from 'vitest'
import { defineAgent } from './agent'
import { createInMemoryThreadStore, createThread, loadThread } from './thread'

function mockResponse(overrides: Partial<LLMResponse> = {}): LLMResponse {
	return {
		id: 'msg_1',
		message: { role: 'assistant', content: 'Hello!' },
		usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
		cost: { inputCost: 0.001, outputCost: 0.002, totalCost: 0.003, currency: 'USD' },
		model: 'test-model',
		provider: 'test',
		stopReason: 'end_turn',
		latencyMs: 50,
		traceId: 'trc_test',
		...overrides,
	}
}

function mockDeps(responses: Partial<LLMResponse>[]) {
	let callIndex = 0
	return {
		async complete(request: CompletionRequest): Promise<LLMResponse> {
			const resp = responses[callIndex] ?? {}
			callIndex++
			return mockResponse(resp)
		},
		stream(request: CompletionRequest) {
			const resp = responses[callIndex] ?? {}
			callIndex++
			const content = (resp.message?.content as string) ?? 'Hello!'
			return createStream(async (emit) => {
				emit({ type: 'message_start', id: 'msg_1', model: 'test' })
				emit({ type: 'text_delta', text: content })
				emit({
					type: 'message_end',
					usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
					stopReason: 'end_turn',
				})
			})
		},
	}
}

describe('createThread', () => {
	it('creates a thread with auto-generated id', () => {
		const agent = defineAgent(
			{ name: 'test', system: 'Test.' },
			mockDeps([{ message: { role: 'assistant', content: 'Hi' } }]),
		)

		const thread = createThread({ agent })
		expect(thread.id).toBeDefined()
		expect(thread.id).toContain('thread')
	})

	it('creates a thread with custom id', () => {
		const agent = defineAgent({ name: 'test', system: 'Test.' }, mockDeps([]))

		const thread = createThread({ agent, id: 'my-thread-123' })
		expect(thread.id).toBe('my-thread-123')
	})

	it('sends messages and maintains conversation history', async () => {
		const deps = mockDeps([
			{ message: { role: 'assistant', content: 'Hello Alice!' } },
			{ message: { role: 'assistant', content: 'Your name is Alice.' } },
		])

		const agent = defineAgent({ name: 'chatbot', system: 'You chat.' }, deps)
		const thread = createThread({ agent })

		await thread.send('My name is Alice')
		expect(thread.getMessages()).toHaveLength(2)
		expect(thread.getMessages()[0].content).toBe('My name is Alice')
		expect(thread.getMessages()[1].content).toBe('Hello Alice!')

		await thread.send('What is my name?')
		expect(thread.getMessages()).toHaveLength(4)
		expect(thread.getMessages()[3].content).toBe('Your name is Alice.')
	})

	it('forks a thread with full history', async () => {
		const deps = mockDeps([
			{ message: { role: 'assistant', content: 'First response' } },
			{ message: { role: 'assistant', content: 'Forked response' } },
		])

		const agent = defineAgent({ name: 'test', system: 'Test.' }, deps)
		const thread = createThread({ agent })

		await thread.send('Original question')

		const forked = thread.fork()
		expect(forked.id).not.toBe(thread.id)
		expect(forked.getMessages()).toHaveLength(2)
		expect(forked.getMessages()[0].content).toBe('Original question')
		expect(forked.metadata.forkedFrom).toBe(thread.id)
	})

	it('clears thread history', async () => {
		const deps = mockDeps([{ message: { role: 'assistant', content: 'Response' } }])

		const agent = defineAgent({ name: 'test', system: 'Test.' }, deps)
		const thread = createThread({ agent })

		await thread.send('Hello')
		expect(thread.getMessages()).toHaveLength(2)

		thread.clear()
		expect(thread.getMessages()).toHaveLength(0)
	})

	it('allows adding messages manually', () => {
		const agent = defineAgent({ name: 'test', system: 'Test.' }, mockDeps([]))

		const thread = createThread({ agent })
		thread.addMessage({ role: 'user', content: 'Manual message' })
		thread.addMessage({ role: 'assistant', content: 'Manual response' })

		expect(thread.getMessages()).toHaveLength(2)
	})
})

describe('createInMemoryThreadStore', () => {
	it('saves and loads thread snapshots', async () => {
		const store = createInMemoryThreadStore()

		await store.save({
			id: 'thread-1',
			messages: [
				{ role: 'user', content: 'Hello' },
				{ role: 'assistant', content: 'Hi' },
			],
			createdAt: Date.now(),
			updatedAt: Date.now(),
		})

		const snapshot = await store.load('thread-1')
		expect(snapshot).toBeDefined()
		expect(snapshot?.messages).toHaveLength(2)
	})

	it('returns null for non-existent threads', async () => {
		const store = createInMemoryThreadStore()
		const snapshot = await store.load('nonexistent')
		expect(snapshot).toBeNull()
	})

	it('deletes threads', async () => {
		const store = createInMemoryThreadStore()

		await store.save({
			id: 'thread-1',
			messages: [],
			createdAt: Date.now(),
			updatedAt: Date.now(),
		})

		await store.delete('thread-1')
		const snapshot = await store.load('thread-1')
		expect(snapshot).toBeNull()
	})

	it('lists threads sorted by updatedAt', async () => {
		const store = createInMemoryThreadStore()
		const now = Date.now()

		await store.save({
			id: 'thread-old',
			messages: [{ role: 'user', content: 'Old' }],
			createdAt: now - 2000,
			updatedAt: now - 2000,
		})

		await store.save({
			id: 'thread-new',
			messages: [{ role: 'user', content: 'New' }],
			createdAt: now,
			updatedAt: now,
		})

		const list = await store.list()
		expect(list).toHaveLength(2)
		expect(list[0].id).toBe('thread-new')
		expect(list[1].id).toBe('thread-old')
	})

	it('lists threads with limit and offset', async () => {
		const store = createInMemoryThreadStore()
		const now = Date.now()

		for (let i = 0; i < 5; i++) {
			await store.save({
				id: `thread-${i}`,
				messages: [],
				createdAt: now + i,
				updatedAt: now + i,
			})
		}

		const page = await store.list({ limit: 2, offset: 1 })
		expect(page).toHaveLength(2)
	})
})

describe('thread with store persistence', () => {
	it('auto-saves to store on send', async () => {
		const store = createInMemoryThreadStore()
		const deps = mockDeps([{ message: { role: 'assistant', content: 'Saved response' } }])

		const agent = defineAgent({ name: 'test', system: 'Test.' }, deps)
		const thread = createThread({ agent, id: 'persistent-thread', store })

		await thread.send('Hello')

		const snapshot = await store.load('persistent-thread')
		expect(snapshot).toBeDefined()
		expect(snapshot?.messages).toHaveLength(2)
	})

	it('loads thread from store', async () => {
		const store = createInMemoryThreadStore()
		const deps = mockDeps([
			{ message: { role: 'assistant', content: 'First' } },
			{ message: { role: 'assistant', content: 'Continued' } },
		])

		const agent = defineAgent({ name: 'test', system: 'Test.' }, deps)

		const thread1 = createThread({ agent, id: 'resume-thread', store })
		await thread1.send('First message')

		const thread2 = await loadThread('resume-thread', { agent, store })
		expect(thread2).not.toBeNull()
		expect(thread2?.getMessages()).toHaveLength(2)
	})

	it('returns null for non-existent thread', async () => {
		const store = createInMemoryThreadStore()
		const agent = defineAgent({ name: 'test', system: 'Test.' }, mockDeps([]))

		const thread = await loadThread('nonexistent', { agent, store })
		expect(thread).toBeNull()
	})
})
