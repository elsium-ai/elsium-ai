import type { CompletionRequest, LLMResponse } from '@elsium-ai/core'
import { defineTool } from '@elsium-ai/tools'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { AgentDependencies } from './agent'
import { createMemory, defineAgent, runParallel, runSequential, runSupervisor } from './index'

// ─── Helpers ─────────────────────────────────────────────────────

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

function mockDeps(responses: Partial<LLMResponse>[]): AgentDependencies {
	let callIndex = 0
	return {
		async complete(request: CompletionRequest): Promise<LLMResponse> {
			const resp = responses[callIndex] ?? {}
			callIndex++
			return mockResponse(resp)
		},
	}
}

// ─── Memory ──────────────────────────────────────────────────────

describe('createMemory', () => {
	it('stores messages', () => {
		const mem = createMemory({ strategy: 'unlimited' })
		mem.add({ role: 'user', content: 'hello' })
		mem.add({ role: 'assistant', content: 'hi' })

		expect(mem.getMessages()).toHaveLength(2)
	})

	it('sliding-window trims by message count', () => {
		const mem = createMemory({ strategy: 'sliding-window', maxMessages: 3 })

		mem.add({ role: 'user', content: 'msg 1' })
		mem.add({ role: 'assistant', content: 'resp 1' })
		mem.add({ role: 'user', content: 'msg 2' })
		mem.add({ role: 'assistant', content: 'resp 2' })

		expect(mem.getMessages()).toHaveLength(3)
		expect(mem.getMessages()[0].content).toBe('resp 1')
	})

	it('token-limited trims by estimated tokens', () => {
		// Conservative estimate: ~1.5 chars/token + 4 overhead per message
		// 24 chars / 1.5 + 4 = 20 tokens per message
		const mem = createMemory({ strategy: 'token-limited', maxTokens: 50 })

		mem.add({ role: 'user', content: 'This is a medium message' })
		mem.add({ role: 'assistant', content: 'This is another message!' })
		mem.add({ role: 'user', content: 'And one more message here' })

		const messages = mem.getMessages()
		expect(messages.length).toBeLessThanOrEqual(3)
		expect(mem.getTokenEstimate()).toBeLessThanOrEqual(50)
	})

	it('clears all messages', () => {
		const mem = createMemory({ strategy: 'unlimited' })
		mem.add({ role: 'user', content: 'hello' })
		mem.clear()
		expect(mem.getMessages()).toHaveLength(0)
	})

	it('estimates tokens', () => {
		const mem = createMemory({ strategy: 'unlimited' })
		mem.add({ role: 'user', content: 'hello world test' }) // 16 chars ~4 tokens
		expect(mem.getTokenEstimate()).toBeGreaterThan(0)
	})
})

// ─── Agent ───────────────────────────────────────────────────────

describe('defineAgent', () => {
	it('throws when neither deps nor provider/apiKey is provided', () => {
		expect(() => defineAgent({ name: 'bad', system: 'test' })).toThrow(
			'Either provide AgentDependencies',
		)
	})

	it('runs simple completion', async () => {
		const deps = mockDeps([{ message: { role: 'assistant', content: 'I can help with that!' } }])

		const agent = defineAgent({ name: 'helper', system: 'You are helpful.' }, deps)

		const result = await agent.run('Hello')
		expect(result.message.content).toBe('I can help with that!')
		expect(result.usage.iterations).toBe(1)
		expect(result.usage.totalCost).toBeGreaterThan(0)
		expect(result.toolCalls).toHaveLength(0)
	})

	it('executes tool calls', async () => {
		const addTool = defineTool({
			name: 'add',
			description: 'Add two numbers',
			input: z.object({ a: z.number(), b: z.number() }),
			handler: async ({ a, b }) => ({ sum: a + b }),
		})

		const deps = mockDeps([
			{
				message: {
					role: 'assistant',
					content: '',
					toolCalls: [{ id: 'tc_1', name: 'add', arguments: { a: 2, b: 3 } }],
				},
				stopReason: 'tool_use',
			},
			{
				message: { role: 'assistant', content: 'The sum is 5.' },
				stopReason: 'end_turn',
			},
		])

		const agent = defineAgent(
			{ name: 'calculator', system: 'You can add numbers.', tools: [addTool] },
			deps,
		)

		const result = await agent.run('What is 2 + 3?')
		expect(result.message.content).toBe('The sum is 5.')
		expect(result.usage.iterations).toBe(2)
		expect(result.toolCalls).toHaveLength(1)
		expect(result.toolCalls[0].name).toBe('add')
		expect(result.toolCalls[0].result.success).toBe(true)
		expect(result.toolCalls[0].result.data).toEqual({ sum: 5 })
	})

	it('handles unknown tool gracefully', async () => {
		const deps = mockDeps([
			{
				message: {
					role: 'assistant',
					content: '',
					toolCalls: [{ id: 'tc_1', name: 'unknown_tool', arguments: {} }],
				},
				stopReason: 'tool_use',
			},
			{
				message: { role: 'assistant', content: 'Sorry, I could not use that tool.' },
				stopReason: 'end_turn',
			},
		])

		const agent = defineAgent({ name: 'test', system: 'Test agent.' }, deps)

		const result = await agent.run('Do something')
		expect(result.toolCalls[0].result.success).toBe(false)
		expect(result.toolCalls[0].result.error).toContain('Unknown tool')
	})

	it('enforces max iterations', async () => {
		const deps = mockDeps(
			Array(20).fill({
				message: {
					role: 'assistant',
					content: '',
					toolCalls: [{ id: 'tc_1', name: 'loop', arguments: {} }],
				},
				stopReason: 'tool_use',
			}),
		)

		const loopTool = defineTool({
			name: 'loop',
			description: 'Loop forever',
			input: z.object({}),
			handler: async () => ({}),
		})

		const agent = defineAgent(
			{
				name: 'looper',
				system: 'Loop.',
				tools: [loopTool],
				guardrails: { maxIterations: 3 },
			},
			deps,
		)

		await expect(agent.run('Loop')).rejects.toThrow('maximum iterations')
	})

	it('enforces token budget', async () => {
		const deps = mockDeps([
			{
				usage: { inputTokens: 300_000, outputTokens: 300_000, totalTokens: 600_000 },
				message: {
					role: 'assistant',
					content: '',
					toolCalls: [{ id: 'tc_1', name: 'noop', arguments: {} }],
				},
				stopReason: 'tool_use',
			},
		])

		const noopTool = defineTool({
			name: 'noop',
			description: 'No-op',
			input: z.object({}),
			handler: async () => ({}),
		})

		const agent = defineAgent(
			{
				name: 'expensive',
				system: 'Expensive.',
				tools: [noopTool],
				guardrails: { maxTokenBudget: 100_000 },
			},
			deps,
		)

		await expect(agent.run('Expensive')).rejects.toThrow('budget exceeded')
	})

	it('validates input', async () => {
		const deps = mockDeps([])
		const agent = defineAgent(
			{
				name: 'strict',
				system: 'Strict.',
				guardrails: {
					inputValidator: (input) => (input.length > 5 ? true : 'Input too short'),
				},
			},
			deps,
		)

		await expect(agent.run('Hi')).rejects.toThrow('Input too short')
	})

	it('validates output', async () => {
		const deps = mockDeps([{ message: { role: 'assistant', content: 'SECRET: password123' } }])

		const agent = defineAgent(
			{
				name: 'filtered',
				system: 'Filtered.',
				guardrails: {
					outputValidator: (output) =>
						!output.includes('SECRET') ? true : 'Output contains sensitive data',
				},
			},
			deps,
		)

		await expect(agent.run('Tell me secrets')).rejects.toThrow('sensitive data')
	})

	it('calls hooks during execution', async () => {
		const onMessage = vi.fn()
		const onComplete = vi.fn()

		const deps = mockDeps([{ message: { role: 'assistant', content: 'Done!' } }])

		const agent = defineAgent(
			{
				name: 'hooked',
				system: 'With hooks.',
				hooks: { onMessage, onComplete },
			},
			deps,
		)

		await agent.run('Test')

		expect(onMessage).toHaveBeenCalledOnce()
		expect(onComplete).toHaveBeenCalledOnce()
		expect(onComplete.mock.calls[0][0].message.content).toBe('Done!')
	})

	it('resets memory', async () => {
		const deps = mockDeps([
			{ message: { role: 'assistant', content: 'First response' } },
			{ message: { role: 'assistant', content: 'After reset' } },
		])

		const agent = defineAgent(
			{
				name: 'memo',
				system: 'Remember.',
				memory: { strategy: 'unlimited' },
			},
			deps,
		)

		await agent.run('First')
		agent.resetMemory()
		const result = await agent.run('Second')
		expect(result.message.content).toBe('After reset')
	})
})

// ─── Multi-Agent ─────────────────────────────────────────────────

describe('runSequential', () => {
	it('passes output to next agent', async () => {
		const deps1 = mockDeps([{ message: { role: 'assistant', content: 'Researched: AI agents' } }])
		const deps2 = mockDeps([
			{ message: { role: 'assistant', content: 'Summary of AI agents research' } },
		])

		const researcher = defineAgent({ name: 'researcher', system: 'Research.' }, deps1)
		const writer = defineAgent({ name: 'writer', system: 'Summarize.' }, deps2)

		const results = await runSequential([researcher, writer], 'AI agents')
		expect(results).toHaveLength(2)
		expect(results[0].message.content).toBe('Researched: AI agents')
		expect(results[1].message.content).toBe('Summary of AI agents research')
	})
})

describe('runParallel', () => {
	it('runs agents concurrently', async () => {
		const deps1 = mockDeps([{ message: { role: 'assistant', content: 'Result from A' } }])
		const deps2 = mockDeps([{ message: { role: 'assistant', content: 'Result from B' } }])

		const agentA = defineAgent({ name: 'a', system: 'Agent A.' }, deps1)
		const agentB = defineAgent({ name: 'b', system: 'Agent B.' }, deps2)

		const results = await runParallel([agentA, agentB], 'Same input')
		expect(results).toHaveLength(2)
		expect(results[0].message.content).toBe('Result from A')
		expect(results[1].message.content).toBe('Result from B')
	})
})

// ─── runSupervisor ───────────────────────────────────────────────

describe('runSupervisor', () => {
	it('delegates to supervisor with worker descriptions', async () => {
		let capturedInput = ''
		const supervisorDeps: AgentDependencies = {
			async complete(request: CompletionRequest): Promise<LLMResponse> {
				// Capture the input the supervisor receives
				const userMsg = request.messages.find((m) => m.role === 'user')
				capturedInput = typeof userMsg?.content === 'string' ? userMsg.content : ''
				return mockResponse({
					message: { role: 'assistant', content: 'Supervisor synthesized result' },
				})
			},
		}

		const supervisor = defineAgent(
			{ name: 'supervisor', system: 'You coordinate workers.' },
			supervisorDeps,
		)

		const worker1 = defineAgent(
			{ name: 'researcher', system: 'You research topics deeply and thoroughly.' },
			mockDeps([]),
		)
		const worker2 = defineAgent(
			{ name: 'writer', system: 'You write clear and concise summaries.' },
			mockDeps([]),
		)

		const result = await runSupervisor(supervisor, [worker1, worker2], 'Summarize AI trends')

		expect(result.message.content).toBe('Supervisor synthesized result')
		expect(capturedInput).toContain('researcher')
		expect(capturedInput).toContain('writer')
		expect(capturedInput).toContain('Summarize AI trends')
		expect(capturedInput).toContain('You are coordinating the following workers')
	})

	it('handles non-string content in sequential chain', async () => {
		const deps1 = mockDeps([
			{
				message: {
					role: 'assistant',
					content: [{ type: 'text' as const, text: 'Complex content' }],
				},
			},
		])
		const deps2 = mockDeps([{ message: { role: 'assistant', content: 'Final result' } }])

		const agent1 = defineAgent({ name: 'a1', system: 'Agent 1.' }, deps1)
		const agent2 = defineAgent({ name: 'a2', system: 'Agent 2.' }, deps2)

		const results = await runSequential([agent1, agent2], 'Start')
		expect(results).toHaveLength(2)
		// When content is not a string, runSequential passes empty string to next agent
		expect(results[1].message.content).toBe('Final result')
	})
})

// ─── Memory (unlimited strategy) ─────────────────────────────────

describe('createMemory - unlimited strategy', () => {
	it('never trims messages regardless of count', () => {
		const mem = createMemory({ strategy: 'unlimited', maxMessages: 2 })

		mem.add({ role: 'user', content: 'msg 1' })
		mem.add({ role: 'assistant', content: 'resp 1' })
		mem.add({ role: 'user', content: 'msg 2' })
		mem.add({ role: 'assistant', content: 'resp 2' })
		mem.add({ role: 'user', content: 'msg 3' })

		// Unlimited strategy should keep all messages even though maxMessages is 2
		expect(mem.getMessages()).toHaveLength(5)
	})

	it('never trims messages regardless of token count', () => {
		const mem = createMemory({ strategy: 'unlimited', maxTokens: 1 })

		// Add messages that would exceed the token limit
		mem.add({
			role: 'user',
			content:
				'This is a very long message that has many tokens in it and would exceed a low token limit',
		})
		mem.add({
			role: 'assistant',
			content: 'Another very long response with many tokens as well that should be kept',
		})

		// Unlimited strategy should keep all messages even though token limit is very low
		expect(mem.getMessages()).toHaveLength(2)
		expect(mem.getTokenEstimate()).toBeGreaterThan(1)
	})

	it('reports correct strategy name', () => {
		const mem = createMemory({ strategy: 'unlimited' })
		expect(mem.strategy).toBe('unlimited')
	})
})

// ─── Agent chat() method ─────────────────────────────────────────

describe('defineAgent - chat()', () => {
	it('sends raw messages through the execute loop', async () => {
		const deps = mockDeps([{ message: { role: 'assistant', content: 'Chat response' } }])

		const agent = defineAgent({ name: 'chatbot', system: 'You are a chatbot.' }, deps)

		const result = await agent.chat([{ role: 'user', content: 'Hello from chat' }])

		expect(result.message.content).toBe('Chat response')
		expect(result.usage.iterations).toBe(1)
		expect(result.traceId).toBeDefined()
	})

	it('accepts multiple messages in a conversation', async () => {
		const deps = mockDeps([{ message: { role: 'assistant', content: 'I remember the context' } }])

		const agent = defineAgent(
			{ name: 'chatbot', system: 'You are a chatbot.', memory: { strategy: 'unlimited' } },
			deps,
		)

		const result = await agent.chat([
			{ role: 'user', content: 'My name is Alice' },
			{ role: 'assistant', content: 'Hello Alice!' },
			{ role: 'user', content: 'What is my name?' },
		])

		expect(result.message.content).toBe('I remember the context')
	})

	it('validates user-role messages in chat()', async () => {
		const agent = defineAgent(
			{
				name: 'strict',
				system: 'Strict agent.',
				guardrails: {
					inputValidator: () => 'Input too short',
				},
			},
			mockDeps([{ message: { role: 'assistant', content: 'OK' } }]),
		)

		// chat() now validates user-role messages (fix 4.2)
		await expect(agent.chat([{ role: 'user', content: 'Hi' }])).rejects.toThrow('Input too short')
	})
})
