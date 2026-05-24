import type { CompletionRequest, ElsiumStream, LLMResponse } from '@elsium-ai/core'
import { ElsiumError, createStream } from '@elsium-ai/core'
import { describe, expect, it } from 'vitest'
import type { Gateway } from '../gateway'
import { createCascadeRouter } from './cascade'
import { createHeuristicClassifier, createLLMClassifier } from './classifier'
import { CascadeExhaustedError, type Tier } from './types'

function mockResponse(model: string, content = 'ok'): LLMResponse {
	return {
		id: `r_${model}`,
		message: { role: 'assistant', content },
		usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
		cost: { inputCost: 0.001, outputCost: 0.002, totalCost: 0.003, currency: 'USD' },
		model,
		provider: 'mock',
		stopReason: 'end_turn',
		latencyMs: 10,
		traceId: 't',
	}
}

function makeMockGateway(impl: (req: CompletionRequest) => Promise<LLMResponse>): Gateway {
	return {
		complete: impl,
		stream: () => createStream(async () => {}) as ElsiumStream,
		generateObject: async () => {
			throw new Error('not used')
		},
		generate: async () => {
			throw new Error('not used')
		},
		extract: async () => {
			throw new Error('not used')
		},
		provider: { name: 'mock' } as never,
		lastCall: () => null,
		callHistory: () => [],
	}
}

const TIERS: Tier[] = [
	{ name: 'haiku', provider: 'mock', model: 'haiku-1' },
	{ name: 'sonnet', provider: 'mock', model: 'sonnet-1' },
	{ name: 'opus', provider: 'mock', model: 'opus-1' },
]

describe('createHeuristicClassifier', () => {
	it('returns higher difficulty for reasoning/code keywords', async () => {
		const c = createHeuristicClassifier()
		const easy = await c.classify({ messages: [{ role: 'user', content: 'hi' }] })
		const hard = await c.classify({
			messages: [
				{ role: 'user', content: 'analyze and prove why this algorithm is optimal in O(n log n)' },
			],
		})
		expect(hard.difficulty).toBeGreaterThan(easy.difficulty)
		expect(hard.domain).toBe('code')
	})

	it('caps difficulty at 1', async () => {
		const c = createHeuristicClassifier()
		const r = await c.classify({
			messages: [
				{
					role: 'user',
					content:
						'prove derive analyze critique compute solve theorem equation matrix algorithm '.repeat(
							80,
						),
				},
			],
		})
		expect(r.difficulty).toBe(1)
	})

	it('classifies trivial requests near 0', async () => {
		const c = createHeuristicClassifier()
		const r = await c.classify({ messages: [{ role: 'user', content: 'hello' }] })
		expect(r.difficulty).toBe(0)
	})
})

describe('createLLMClassifier', () => {
	it('parses a JSON response from the model', async () => {
		const c = createLLMClassifier({
			complete: async () => mockResponse('classifier', '{"difficulty": 0.7, "domain": "code"}'),
		})
		const r = await c.classify({ messages: [{ role: 'user', content: 'refactor this' }] })
		expect(r.difficulty).toBe(0.7)
		expect(r.domain).toBe('code')
	})

	it('extracts JSON even when wrapped in extra text', async () => {
		const c = createLLMClassifier({
			complete: async () =>
				mockResponse('classifier', 'sure: {"difficulty": 0.4, "domain": "qa"} done'),
		})
		const r = await c.classify({ messages: [{ role: 'user', content: 'x' }] })
		expect(r.difficulty).toBe(0.4)
	})

	it('falls back to 0.5 with reason when parsing fails', async () => {
		const c = createLLMClassifier({
			complete: async () => mockResponse('classifier', 'I do not know'),
		})
		const r = await c.classify({ messages: [{ role: 'user', content: 'x' }] })
		expect(r.difficulty).toBe(0.5)
		expect(r.reason).toContain('failed to parse')
	})

	it('clamps out-of-range difficulty into [0, 1]', async () => {
		const c = createLLMClassifier({
			complete: async () => mockResponse('classifier', '{"difficulty": 2.5}'),
		})
		const r = await c.classify({ messages: [{ role: 'user', content: 'x' }] })
		expect(r.difficulty).toBe(1)
	})
})

describe('createCascadeRouter — happy path', () => {
	it('uses the first tier when it succeeds and does not escalate', async () => {
		const calls: string[] = []
		const router = createCascadeRouter(
			{ tiers: TIERS, escalateOnFailure: true },
			{
				makeGateway: (tier) =>
					makeMockGateway(async () => {
						calls.push(tier.name)
						return mockResponse(tier.model)
					}),
			},
		)
		const result = await router.complete({ messages: [{ role: 'user', content: 'x' }] })
		expect(result.tier).toBe('haiku')
		expect(calls).toEqual(['haiku'])
		expect(result.attempts).toHaveLength(1)
		expect(result.attempts[0].status).toBe('ok')
		expect(result.totalCost).toBe(0.003)
	})

	it('runs without escalation when escalateOnFailure is false', async () => {
		const router = createCascadeRouter(
			{ tiers: TIERS, escalateOnFailure: false },
			{
				makeGateway: () =>
					makeMockGateway(async () => {
						throw new ElsiumError({ code: 'PROVIDER_ERROR', message: 'boom', retryable: false })
					}),
			},
		)
		await expect(router.complete({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow(
			CascadeExhaustedError,
		)
	})
})

describe('createCascadeRouter — escalation on provider error', () => {
	it('escalates to next tier when the cheap one errors', async () => {
		let cheapCalled = false
		const router = createCascadeRouter(
			{ tiers: TIERS, escalateOnFailure: true },
			{
				makeGateway: (tier) =>
					makeMockGateway(async () => {
						if (tier.name === 'haiku') {
							cheapCalled = true
							throw new ElsiumError({
								code: 'PROVIDER_ERROR',
								message: 'cheap died',
								retryable: false,
							})
						}
						return mockResponse(tier.model)
					}),
			},
		)
		const result = await router.complete({ messages: [{ role: 'user', content: 'x' }] })
		expect(cheapCalled).toBe(true)
		expect(result.tier).toBe('sonnet')
		expect(result.attempts.map((a) => a.status)).toEqual(['failed', 'ok'])
	})

	it('respects maxEscalations', async () => {
		const router = createCascadeRouter(
			{
				tiers: TIERS,
				escalateOnFailure: { onProviderError: true, maxEscalations: 1 },
			},
			{
				makeGateway: () =>
					makeMockGateway(async () => {
						throw new ElsiumError({
							code: 'PROVIDER_ERROR',
							message: 'always fails',
							retryable: false,
						})
					}),
			},
		)
		try {
			await router.complete({ messages: [{ role: 'user', content: 'x' }] })
			throw new Error('expected cascade exhausted')
		} catch (err) {
			expect(err).toBeInstanceOf(CascadeExhaustedError)
			if (err instanceof CascadeExhaustedError) {
				expect(err.attempts).toHaveLength(2)
			}
		}
	})
})

describe('createCascadeRouter — validator escalation', () => {
	it('escalates when validator returns valid=false', async () => {
		const router = createCascadeRouter(
			{
				tiers: TIERS,
				escalateOnFailure: {
					validator: (response) => ({
						valid: response.model !== 'haiku-1',
						reason: 'too short',
					}),
				},
			},
			{ makeGateway: (tier) => makeMockGateway(async () => mockResponse(tier.model)) },
		)
		const result = await router.complete({ messages: [{ role: 'user', content: 'x' }] })
		expect(result.tier).toBe('sonnet')
		expect(result.attempts[0].status).toBe('validation-failed')
		expect(result.attempts[0].validatorReason).toBe('too short')
	})
})

describe('createCascadeRouter — confidence escalation', () => {
	it('escalates when confidence check reports below-threshold', async () => {
		const router = createCascadeRouter(
			{
				tiers: TIERS,
				escalateOnFailure: {
					confidence: (response) => ({
						ok: response.model !== 'haiku-1',
						confidence: response.model === 'haiku-1' ? 0.3 : 0.95,
					}),
				},
			},
			{ makeGateway: (tier) => makeMockGateway(async () => mockResponse(tier.model)) },
		)
		const result = await router.complete({ messages: [{ role: 'user', content: 'x' }] })
		expect(result.tier).toBe('sonnet')
		expect(result.attempts[0].status).toBe('low-confidence')
		expect(result.attempts[0].confidence).toBe(0.3)
		expect(result.attempts[1].confidence).toBe(0.95)
	})
})

describe('createCascadeRouter — classifier-based tier filtering', () => {
	it('skips tiers whose maxDifficulty is below the classified difficulty', async () => {
		const tieredCheap = [
			{ ...TIERS[0], maxDifficulty: 0.2 },
			{ ...TIERS[1], maxDifficulty: 0.6 },
			TIERS[2],
		]
		const calls: string[] = []
		const router = createCascadeRouter(
			{
				tiers: tieredCheap,
				classifier: { name: 'fixed', classify: () => ({ difficulty: 0.8, domain: 'reasoning' }) },
				escalateOnFailure: true,
			},
			{
				makeGateway: (tier) =>
					makeMockGateway(async () => {
						calls.push(tier.name)
						return mockResponse(tier.model)
					}),
			},
		)
		const result = await router.complete({ messages: [{ role: 'user', content: 'x' }] })
		expect(calls).toEqual(['opus'])
		expect(result.tier).toBe('opus')
		const skipped = result.attempts.filter((a) => a.status === 'skipped-by-classifier')
		expect(skipped.map((a) => a.tier).sort()).toEqual(['haiku', 'sonnet'])
		expect(result.classification?.difficulty).toBe(0.8)
		expect(result.classification?.domain).toBe('reasoning')
	})

	it('honors a custom LLM classifier', async () => {
		const router = createCascadeRouter(
			{
				tiers: [{ ...TIERS[0], maxDifficulty: 0.5 }, TIERS[2]],
				classifier: createLLMClassifier({
					complete: async () => mockResponse('classifier', '{"difficulty":0.9}'),
				}),
				escalateOnFailure: true,
			},
			{ makeGateway: (tier) => makeMockGateway(async () => mockResponse(tier.model)) },
		)
		const result = await router.complete({ messages: [{ role: 'user', content: 'x' }] })
		expect(result.tier).toBe('opus')
	})
})

describe('createCascadeRouter — audit + cost telemetry', () => {
	it('emits audit events for every tier attempt and escalation', async () => {
		const events: string[] = []
		const router = createCascadeRouter(
			{
				tiers: TIERS,
				escalateOnFailure: { onProviderError: true },
				onAudit: (e) => events.push(`${e.type}:${e.tier}`),
			},
			{
				makeGateway: (tier) =>
					makeMockGateway(async () => {
						if (tier.name === 'haiku') {
							throw new ElsiumError({ code: 'PROVIDER_ERROR', message: 'boom', retryable: false })
						}
						return mockResponse(tier.model)
					}),
			},
		)
		await router.complete({ messages: [{ role: 'user', content: 'x' }] })
		expect(events).toContain('tier-attempt:haiku')
		expect(events).toContain('tier-escalation:haiku')
		expect(events).toContain('tier-attempt:sonnet')
		expect(events).toContain('cascade-success:sonnet')
	})

	it('accumulates cost across all tier attempts', async () => {
		const router = createCascadeRouter(
			{ tiers: TIERS, escalateOnFailure: true },
			{
				makeGateway: (tier) =>
					makeMockGateway(async () => {
						if (tier.name !== 'opus') {
							throw new ElsiumError({ code: 'PROVIDER_ERROR', message: 'x', retryable: false })
						}
						return mockResponse(tier.model)
					}),
			},
		)
		const result = await router.complete({ messages: [{ role: 'user', content: 'x' }] })
		expect(result.attempts).toHaveLength(3)
		expect(result.totalCost).toBe(0.003)
	})
})

describe('createCascadeRouter — config validation', () => {
	it('rejects empty tiers list', () => {
		expect(() =>
			createCascadeRouter(
				{ tiers: [] },
				{ makeGateway: () => makeMockGateway(async () => mockResponse('x')) },
			),
		).toThrow(/at least one tier/)
	})

	it('default makeGateway requires an apiKey for each provider', () => {
		expect(() => createCascadeRouter({ tiers: TIERS }, {})).toThrow(/missing apiKey/)
	})
})
