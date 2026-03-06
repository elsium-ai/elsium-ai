import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Agent } from './agent'
import { createSessionRouter } from './session'
import type { AgentResult } from './types'

function mockAgent(name = 'test-agent'): Agent {
	const result: AgentResult = {
		message: { role: 'assistant', content: 'Hello!' },
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
	return {
		name,
		config: { name, system: 'test' } as Agent['config'],
		run: vi.fn().mockResolvedValue(result),
		stream: vi.fn(),
		chat: vi.fn().mockResolvedValue(result),
		resetMemory: vi.fn(),
	}
}

describe('createSessionRouter', () => {
	afterEach(() => {
		vi.useRealTimers()
	})

	it('creates a new session on first resolve', async () => {
		const agent = mockAgent()
		const router = createSessionRouter({ defaultAgent: agent })

		const thread = await router.resolve({ channelName: 'slack', userId: 'user-1' })
		expect(thread).toBeTruthy()
		expect(thread.id).toContain('slack')
		expect(thread.id).toContain('user-1')
	})

	it('returns same session for same channel+user', async () => {
		const agent = mockAgent()
		const router = createSessionRouter({ defaultAgent: agent })

		const thread1 = await router.resolve({ channelName: 'slack', userId: 'user-1' })
		const thread2 = await router.resolve({ channelName: 'slack', userId: 'user-1' })

		expect(thread1.id).toBe(thread2.id)
	})

	it('creates separate sessions for different users', async () => {
		const agent = mockAgent()
		const router = createSessionRouter({ defaultAgent: agent })

		const thread1 = await router.resolve({ channelName: 'slack', userId: 'user-1' })
		const thread2 = await router.resolve({ channelName: 'slack', userId: 'user-2' })

		expect(thread1.id).not.toBe(thread2.id)
	})

	it('creates separate sessions for different channels', async () => {
		const agent = mockAgent()
		const router = createSessionRouter({ defaultAgent: agent })

		const thread1 = await router.resolve({ channelName: 'slack', userId: 'user-1' })
		const thread2 = await router.resolve({ channelName: 'discord', userId: 'user-1' })

		expect(thread1.id).not.toBe(thread2.id)
	})

	it('uses provided agent instead of default', async () => {
		const defaultAgent = mockAgent('default')
		const customAgent = mockAgent('custom')
		const router = createSessionRouter({ defaultAgent })

		const thread = await router.resolve({
			channelName: 'slack',
			userId: 'user-1',
			agent: customAgent,
		})

		const session = router.getSession('slack', 'user-1')
		expect(session?.agentName).toBe('custom')
	})

	it('lists active sessions', async () => {
		const agent = mockAgent()
		const router = createSessionRouter({ defaultAgent: agent })

		await router.resolve({ channelName: 'slack', userId: 'user-1' })
		await router.resolve({ channelName: 'discord', userId: 'user-2' })

		const sessions = router.listSessions()
		expect(sessions).toHaveLength(2)
	})

	it('ends a specific session', async () => {
		const agent = mockAgent()
		const router = createSessionRouter({ defaultAgent: agent })

		await router.resolve({ channelName: 'slack', userId: 'user-1' })
		expect(router.endSession('slack', 'user-1')).toBe(true)
		expect(router.getSession('slack', 'user-1')).toBeNull()
	})

	it('ends all sessions', async () => {
		const agent = mockAgent()
		const router = createSessionRouter({ defaultAgent: agent })

		await router.resolve({ channelName: 'slack', userId: 'user-1' })
		await router.resolve({ channelName: 'discord', userId: 'user-2' })

		router.endAllSessions()
		expect(router.listSessions()).toHaveLength(0)
	})

	it('fires onSessionCreated callback', async () => {
		const agent = mockAgent()
		const onSessionCreated = vi.fn()
		const router = createSessionRouter({ defaultAgent: agent, onSessionCreated })

		await router.resolve({ channelName: 'slack', userId: 'user-1' })

		expect(onSessionCreated).toHaveBeenCalledTimes(1)
		expect(onSessionCreated.mock.calls[0][0].channelName).toBe('slack')
		expect(onSessionCreated.mock.calls[0][0].userId).toBe('user-1')
	})

	it('enforces serial concurrency by default', async () => {
		const agent = mockAgent()
		let resolveFirst!: (v: AgentResult) => void
		const firstCall = new Promise<AgentResult>((resolve) => {
			resolveFirst = resolve
		})
		const result: AgentResult = {
			message: { role: 'assistant', content: 'Done' },
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

		let callCount = 0
		;(agent.chat as ReturnType<typeof vi.fn>).mockImplementation(() => {
			callCount++
			if (callCount === 1) return firstCall
			return Promise.resolve(result)
		})

		const router = createSessionRouter({ defaultAgent: agent })
		const thread = await router.resolve({ channelName: 'slack', userId: 'user-1' })

		const p1 = thread.send('First')
		const p2 = thread.send('Second')

		await new Promise((r) => setTimeout(r, 50))
		expect(callCount).toBe(1)

		resolveFirst(result)
		await p1

		await vi.waitFor(() => {
			expect(callCount).toBe(2)
		})

		await p2
	})

	it('expires sessions after timeout', async () => {
		vi.useFakeTimers()
		const agent = mockAgent()
		const onSessionExpired = vi.fn()
		const router = createSessionRouter({
			defaultAgent: agent,
			sessionTimeout: 1000,
			onSessionExpired,
		})

		await router.resolve({ channelName: 'slack', userId: 'user-1' })
		expect(router.listSessions()).toHaveLength(1)

		vi.advanceTimersByTime(1500)

		const thread = await router.resolve({ channelName: 'slack', userId: 'user-1' })

		expect(onSessionExpired).toHaveBeenCalled()

		router.endAllSessions()
		vi.useRealTimers()
	})

	it('returns null for non-existent session', () => {
		const agent = mockAgent()
		const router = createSessionRouter({ defaultAgent: agent })

		expect(router.getSession('slack', 'nobody')).toBeNull()
	})

	it('returns false when ending non-existent session', () => {
		const agent = mockAgent()
		const router = createSessionRouter({ defaultAgent: agent })

		expect(router.endSession('slack', 'nobody')).toBe(false)
	})
})
