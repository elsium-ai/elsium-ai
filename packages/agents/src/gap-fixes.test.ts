import type { CompletionRequest, LLMResponse } from '@elsium-ai/core'
import { defineTool } from '@elsium-ai/tools'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { AgentDependencies } from './agent'
import { defineAgent } from './agent'
import { createInMemoryAskHumanStore, resolveAskHuman } from './ask-human'
import type { AgentStreamEvent } from './streaming'
import { judgeValidator, schemaValidator, zodValidator } from './verification/adapters'

function mockResponse(text: string, overrides: Partial<LLMResponse> = {}): LLMResponse {
	return {
		id: 'msg',
		message: { role: 'assistant', content: text },
		usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
		cost: { inputCost: 0, outputCost: 0, totalCost: 0, currency: 'USD' },
		model: 'mock',
		provider: 'mock',
		stopReason: 'end_turn',
		latencyMs: 1,
		traceId: 'trc',
		...overrides,
	}
}

function makeDeps(texts: string[]): AgentDependencies {
	let i = 0
	return {
		async complete(_: CompletionRequest) {
			const t = texts[Math.min(i, texts.length - 1)]
			i++
			return mockResponse(t)
		},
	}
}

// ─── Gap 1: schemaValidator alias ────────────────────────────────

describe('schemaValidator alias', () => {
	it('is the same function as zodValidator', () => {
		expect(schemaValidator).toBe(zodValidator)
	})

	it('works identically to zodValidator', async () => {
		const schema = z.object({ a: z.number() })
		const v = schemaValidator(schema)
		const out = await v.validate({ a: 1 }, { attempt: 0, previousFailures: [] })
		expect(out.valid).toBe(true)
	})
})

// ─── Gap 2: judgeValidator ────────────────────────────────────────

describe('judgeValidator', () => {
	it('passes when judge approves above threshold', async () => {
		const v = judgeValidator({
			rubric: 'Answer must be professional and concise',
			judge: async () => ({ passed: true, score: 0.9 }),
			threshold: 0.5,
		})
		const out = await v.validate('the answer', { attempt: 0, previousFailures: [] })
		expect(out.valid).toBe(true)
	})

	it('fails when judge score is below threshold', async () => {
		const v = judgeValidator({
			rubric: 'Must include citations',
			judge: async () => ({ passed: false, score: 0.2, reason: 'no citations found' }),
			threshold: 0.7,
		})
		const out = await v.validate('answer', { attempt: 0, previousFailures: [] })
		expect(out.valid).toBe(false)
		expect(out.failures[0].reason).toBe('no citations found')
		expect(out.failures[0].detail).toEqual({
			score: 0.2,
			rubric: 'Must include citations',
		})
	})

	it('respects custom threshold', async () => {
		const v = judgeValidator({
			rubric: 'r',
			judge: async () => ({ passed: true, score: 0.6 }),
			threshold: 0.8,
		})
		const out = await v.validate('x', { attempt: 0, previousFailures: [] })
		expect(out.valid).toBe(false)
	})
})

// ─── Gap 3: Stream event aliases ─────────────────────────────────

describe('stream event aliases (spec compliance)', () => {
	it('emits "token" alongside "text_delta"', async () => {
		const deps = makeDeps(['hello'])
		const streamingDeps = {
			...deps,
			stream: async function* () {
				yield { type: 'message_start' as const, id: 'm', model: 'mock' }
				yield { type: 'text_delta' as const, text: 'hello' }
				yield {
					type: 'message_end' as const,
					usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
					stopReason: 'end_turn' as const,
				}
			},
		}
		const agent = defineAgent({ name: 'a', system: 's', model: 'm' }, streamingDeps)
		const events: AgentStreamEvent[] = []
		for await (const e of agent.stream('hi')) events.push(e)
		expect(events.some((e) => e.type === 'text_delta')).toBe(true)
		expect(events.some((e) => e.type === 'token')).toBe(true)
		expect(events.some((e) => e.type === 'final')).toBe(true)
		expect(events.some((e) => e.type === 'agent_end')).toBe(true)
	})

	it('emits "tool_call" event with parsed arguments after tool_call_end', async () => {
		const streamingDeps = {
			complete: async (_: CompletionRequest) => mockResponse('done'),
			stream: async function* () {
				yield { type: 'message_start' as const, id: 'm', model: 'mock' }
				yield {
					type: 'tool_call_start' as const,
					toolCall: { id: 'tc1', name: 'get_weather' },
				}
				yield {
					type: 'tool_call_delta' as const,
					toolCallId: 'tc1',
					arguments: '{"city":"Lisbon"}',
				}
				yield { type: 'tool_call_end' as const, toolCallId: 'tc1' }
				yield {
					type: 'message_end' as const,
					usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
					stopReason: 'end_turn' as const,
				}
			},
		}
		const agent = defineAgent(
			{
				name: 'a',
				system: '',
				model: 'm',
				tools: [
					defineTool({
						name: 'get_weather',
						description: '',
						input: z.object({ city: z.string() }),
						handler: async (i) => ({ temp: 22, city: i.city }),
					}),
				],
			},
			streamingDeps,
		)
		const events: AgentStreamEvent[] = []
		for await (const e of agent.stream('hi')) events.push(e)
		const tc = events.find((e) => e.type === 'tool_call')
		expect(tc).toBeDefined()
		if (tc && tc.type === 'tool_call') {
			expect(tc.toolCall.name).toBe('get_weather')
			expect(tc.toolCall.arguments).toEqual({ city: 'Lisbon' })
		}
	})
})

// ─── Gap 4: Bare-function preconditions ──────────────────────────

describe('bare-function preconditions', () => {
	it('accepts bare functions and auto-names them', async () => {
		const balanceCheck = async () => ({ ok: false, reason: 'insufficient funds' })
		const tool = defineTool({
			name: 'transfer',
			description: '',
			input: z.object({ amount: z.number() }),
			preconditions: [balanceCheck],
			handler: async () => ({ done: true }),
		})
		const result = await tool.execute({ amount: 100 })
		expect(result.success).toBe(false)
		expect(result.preconditionFailures?.[0].name).toBe('balanceCheck')
		expect(result.preconditionFailures?.[0].reason).toBe('insufficient funds')
	})

	it('accepts mixed bare + named preconditions', async () => {
		const authed = async () => ({ ok: true })
		const tool = defineTool({
			name: 'transfer',
			description: '',
			input: z.object({ amount: z.number() }),
			preconditions: [
				authed,
				{
					name: 'over-limit',
					check: async (i: { amount: number }) =>
						i.amount > 1000 ? { ok: false, reason: 'over 1000' } : { ok: true },
				},
			],
			handler: async () => ({ done: true }),
		})
		const denied = await tool.execute({ amount: 5000 })
		expect(denied.success).toBe(false)
		expect(denied.preconditionFailures?.[0].name).toBe('over-limit')

		const ok = await tool.execute({ amount: 50 })
		expect(ok.success).toBe(true)
	})

	it('auto-names anonymous fns as precondition_N', async () => {
		const tool = defineTool({
			name: 'x',
			description: '',
			input: z.object({}),
			preconditions: [async () => ({ ok: false, reason: 'denied' })],
			handler: async () => ({}),
		})
		const r = await tool.execute({})
		expect(r.preconditionFailures?.[0].name).toMatch(/^precondition_1$/)
	})
})

// ─── Gap 5: agent.askHuman({ timeout: '24h' }) ───────────────────

describe('agent.askHuman method', () => {
	it('resolves via responder', async () => {
		const agent = defineAgent({ name: 'a', system: 's', model: 'm' }, makeDeps(['x']))
		const decision = await agent.askHuman({
			question: 'Approve?',
			options: ['yes', 'no'] as const,
			responder: async () => ({
				status: 'approved',
				option: 'yes',
				decidedAt: Date.now(),
			}),
		})
		expect(decision.status).toBe('approved')
		expect(decision.option).toBe('yes')
	})

	it('parses "24h" duration via timeout shorthand', async () => {
		const agent = defineAgent({ name: 'a', system: 's', model: 'm' }, makeDeps(['x']))
		const store = createInMemoryAskHumanStore()
		const promise = agent.askHuman({
			requestId: 'req-tx',
			question: 'q',
			options: ['a', 'b'] as const,
			store,
			timeout: '24h',
		})
		// Resolve out-of-band
		await new Promise((r) => setTimeout(r, 10))
		await resolveAskHuman(store, 'req-tx', { status: 'approved', option: 'a' })
		const decision = await promise
		expect(decision.status).toBe('approved')
	})
})

// ─── Gap 6: replay overrides { prompt } shorthand ────────────────

describe('replayFrom overrides { prompt } shorthand', () => {
	it('translates { prompt } to a transform that swaps request.system', async () => {
		const completeSpy = vi.fn().mockResolvedValue(mockResponse('original'))
		const agent = defineAgent({ name: 'a', system: 'orig', model: 'm' }, { complete: completeSpy })
		const result = await agent.run('go')

		completeSpy.mockResolvedValueOnce(mockResponse('with-new-prompt'))
		await agent.replayFrom(result.traceId, {
			fromStep: 0,
			overrides: {
				'llm:iter_1': { prompt: 'be terse' },
			},
		})

		const lastCall = completeSpy.mock.calls.at(-1)?.[0] as CompletionRequest
		expect(lastCall.system).toBe('be terse')
	})
})
