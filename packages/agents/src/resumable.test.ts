import type { CompletionRequest, LLMResponse } from '@elsium-ai/core'
import {
	AgentPauseSignal,
	createInMemoryStateStore,
	isAgentPauseSignal,
	pauseAgent,
} from '@elsium-ai/core'
import { defineTool } from '@elsium-ai/tools'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { AgentDependencies } from './agent'
import { defineAgent } from './agent'
import type { AgentSnapshot } from './resumable'

function mockComplete(seq: LLMResponse[]): AgentDependencies['complete'] {
	let i = 0
	return async (_: CompletionRequest) => {
		const r = seq[Math.min(i, seq.length - 1)]
		i++
		return r
	}
}

function llmResponse(text: string, toolCallName?: string): LLMResponse {
	const isTool = !!toolCallName
	return {
		id: 'msg',
		message: isTool
			? {
					role: 'assistant',
					content: text,
					toolCalls: [{ id: 'tc_1', name: toolCallName as string, arguments: {} }],
				}
			: { role: 'assistant', content: text },
		usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
		cost: { inputCost: 0, outputCost: 0, totalCost: 0, currency: 'USD' },
		model: 'mock',
		provider: 'mock',
		stopReason: isTool ? 'tool_use' : 'end_turn',
		latencyMs: 1,
		traceId: 'trc',
	}
}

describe('AgentPauseSignal propagation', () => {
	it('a tool throwing pauseAgent surfaces the signal out of agent.run()', async () => {
		const pauseTool = defineTool({
			name: 'pause_for_human',
			description: '',
			input: z.object({}),
			handler: async () => {
				pauseAgent('waiting for human', { foo: 'bar' })
				return {}
			},
		})

		const agent = defineAgent(
			{
				name: 'pausable',
				system: '',
				model: 'm',
				tools: [pauseTool],
			},
			{ complete: mockComplete([llmResponse('calling tool', 'pause_for_human')]) },
		)

		await expect(agent.run('go')).rejects.toThrow(AgentPauseSignal)
	})
})

describe('runResumable + resume', () => {
	it('returns paused outcome with resumeToken when a tool pauses', async () => {
		const pauseTool = defineTool({
			name: 'wait_for_review',
			description: '',
			input: z.object({}),
			handler: async () => {
				pauseAgent('manual review', { amount: 100 })
				return {}
			},
		})

		const agent = defineAgent(
			{ name: 'reviewer', system: '', model: 'm', tools: [pauseTool] },
			{ complete: mockComplete([llmResponse('reviewing...', 'wait_for_review')]) },
		)

		const store = createInMemoryStateStore<AgentSnapshot>()
		const outcome = await agent.runResumable('go', {}, { stateStore: store })
		expect(outcome.status).toBe('paused')
		if (outcome.status === 'paused') {
			expect(outcome.resumeToken).toMatch(/elsium:agent-snapshot:/)
			expect(outcome.reason).toBe('manual review')
			expect(outcome.context).toEqual({ amount: 100 })
		}
	})

	it('resumes from a paused snapshot and completes', async () => {
		let pauseCount = 0
		const reviewTool = defineTool({
			name: 'review',
			description: '',
			input: z.object({}),
			handler: async () => {
				if (pauseCount === 0) {
					pauseCount++
					pauseAgent('first review')
					return {}
				}
				return { decision: 'approved' }
			},
		})

		const agent = defineAgent(
			{ name: 'reviewer', system: '', model: 'm', tools: [reviewTool] },
			{
				complete: mockComplete([llmResponse('calling tool', 'review'), llmResponse('done')]),
			},
		)

		const store = createInMemoryStateStore<AgentSnapshot>()
		const paused = await agent.runResumable('start', {}, { stateStore: store })
		expect(paused.status).toBe('paused')

		if (paused.status !== 'paused') throw new Error('expected paused')
		const final = await agent.resume(paused.resumeToken, {
			stateStore: store,
			followUpMessage: { role: 'user', content: 'human approved' },
		})

		expect(final.status).toBe('complete')
		if (final.status === 'complete') {
			expect(final.result.message.content).toBe('done')
		}
	})

	it('throws when resumeToken is unknown', async () => {
		const agent = defineAgent(
			{ name: 'x', system: '', model: 'm' },
			{ complete: mockComplete([llmResponse('hi')]) },
		)
		await expect(agent.resume('bogus')).rejects.toThrow(/no snapshot found/i)
	})

	it('returns complete outcome when no pause occurs', async () => {
		const agent = defineAgent(
			{ name: 'normal', system: '', model: 'm' },
			{ complete: mockComplete([llmResponse('answer')]) },
		)
		const outcome = await agent.runResumable('go')
		expect(outcome.status).toBe('complete')
		if (outcome.status === 'complete') {
			expect(outcome.result.message.content).toBe('answer')
		}
	})
})

describe('isAgentPauseSignal', () => {
	it('discriminates pause errors from other errors', () => {
		expect(isAgentPauseSignal(new AgentPauseSignal({ reason: 'x' }))).toBe(true)
		expect(isAgentPauseSignal(new Error('regular'))).toBe(false)
	})
})
