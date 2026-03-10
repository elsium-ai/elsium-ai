import type { LLMResponse, ToolDefinition } from '@elsium-ai/core'
import type { Tool, ToolExecutionResult } from '@elsium-ai/tools'
import { describe, expect, it, vi } from 'vitest'
import { defineReActAgent } from './react'

function mockTool(name: string, result: string): Tool {
	return {
		name,
		description: `Mock ${name} tool`,
		inputSchema: {} as never,
		timeoutMs: 5000,
		async execute(): Promise<ToolExecutionResult> {
			return {
				success: true,
				data: result,
				toolCallId: 'tc-1',
				durationMs: 10,
			}
		},
		toDefinition(): ToolDefinition {
			return {
				name,
				description: `Mock ${name} tool`,
				inputSchema: { type: 'object', properties: {} },
			}
		},
	}
}

function makeResponse(content: string, overrides?: Partial<LLMResponse>): LLMResponse {
	return {
		id: 'resp-1',
		message: { role: 'assistant', content },
		usage: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
		cost: { totalCost: 0.001, inputCost: 0.0005, outputCost: 0.0005 },
		model: 'test-model',
		provider: 'test',
		stopReason: 'end_turn',
		latencyMs: 100,
		traceId: 'trace-1',
		...overrides,
	}
}

describe('defineReActAgent', () => {
	it('handles text-based ReAct format: thought → action → observation → final answer', async () => {
		const complete = vi
			.fn()
			.mockResolvedValueOnce(
				makeResponse(
					'Thought: I need to search for the answer\nAction: search\nAction Input: {"query": "test"}',
				),
			)
			.mockResolvedValueOnce(
				makeResponse('Thought: I now have the answer\nFinal Answer: The answer is 42'),
			)

		const agent = defineReActAgent({
			name: 'test-react',
			tools: [mockTool('search', 'The answer is 42')],
			provider: {
				complete,
				stream: vi.fn(),
				name: 'test',
				defaultModel: 'test',
				listModels: vi.fn(),
			} as never,
		})

		const result = await agent.run('What is the answer?')

		expect(result.message.content).toBe('The answer is 42')
		expect(result.reasoning).toHaveLength(2)
		expect(result.reasoning[0].thought).toBe('I need to search for the answer')
		expect(result.reasoning[0].action?.tool).toBe('search')
		expect(result.reasoning[0].observation).toBe('The answer is 42')
		expect(result.reasoning[1].thought).toBe('I now have the answer')
		expect(result.toolCalls).toHaveLength(1)
	})

	it('handles native tool calling mode', async () => {
		const complete = vi
			.fn()
			.mockResolvedValueOnce(
				makeResponse('', {
					stopReason: 'tool_use',
					message: {
						role: 'assistant',
						content: 'Thought: Using search',
						toolCalls: [{ id: 'tc-1', name: 'search', arguments: { query: 'test' } }],
					},
				}),
			)
			.mockResolvedValueOnce(makeResponse('Thought: Got the result\nFinal Answer: Found it'))

		const agent = defineReActAgent({
			name: 'test-react',
			tools: [mockTool('search', 'search result')],
			provider: {
				complete,
				stream: vi.fn(),
				name: 'test',
				defaultModel: 'test',
				listModels: vi.fn(),
			} as never,
		})

		const result = await agent.run('Search for something')

		expect(result.message.content).toBe('Found it')
		expect(result.reasoning[0].action?.tool).toBe('search')
		expect(result.reasoning[0].observation).toBe('search result')
	})

	it('throws on max iterations', async () => {
		const complete = vi
			.fn()
			.mockResolvedValue(
				makeResponse('Thought: Still thinking\nAction: search\nAction Input: {"query": "test"}'),
			)

		const agent = defineReActAgent({
			name: 'test-react',
			tools: [mockTool('search', 'result')],
			maxIterations: 2,
			provider: {
				complete,
				stream: vi.fn(),
				name: 'test',
				defaultModel: 'test',
				listModels: vi.fn(),
			} as never,
		})

		await expect(agent.run('infinite loop')).rejects.toThrow('maximum iterations')
	})

	it('throws on budget exceeded', async () => {
		const complete = vi.fn().mockResolvedValue(
			makeResponse('Thought: thinking\nAction: search\nAction Input: {"query": "test"}', {
				usage: { inputTokens: 300_000, outputTokens: 300_000, totalTokens: 600_000 },
			}),
		)

		const agent = defineReActAgent({
			name: 'test-react',
			tools: [mockTool('search', 'result')],
			maxTokenBudget: 100_000,
			provider: {
				complete,
				stream: vi.fn(),
				name: 'test',
				defaultModel: 'test',
				listModels: vi.fn(),
			} as never,
		})

		await expect(agent.run('expensive query')).rejects.toThrow('budget')
	})

	it('calls hooks correctly', async () => {
		const onThought = vi.fn()
		const onAction = vi.fn()
		const onObservation = vi.fn()

		const complete = vi
			.fn()
			.mockResolvedValueOnce(
				makeResponse('Thought: Need to search\nAction: search\nAction Input: {"query": "test"}'),
			)
			.mockResolvedValueOnce(makeResponse('Thought: Done\nFinal Answer: result'))

		const agent = defineReActAgent({
			name: 'test-react',
			tools: [mockTool('search', 'found')],
			hooks: { onThought, onAction, onObservation },
			provider: {
				complete,
				stream: vi.fn(),
				name: 'test',
				defaultModel: 'test',
				listModels: vi.fn(),
			} as never,
		})

		await agent.run('test')

		expect(onThought).toHaveBeenCalledWith('Need to search', 1)
		expect(onAction).toHaveBeenCalledWith('search', { query: 'test' }, 1)
		expect(onObservation).toHaveBeenCalledWith(
			expect.objectContaining({ success: true, data: 'found' }),
			1,
		)
	})

	it('returns response directly when no action or final answer', async () => {
		const complete = vi
			.fn()
			.mockResolvedValueOnce(makeResponse('Just a plain response without ReAct format'))

		const agent = defineReActAgent({
			name: 'test-react',
			tools: [mockTool('search', 'result')],
			provider: {
				complete,
				stream: vi.fn(),
				name: 'test',
				defaultModel: 'test',
				listModels: vi.fn(),
			} as never,
		})

		const result = await agent.run('hello')

		expect(result.message.content).toBe('Just a plain response without ReAct format')
		expect(result.reasoning).toHaveLength(1)
	})
})
