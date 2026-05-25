import type { CompletionRequest, LLMResponse } from '@elsium-ai/core'
import { describe, expect, it, vi } from 'vitest'
import type { AgentDependencies } from './agent'
import { defineAgent } from './agent'
import type { AgentResult } from './types'
import type { Validator } from './verification/types'

function mockResponse(text: string, overrides: Partial<LLMResponse> = {}): LLMResponse {
	return {
		id: 'msg_1',
		message: { role: 'assistant', content: text },
		usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
		cost: { inputCost: 0, outputCost: 0, totalCost: 0, currency: 'USD' },
		model: 'mock',
		provider: 'mock',
		stopReason: 'end_turn',
		latencyMs: 1,
		traceId: 'trc_test',
		...overrides,
	}
}

function makeDeps(texts: string[]): AgentDependencies {
	let i = 0
	return {
		async complete(_: CompletionRequest): Promise<LLMResponse> {
			const t = texts[Math.min(i, texts.length - 1)]
			i++
			return mockResponse(t)
		},
	}
}

const lengthValidator: Validator<AgentResult> = {
	name: 'min-length',
	validate(result) {
		const text = typeof result.message.content === 'string' ? result.message.content : ''
		if (text.length >= 20) return { valid: true, failures: [] }
		return {
			valid: false,
			failures: [
				{
					validator: 'min-length',
					reason: `text was ${text.length} chars, need ≥ 20`,
					repairHint: 'provide a longer answer (≥ 20 chars)',
				},
			],
		}
	},
}

describe('fluent verification API', () => {
	it('passes through when no verifiers attached', async () => {
		const agent = defineAgent(
			{ name: 'plain', system: 's', model: 'm' },
			makeDeps(['short answer']),
		)
		const result = await agent.run('hello')
		expect(result.message.content).toBe('short answer')
	})

	it('retries on verification failure and repairs', async () => {
		const agent = defineAgent(
			{ name: 'repaired', system: 's', model: 'm' },
			makeDeps(['too short', 'a long enough answer here']),
		).withVerifier(lengthValidator)
		const result = await agent.run('please answer')
		expect(result.message.content).toBe('a long enough answer here')
	})

	it('aborts after maxAttempts when verifiers keep failing', async () => {
		const agent = defineAgent(
			{ name: 'never', system: 's', model: 'm' },
			makeDeps(['short', 'short', 'short', 'short', 'short']),
		)
			.withVerifier(lengthValidator)
			.withRetryPolicy({ maxAttempts: 2 })
		await expect(agent.run('please')).rejects.toThrow(/verification failed/i)
	})

	it('chains multiple verifiers — all must pass', async () => {
		const containsDot: Validator<AgentResult> = {
			name: 'contains-dot',
			validate(result) {
				const text = typeof result.message.content === 'string' ? result.message.content : ''
				return text.includes('.')
					? { valid: true, failures: [] }
					: { valid: false, failures: [{ validator: 'contains-dot', reason: 'no period' }] }
			},
		}
		const agent = defineAgent(
			{ name: 'two', system: 's', model: 'm' },
			makeDeps(['too short', 'a long answer without dot', 'a long answer with a dot.']),
		)
			.withVerifier(lengthValidator)
			.withVerifier(containsDot)
		const result = await agent.run('please')
		expect(result.message.content).toBe('a long answer with a dot.')
	})
})

describe('agent.replayFrom / getTrace', () => {
	it('records a trace per run accessible by traceId', async () => {
		const agent = defineAgent({ name: 't', system: 's', model: 'm' }, makeDeps(['hi there']))
		const result = await agent.run('hello')
		const trace = agent.getTrace(result.traceId)
		expect(trace).toBeDefined()
		expect(trace?.steps[0].key).toBe('llm:iter_1')
	})

	it('listTraces returns recent runs', async () => {
		const agent = defineAgent({ name: 't', system: 's', model: 'm' }, makeDeps(['a', 'b']))
		await agent.run('1')
		await agent.run('2')
		expect(agent.listTraces().length).toBe(2)
	})

	it('replayFrom returns recorded outputs for replayed steps and live for from-step onwards', async () => {
		const completeSpy = vi.fn().mockResolvedValueOnce(mockResponse('original'))
		const agent = defineAgent({ name: 't', system: 's', model: 'm' }, { complete: completeSpy })
		const result = await agent.run('go')
		completeSpy.mockResolvedValueOnce(mockResponse('replayed-live'))

		const replay = await agent.replayFrom(result.traceId, { fromStep: 0 })
		expect(replay.steps).toHaveLength(1)
		expect(replay.steps[0].source).toBe('live')
	})

	it('throws when traceId is unknown', async () => {
		const agent = defineAgent({ name: 't', system: 's', model: 'm' }, makeDeps(['x']))
		await expect(agent.replayFrom('bogus', { fromStep: 0 })).rejects.toThrow(/no trace recorded/)
	})
})
