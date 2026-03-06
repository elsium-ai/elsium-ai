import { describe, expect, it, vi } from 'vitest'
import { createMemory, createSummarizeFn } from './memory'
import type { MemoryStore } from './stores/memory-store'

function makeMessage(text: string, role: 'user' | 'assistant' = 'user') {
	return { role, content: text }
}

describe('createMemory — sliding-window', () => {
	it('keeps all messages when under the limit', () => {
		const mem = createMemory({ strategy: 'sliding-window', maxMessages: 5 })
		mem.add(makeMessage('a'))
		mem.add(makeMessage('b'))
		mem.add(makeMessage('c'))
		expect(mem.getMessages()).toHaveLength(3)
	})

	it('drops oldest messages once limit is exceeded', () => {
		const mem = createMemory({ strategy: 'sliding-window', maxMessages: 3 })
		mem.add(makeMessage('first'))
		mem.add(makeMessage('second'))
		mem.add(makeMessage('third'))
		mem.add(makeMessage('fourth'))

		const messages = mem.getMessages()
		expect(messages).toHaveLength(3)
		expect(messages[0].content).toBe('second')
		expect(messages[2].content).toBe('fourth')
	})

	it('keeps exactly maxMessages after many additions', () => {
		const mem = createMemory({ strategy: 'sliding-window', maxMessages: 2 })
		for (let i = 0; i < 10; i++) {
			mem.add(makeMessage(`msg-${i}`))
		}
		expect(mem.getMessages()).toHaveLength(2)
		const messages = mem.getMessages()
		expect(messages[0].content).toBe('msg-8')
		expect(messages[1].content).toBe('msg-9')
	})

	it('returns a copy — mutations do not affect internal state', () => {
		const mem = createMemory({ strategy: 'sliding-window', maxMessages: 10 })
		mem.add(makeMessage('hello'))
		const first = mem.getMessages()
		first.push(makeMessage('injected'))
		expect(mem.getMessages()).toHaveLength(1)
	})
})

describe('createMemory — token-limited', () => {
	it('keeps messages within the token budget', () => {
		// Each short message is well within budget individually
		const mem = createMemory({ strategy: 'token-limited', maxTokens: 100 })
		mem.add(makeMessage('hi'))
		mem.add(makeMessage('there'))
		expect(mem.getMessages().length).toBeGreaterThan(0)
	})

	it('drops oldest messages when the budget is exceeded', () => {
		// Long message ~ 667 chars / 1.5 + 4 ≈ 449 tokens per message
		const longText = 'x'.repeat(660)
		const mem = createMemory({ strategy: 'token-limited', maxTokens: 500 })
		mem.add(makeMessage(longText))
		mem.add(makeMessage(longText))

		// After the second add the first message should have been evicted
		const messages = mem.getMessages()
		expect(messages).toHaveLength(1)
		expect(messages[0].content).toBe(longText)
	})

	it('always keeps at least the most recent message (never trims to empty)', () => {
		const hugeLine = 'z'.repeat(10_000)
		const mem = createMemory({ strategy: 'token-limited', maxTokens: 1 })
		mem.add(makeMessage(hugeLine))
		// The while-loop condition is `messages.length > 1`, so one always remains
		expect(mem.getMessages()).toHaveLength(1)
	})

	it('getTokenEstimate reflects the current window', () => {
		const mem = createMemory({ strategy: 'token-limited', maxTokens: 128_000 })
		expect(mem.getTokenEstimate()).toBe(0)
		mem.add(makeMessage('hello world'))
		expect(mem.getTokenEstimate()).toBeGreaterThan(0)
	})
})

describe('createMemory — unlimited', () => {
	it('retains all messages regardless of count', () => {
		const mem = createMemory({ strategy: 'unlimited' })
		for (let i = 0; i < 200; i++) {
			mem.add(makeMessage(`msg-${i}`))
		}
		expect(mem.getMessages()).toHaveLength(200)
	})

	it('does not trim on token budget overflow', () => {
		const longText = 'x'.repeat(10_000)
		const mem = createMemory({ strategy: 'unlimited', maxTokens: 1 })
		mem.add(makeMessage(longText))
		mem.add(makeMessage(longText))
		expect(mem.getMessages()).toHaveLength(2)
	})
})

describe('createMemory — clear', () => {
	it('empties all messages', () => {
		const mem = createMemory({ strategy: 'unlimited' })
		mem.add(makeMessage('a'))
		mem.add(makeMessage('b'))
		mem.clear()
		expect(mem.getMessages()).toHaveLength(0)
		expect(mem.getTokenEstimate()).toBe(0)
	})
})

describe('createMemory — store persistence', () => {
	function makeStore(): MemoryStore {
		return {
			load: vi.fn().mockResolvedValue([]),
			save: vi.fn().mockResolvedValue(undefined),
			clear: vi.fn().mockResolvedValue(undefined),
		}
	}

	it('calls store.save when a message is added', async () => {
		const store = makeStore()
		const mem = createMemory({ strategy: 'unlimited', store, agentId: 'agent-1' })
		mem.add(makeMessage('persisted'))

		// save is fire-and-forget, flush the microtask queue
		await Promise.resolve()

		expect(store.save).toHaveBeenCalledWith('agent-1', [
			expect.objectContaining({ content: 'persisted' }),
		])
	})

	it('calls store.clear when clear() is called', async () => {
		const store = makeStore()
		const mem = createMemory({ strategy: 'unlimited', store, agentId: 'agent-2' })
		mem.add(makeMessage('hello'))
		mem.clear()

		await Promise.resolve()

		expect(store.clear).toHaveBeenCalledWith('agent-2')
	})

	it('loadFromStore replaces in-memory messages with stored messages', async () => {
		const stored = [makeMessage('from-store')]
		const store: MemoryStore = {
			load: vi.fn().mockResolvedValue(stored),
			save: vi.fn().mockResolvedValue(undefined),
			clear: vi.fn().mockResolvedValue(undefined),
		}
		const mem = createMemory({ strategy: 'unlimited', store, agentId: 'agent-3' })
		mem.add(makeMessage('local'))
		await mem.loadFromStore()

		const messages = mem.getMessages()
		expect(messages).toHaveLength(1)
		expect(messages[0].content).toBe('from-store')
	})

	it('saveToStore persists current messages', async () => {
		const store = makeStore()
		const mem = createMemory({ strategy: 'unlimited', store, agentId: 'agent-4' })
		mem.add(makeMessage('hello'))
		await mem.saveToStore()

		expect(store.save).toHaveBeenCalledWith(
			'agent-4',
			expect.arrayContaining([expect.objectContaining({ content: 'hello' })]),
		)
	})

	it('does nothing when no store is configured', async () => {
		// Should not throw
		const mem = createMemory({ strategy: 'unlimited' })
		mem.add(makeMessage('no-store'))
		await expect(mem.loadFromStore()).resolves.toBeUndefined()
		await expect(mem.saveToStore()).resolves.toBeUndefined()
	})

	it('does not call store when agentId is missing', async () => {
		const store = makeStore()
		const mem = createMemory({ strategy: 'unlimited', store })
		mem.add(makeMessage('no-id'))

		await Promise.resolve()

		expect(store.save).not.toHaveBeenCalled()
	})
})

describe('createMemory — summary', () => {
	it('does not trim immediately on add', () => {
		const mem = createMemory({
			strategy: 'summary',
			maxMessages: 3,
			summarize: vi.fn(),
		})

		mem.add(makeMessage('a'))
		mem.add(makeMessage('b'))
		mem.add(makeMessage('c'))
		mem.add(makeMessage('d'))

		expect(mem.getMessages()).toHaveLength(4)
	})

	it('summarizes old messages when summarizeIfNeeded is called', async () => {
		const summarize = vi.fn().mockResolvedValue('Summary of a and b')
		const mem = createMemory({
			strategy: 'summary',
			maxMessages: 3,
			summarize,
		})

		mem.add(makeMessage('a'))
		mem.add(makeMessage('b'))
		mem.add(makeMessage('c'))
		mem.add(makeMessage('d'))

		await mem.summarizeIfNeeded()

		const messages = mem.getMessages()
		expect(summarize).toHaveBeenCalled()
		expect(messages[0].role).toBe('system')
		expect(messages[0].content).toContain('Summary of a and b')
	})

	it('keeps half of maxMessages as recent messages', async () => {
		const summarize = vi.fn().mockResolvedValue('Summary')
		const mem = createMemory({
			strategy: 'summary',
			maxMessages: 4,
			summarize,
		})

		for (let i = 0; i < 6; i++) {
			mem.add(makeMessage(`msg-${i}`))
		}

		await mem.summarizeIfNeeded()

		const messages = mem.getMessages()
		expect(messages[0].role).toBe('system')
		expect(messages).toHaveLength(3)
	})

	it('does not summarize when under limit', async () => {
		const summarize = vi.fn()
		const mem = createMemory({
			strategy: 'summary',
			maxMessages: 10,
			summarize,
		})

		mem.add(makeMessage('a'))
		mem.add(makeMessage('b'))

		await mem.summarizeIfNeeded()

		expect(summarize).not.toHaveBeenCalled()
	})

	it('does nothing when no summarize function provided', async () => {
		const mem = createMemory({
			strategy: 'summary',
			maxMessages: 2,
		})

		mem.add(makeMessage('a'))
		mem.add(makeMessage('b'))
		mem.add(makeMessage('c'))

		await mem.summarizeIfNeeded()
		expect(mem.getMessages()).toHaveLength(3)
	})

	it('passes correct messages to summarize function', async () => {
		const summarize = vi.fn().mockResolvedValue('Summary')
		const mem = createMemory({
			strategy: 'summary',
			maxMessages: 4,
			summarize,
		})

		mem.add(makeMessage('old-1'))
		mem.add(makeMessage('old-2'))
		mem.add(makeMessage('old-3'))
		mem.add(makeMessage('recent-1'))
		mem.add(makeMessage('recent-2'))

		await mem.summarizeIfNeeded()

		const summarizedMessages = summarize.mock.calls[0][0]
		expect(summarizedMessages).toHaveLength(3)
		expect(summarizedMessages[0].content).toBe('old-1')
		expect(summarizedMessages[2].content).toBe('old-3')
	})
})

describe('createSummarizeFn', () => {
	it('calls complete with summarization prompt', async () => {
		const complete = vi.fn().mockResolvedValue({
			message: { role: 'assistant', content: 'Conversation summary here' },
			usage: { inputTokens: 100, outputTokens: 50 },
			cost: { totalCost: 0 },
		})

		const summarize = createSummarizeFn(complete)
		const result = await summarize([makeMessage('Hello'), makeMessage('Hi there', 'assistant')])

		expect(complete).toHaveBeenCalledTimes(1)
		expect(complete.mock.calls[0][0].messages[0].content).toContain('user: Hello')
		expect(complete.mock.calls[0][0].messages[0].content).toContain('assistant: Hi there')
		expect(result).toBe('Conversation summary here')
	})
})
