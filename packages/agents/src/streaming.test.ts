import type { CompletionRequest, LLMResponse, StreamEvent } from '@elsium-ai/core'
import { type ElsiumStream, createStream } from '@elsium-ai/core'
import { defineTool } from '@elsium-ai/tools'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineAgent } from './agent'
import type { AgentStreamEvent } from './streaming'

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

function createMockStream(events: StreamEvent[]): ElsiumStream {
	return createStream(async (emit) => {
		for (const event of events) {
			emit(event)
		}
	})
}

function mockStreamingDeps(streamResponses: StreamEvent[][]) {
	let callIndex = 0
	return {
		async complete(request: CompletionRequest): Promise<LLMResponse> {
			return mockResponse()
		},
		stream(request: CompletionRequest): ElsiumStream {
			const events = streamResponses[callIndex] ?? streamResponses[streamResponses.length - 1]
			callIndex++
			return createMockStream(events)
		},
	}
}

describe('agent.stream()', () => {
	it('streams text deltas from agent', async () => {
		const deps = mockStreamingDeps([
			[
				{ type: 'message_start', id: 'msg_1', model: 'test' },
				{ type: 'text_delta', text: 'Hello' },
				{ type: 'text_delta', text: ' world' },
				{ type: 'text_delta', text: '!' },
				{
					type: 'message_end',
					usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
					stopReason: 'end_turn',
				},
			],
		])

		const agent = defineAgent({ name: 'streamer', system: 'You stream.' }, deps)

		const stream = agent.stream('Hello')
		const events: AgentStreamEvent[] = []

		for await (const event of stream) {
			events.push(event)
		}

		const textDeltas = events.filter((e) => e.type === 'text_delta')
		expect(textDeltas).toHaveLength(3)
		expect(textDeltas.map((e) => (e as { text: string }).text).join('')).toBe('Hello world!')

		const agentEnd = events.find((e) => e.type === 'agent_end')
		expect(agentEnd).toBeDefined()
		expect((agentEnd as { result: { message: { content: string } } }).result.message.content).toBe(
			'Hello world!',
		)
	})

	it('returns final result via result()', async () => {
		const deps = mockStreamingDeps([
			[
				{ type: 'message_start', id: 'msg_1', model: 'test' },
				{ type: 'text_delta', text: 'Done!' },
				{
					type: 'message_end',
					usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
					stopReason: 'end_turn',
				},
			],
		])

		const agent = defineAgent({ name: 'streamer', system: 'Test.' }, deps)

		const stream = agent.stream('Hello')

		for await (const _ of stream) {
			// consume
		}

		const result = await stream.result()
		expect(result.message.content).toBe('Done!')
		expect(result.usage.iterations).toBe(1)
	})

	it('streams tool calls and results', async () => {
		const addTool = defineTool({
			name: 'add',
			description: 'Add two numbers',
			input: z.object({ a: z.number(), b: z.number() }),
			handler: async ({ a, b }) => ({ sum: a + b }),
		})

		const deps = mockStreamingDeps([
			[
				{ type: 'message_start', id: 'msg_1', model: 'test' },
				{ type: 'tool_call_start', toolCall: { id: 'tc_1', name: 'add' } },
				{ type: 'tool_call_delta', toolCallId: 'tc_1', arguments: '{"a":2,' },
				{ type: 'tool_call_delta', toolCallId: 'tc_1', arguments: '"b":3}' },
				{ type: 'tool_call_end', toolCallId: 'tc_1' },
				{
					type: 'message_end',
					usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
					stopReason: 'tool_use',
				},
			],
			[
				{ type: 'message_start', id: 'msg_2', model: 'test' },
				{ type: 'text_delta', text: 'The sum is 5.' },
				{
					type: 'message_end',
					usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
					stopReason: 'end_turn',
				},
			],
		])

		const agent = defineAgent({ name: 'calc', system: 'Calculate.', tools: [addTool] }, deps)

		const stream = agent.stream('What is 2+3?')
		const events: AgentStreamEvent[] = []

		for await (const event of stream) {
			events.push(event)
		}

		const toolResult = events.find((e) => e.type === 'tool_result')
		expect(toolResult).toBeDefined()
		expect((toolResult as { result: { success: boolean; data: unknown } }).result.success).toBe(
			true,
		)
		expect((toolResult as { result: { data: { sum: number } } }).result.data).toEqual({ sum: 5 })

		const result = await stream.result()
		expect(result.message.content).toBe('The sum is 5.')
		expect(result.usage.iterations).toBe(2)
		expect(result.toolCalls).toHaveLength(1)
	})

	it('emits iteration events', async () => {
		const deps = mockStreamingDeps([
			[
				{ type: 'message_start', id: 'msg_1', model: 'test' },
				{ type: 'text_delta', text: 'Hi' },
				{
					type: 'message_end',
					usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
					stopReason: 'end_turn',
				},
			],
		])

		const agent = defineAgent({ name: 'iter', system: 'Test.' }, deps)
		const stream = agent.stream('Hello')
		const events: AgentStreamEvent[] = []

		for await (const event of stream) {
			events.push(event)
		}

		expect(events[0].type).toBe('iteration_start')
		expect((events[0] as { iteration: number }).iteration).toBe(1)

		const iterEnd = events.find((e) => e.type === 'iteration_end')
		expect(iterEnd).toBeDefined()
	})

	it('throws when stream dependency is missing', () => {
		const deps = {
			async complete() {
				return mockResponse()
			},
		}

		const agent = defineAgent({ name: 'no-stream', system: 'Test.' }, deps)

		expect(() => agent.stream('Hello')).toThrow('Streaming requires a stream function')
	})

	it('handles abort signal', async () => {
		const controller = new AbortController()
		controller.abort()

		const deps = mockStreamingDeps([
			[
				{ type: 'message_start', id: 'msg_1', model: 'test' },
				{ type: 'text_delta', text: 'Hi' },
				{
					type: 'message_end',
					usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
					stopReason: 'end_turn',
				},
			],
		])

		const agent = defineAgent({ name: 'aborted', system: 'Test.' }, deps)
		const stream = agent.stream('Hello', { signal: controller.signal })
		const events: AgentStreamEvent[] = []

		for await (const event of stream) {
			events.push(event)
		}

		const errorEvent = events.find((e) => e.type === 'error')
		expect(errorEvent).toBeDefined()
	})

	it('handles max iterations in stream', async () => {
		const loopTool = defineTool({
			name: 'loop',
			description: 'Loop',
			input: z.object({}),
			handler: async () => ({}),
		})

		const toolCallEvents: StreamEvent[] = [
			{ type: 'message_start', id: 'msg_1', model: 'test' },
			{ type: 'tool_call_start', toolCall: { id: 'tc_1', name: 'loop' } },
			{ type: 'tool_call_delta', toolCallId: 'tc_1', arguments: '{}' },
			{ type: 'tool_call_end', toolCallId: 'tc_1' },
			{
				type: 'message_end',
				usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
				stopReason: 'tool_use',
			},
		]

		const deps = mockStreamingDeps(Array(10).fill(toolCallEvents))

		const agent = defineAgent(
			{
				name: 'looper',
				system: 'Loop.',
				tools: [loopTool],
				guardrails: { maxIterations: 2 },
			},
			deps,
		)

		const stream = agent.stream('Loop')
		const events: AgentStreamEvent[] = []

		for await (const event of stream) {
			events.push(event)
		}

		const errorEvent = events.find((e) => e.type === 'error')
		expect(errorEvent).toBeDefined()
		expect((errorEvent as { error: Error }).error.message).toContain('maximum iterations')
	})
})
