import { describe, expect, it, vi } from 'vitest'
import type { Agent } from './agent'
import { createChannelGateway, createWebhookChannel } from './channels'
import type { SessionRouter } from './session'
import type { Thread } from './thread'
import type { AgentResult } from './types'

function mockAgent(name = 'test-agent'): Agent {
	return {
		name,
		config: { name, system: 'test' } as Agent['config'],
		run: vi.fn(),
		stream: vi.fn(),
		chat: vi.fn(),
		resetMemory: vi.fn(),
	}
}

function mockAgentResult(text = 'Hello!'): AgentResult {
	return {
		message: { role: 'assistant', content: text },
		usage: {
			totalInputTokens: 10,
			totalOutputTokens: 5,
			totalTokens: 15,
			totalCost: 0,
			iterations: 1,
		},
		toolCalls: [],
		traceId: 'trace-1',
	}
}

function mockThread(result: AgentResult): Thread {
	return {
		id: 'thread-1',
		metadata: {},
		send: vi.fn().mockResolvedValue(result),
		stream: vi.fn(),
		getMessages: vi.fn().mockReturnValue([]),
		addMessage: vi.fn(),
		fork: vi.fn(),
		clear: vi.fn(),
		save: vi.fn(),
	}
}

function mockSessionRouter(thread: Thread): SessionRouter {
	return {
		resolve: vi.fn().mockResolvedValue(thread),
		getSession: vi.fn().mockReturnValue(null),
		listSessions: vi.fn().mockReturnValue([]),
		endSession: vi.fn().mockReturnValue(false),
		endAllSessions: vi.fn(),
	}
}

describe('createWebhookChannel', () => {
	it('receives and dispatches messages', () => {
		const channel = createWebhookChannel({ name: 'webhook' })
		const handler = vi.fn()
		channel.onMessage(handler)

		channel.receive({ userId: 'user-1', text: 'Hello' })

		expect(handler).toHaveBeenCalledWith({
			channelName: 'webhook',
			userId: 'user-1',
			text: 'Hello',
		})
	})

	it('calls onSend when sending', async () => {
		const onSend = vi.fn()
		const channel = createWebhookChannel({ name: 'webhook', onSend })

		await channel.send('user-1', { text: 'Reply' })

		expect(onSend).toHaveBeenCalledWith('user-1', { text: 'Reply' })
	})

	it('does nothing if no handler registered', () => {
		const channel = createWebhookChannel({ name: 'test' })
		expect(() => channel.receive({ userId: 'u1', text: 'hi' })).not.toThrow()
	})

	it('starts and stops without error', async () => {
		const channel = createWebhookChannel({ name: 'test' })
		await channel.start()
		await channel.stop()
	})
})

describe('createChannelGateway', () => {
	it('routes incoming messages through session router to agent', async () => {
		const agent = mockAgent()
		const result = mockAgentResult('Agent response')
		const thread = mockThread(result)
		const router = mockSessionRouter(thread)
		const channel = createWebhookChannel({ name: 'webhook' })
		const onSend = vi.fn()
		channel.onMessage(() => {})

		const gateway = createChannelGateway({
			adapters: [channel],
			router,
			agent,
		})

		const sendChannel = createWebhookChannel({ name: 'webhook', onSend })
		const realGateway = createChannelGateway({
			adapters: [sendChannel],
			router,
			agent,
		})

		sendChannel.receive({ userId: 'user-1', text: 'Hello agent' })

		await vi.waitFor(() => {
			expect(router.resolve).toHaveBeenCalledWith({
				channelName: 'webhook',
				userId: 'user-1',
				agent,
			})
		})

		await vi.waitFor(() => {
			expect(thread.send).toHaveBeenCalledWith('Hello agent')
		})
	})

	it('starts and stops all adapters', async () => {
		const agent = mockAgent()
		const router = mockSessionRouter(mockThread(mockAgentResult()))
		const adapter1 = createWebhookChannel({ name: 'ch1' })
		const adapter2 = createWebhookChannel({ name: 'ch2' })

		const startSpy1 = vi.spyOn(adapter1, 'start')
		const startSpy2 = vi.spyOn(adapter2, 'start')
		const stopSpy1 = vi.spyOn(adapter1, 'stop')
		const stopSpy2 = vi.spyOn(adapter2, 'stop')

		const gw = createChannelGateway({
			adapters: [adapter1, adapter2],
			router,
			agent,
		})

		await gw.start()
		expect(startSpy1).toHaveBeenCalled()
		expect(startSpy2).toHaveBeenCalled()

		await gw.stop()
		expect(stopSpy1).toHaveBeenCalled()
		expect(stopSpy2).toHaveBeenCalled()
	})

	it('exposes adapters as readonly map', () => {
		const agent = mockAgent()
		const router = mockSessionRouter(mockThread(mockAgentResult()))
		const adapter = createWebhookChannel({ name: 'test' })

		const gw = createChannelGateway({
			adapters: [adapter],
			router,
			agent,
		})

		expect(gw.adapters.size).toBe(1)
		expect(gw.adapters.get('test')).toBe(adapter)
	})

	it('uses resolveAgent for dynamic agent selection', async () => {
		const defaultAgent = mockAgent('default')
		const specialAgent = mockAgent('special')
		const result = mockAgentResult()
		const thread = mockThread(result)
		const router = mockSessionRouter(thread)
		const channel = createWebhookChannel({ name: 'webhook' })

		createChannelGateway({
			adapters: [channel],
			router,
			agent: defaultAgent,
			resolveAgent: (msg) => {
				if (msg.text.startsWith('/special')) return specialAgent
				return undefined
			},
		})

		channel.receive({ userId: 'u1', text: '/special command' })

		await vi.waitFor(() => {
			expect(router.resolve).toHaveBeenCalledWith({
				channelName: 'webhook',
				userId: 'u1',
				agent: specialAgent,
			})
		})
	})

	it('calls onError when processing fails', async () => {
		const agent = mockAgent()
		const router: SessionRouter = {
			resolve: vi.fn().mockRejectedValue(new Error('Session failed')),
			getSession: vi.fn().mockReturnValue(null),
			listSessions: vi.fn().mockReturnValue([]),
			endSession: vi.fn().mockReturnValue(false),
			endAllSessions: vi.fn(),
		}
		const channel = createWebhookChannel({ name: 'webhook' })
		const onError = vi.fn()

		createChannelGateway({
			adapters: [channel],
			router,
			agent,
			onError,
		})

		channel.receive({ userId: 'u1', text: 'hi' })

		await vi.waitFor(() => {
			expect(onError).toHaveBeenCalled()
			expect(onError.mock.calls[0][0]).toBeInstanceOf(Error)
			expect(onError.mock.calls[0][0].message).toBe('Session failed')
		})
	})

	it('swallows onError callback errors', async () => {
		const agent = mockAgent()
		const router: SessionRouter = {
			resolve: vi.fn().mockRejectedValue(new Error('fail')),
			getSession: vi.fn().mockReturnValue(null),
			listSessions: vi.fn().mockReturnValue([]),
			endSession: vi.fn().mockReturnValue(false),
			endAllSessions: vi.fn(),
		}
		const channel = createWebhookChannel({ name: 'webhook' })

		createChannelGateway({
			adapters: [channel],
			router,
			agent,
			onError: () => {
				throw new Error('callback boom')
			},
		})

		channel.receive({ userId: 'u1', text: 'hi' })

		await new Promise((r) => setTimeout(r, 50))
	})

	it('rejects prototype pollution in adapter names', () => {
		const agent = mockAgent()
		const router = mockSessionRouter(mockThread(mockAgentResult()))
		const adapter = createWebhookChannel({ name: '__proto__' })

		const gw = createChannelGateway({
			adapters: [adapter],
			router,
			agent,
		})

		expect(gw.adapters.size).toBe(0)
	})

	it('sends response back through the correct adapter', async () => {
		const agent = mockAgent()
		const result = mockAgentResult('Response text')
		const thread = mockThread(result)
		const router = mockSessionRouter(thread)

		const onSend = vi.fn()
		const channel = createWebhookChannel({ name: 'webhook', onSend })

		createChannelGateway({
			adapters: [channel],
			router,
			agent,
		})

		channel.receive({ userId: 'user-1', text: 'Hello' })

		await vi.waitFor(() => {
			expect(onSend).toHaveBeenCalledWith('user-1', { text: 'Response text' })
		})
	})
})
