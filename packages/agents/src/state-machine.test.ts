import type { CompletionRequest, LLMResponse } from '@elsium-ai/core'
import { defineTool } from '@elsium-ai/tools'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { AgentDependencies } from './agent'
import { executeStateMachine } from './state-machine'
import type { StateDefinition } from './types'

// ─── Helpers ────────────────────────────────────────────────────

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
		async complete(_request: CompletionRequest): Promise<LLMResponse> {
			const resp = responses[callIndex] ?? {}
			callIndex++
			return mockResponse(resp)
		},
	}
}

// ─── Tests ──────────────────────────────────────────────────────

describe('executeStateMachine', () => {
	it('executes a simple two-state flow', async () => {
		const deps = mockDeps([
			{ message: { role: 'assistant', content: 'Gathered requirements' } },
			{ message: { role: 'assistant', content: 'Final answer based on requirements' } },
		])

		const states: Record<string, StateDefinition> = {
			gather: {
				system: 'Gather user requirements',
				transition: () => 'respond',
			},
			respond: {
				system: 'Respond with final answer',
				transition: () => 'respond',
				terminal: true,
			},
		}

		const result = await executeStateMachine(
			{ name: 'flow-agent', system: 'Default system' },
			{ states, initialState: 'gather' },
			deps,
			'Help me build a website',
		)

		expect(result.finalState).toBe('respond')
		expect(result.stateHistory).toHaveLength(2)
		expect(result.stateHistory[0].state).toBe('gather')
		expect(result.stateHistory[0].transitionedTo).toBe('respond')
		expect(result.stateHistory[1].state).toBe('respond')
		expect(result.stateHistory[1].transitionedTo).toBeNull()
	})

	it('transitions based on result content', async () => {
		const deps = mockDeps([
			{ message: { role: 'assistant', content: 'needs_clarification' } },
			{ message: { role: 'assistant', content: 'Clarified!' } },
			{ message: { role: 'assistant', content: 'Done' } },
		])

		const states: Record<string, StateDefinition> = {
			analyze: {
				transition: (result) => {
					const text = typeof result.message.content === 'string' ? result.message.content : ''
					return text.includes('needs_clarification') ? 'clarify' : 'complete'
				},
			},
			clarify: {
				system: 'Ask clarifying questions',
				transition: () => 'complete',
			},
			complete: {
				terminal: true,
				transition: () => 'complete',
			},
		}

		const result = await executeStateMachine(
			{ name: 'smart-agent', system: 'Analyze input' },
			{ states, initialState: 'analyze' },
			deps,
			'Ambiguous request',
		)

		expect(result.finalState).toBe('complete')
		expect(result.stateHistory).toHaveLength(3)
		expect(result.stateHistory[0].transitionedTo).toBe('clarify')
		expect(result.stateHistory[1].transitionedTo).toBe('complete')
	})

	it('handles tool calls within a state', async () => {
		const searchTool = defineTool({
			name: 'search',
			description: 'Search for information',
			input: z.object({ query: z.string() }),
			handler: async ({ query }) => ({ results: [`Result for: ${query}`] }),
		})

		const deps = mockDeps([
			{
				message: {
					role: 'assistant',
					content: '',
					toolCalls: [{ id: 'tc_1', name: 'search', arguments: { query: 'test' } }],
				},
				stopReason: 'tool_use',
			},
			{ message: { role: 'assistant', content: 'Found the answer' } },
		])

		const states: Record<string, StateDefinition> = {
			search: {
				tools: [searchTool],
				transition: () => 'done',
				terminal: true,
			},
		}

		const result = await executeStateMachine(
			{ name: 'search-agent', system: 'Search and respond' },
			{ states, initialState: 'search' },
			deps,
			'Find info about AI',
		)

		expect(result.toolCalls).toHaveLength(1)
		expect(result.toolCalls[0].name).toBe('search')
		expect(result.toolCalls[0].result.success).toBe(true)
		expect(result.finalState).toBe('search')
	})

	it('overrides system prompt per state', async () => {
		const capturedSystems: (string | undefined)[] = []
		const deps: AgentDependencies = {
			async complete(request: CompletionRequest): Promise<LLMResponse> {
				capturedSystems.push(request.system)
				return mockResponse({ message: { role: 'assistant', content: 'OK' } })
			},
		}

		const states: Record<string, StateDefinition> = {
			first: {
				system: 'First state system prompt',
				transition: () => 'second',
			},
			second: {
				system: 'Second state system prompt',
				terminal: true,
				transition: () => 'second',
			},
		}

		await executeStateMachine(
			{ name: 'override-agent', system: 'Base system' },
			{ states, initialState: 'first' },
			deps,
			'Start',
		)

		expect(capturedSystems[0]).toBe('First state system prompt')
		expect(capturedSystems[1]).toBe('Second state system prompt')
	})

	it('uses base system prompt when state has no override', async () => {
		const capturedSystems: (string | undefined)[] = []
		const deps: AgentDependencies = {
			async complete(request: CompletionRequest): Promise<LLMResponse> {
				capturedSystems.push(request.system)
				return mockResponse({ message: { role: 'assistant', content: 'OK' } })
			},
		}

		const states: Record<string, StateDefinition> = {
			only: {
				terminal: true,
				transition: () => 'only',
			},
		}

		await executeStateMachine(
			{ name: 'base-agent', system: 'Base system' },
			{ states, initialState: 'only' },
			deps,
			'Start',
		)

		expect(capturedSystems[0]).toBe('Base system')
	})

	it('enforces max iterations', async () => {
		const deps = mockDeps(Array(20).fill({ message: { role: 'assistant', content: 'Looping' } }))

		const states: Record<string, StateDefinition> = {
			loop: {
				transition: () => 'loop',
			},
		}

		await expect(
			executeStateMachine(
				{ name: 'loop-agent', system: 'Loop', guardrails: { maxIterations: 3 } },
				{ states, initialState: 'loop' },
				deps,
				'Loop forever',
			),
		).rejects.toThrow('maximum iterations')
	})

	it('throws for missing initial state', async () => {
		const deps = mockDeps([])

		await expect(
			executeStateMachine(
				{ name: 'missing-agent', system: 'Test' },
				{ states: {}, initialState: 'nonexistent' },
				deps,
				'Start',
			),
		).rejects.toThrow('Initial state "nonexistent" not found')
	})

	it('throws for invalid transition target', async () => {
		const deps = mockDeps([{ message: { role: 'assistant', content: 'OK' } }])

		const states: Record<string, StateDefinition> = {
			start: {
				transition: () => 'nonexistent',
			},
		}

		await expect(
			executeStateMachine(
				{ name: 'bad-transition', system: 'Test' },
				{ states, initialState: 'start' },
				deps,
				'Start',
			),
		).rejects.toThrow('Transition target state "nonexistent" not found')
	})

	it('maintains single conversation history across states', async () => {
		const capturedMessageCounts: number[] = []
		const deps: AgentDependencies = {
			async complete(request: CompletionRequest): Promise<LLMResponse> {
				capturedMessageCounts.push(request.messages.length)
				return mockResponse({ message: { role: 'assistant', content: 'OK' } })
			},
		}

		const states: Record<string, StateDefinition> = {
			first: { transition: () => 'second' },
			second: { terminal: true, transition: () => 'second' },
		}

		await executeStateMachine(
			{ name: 'history-agent', system: 'Test' },
			{ states, initialState: 'first' },
			deps,
			'Start',
		)

		// First call: 1 user message
		expect(capturedMessageCounts[0]).toBe(1)
		// Second call: user + assistant + transition context = 3 messages
		expect(capturedMessageCounts[1]).toBe(3)
	})

	it('records state history with results', async () => {
		const deps = mockDeps([
			{ message: { role: 'assistant', content: 'State A output' } },
			{ message: { role: 'assistant', content: 'State B output' } },
		])

		const states: Record<string, StateDefinition> = {
			a: { transition: () => 'b' },
			b: { terminal: true, transition: () => 'b' },
		}

		const result = await executeStateMachine(
			{ name: 'history-agent', system: 'Test' },
			{ states, initialState: 'a' },
			deps,
			'Begin',
		)

		expect(result.stateHistory).toHaveLength(2)
		expect(result.stateHistory[0].result.message.content).toBe('State A output')
		expect(result.stateHistory[1].result.message.content).toBe('State B output')
	})
})
