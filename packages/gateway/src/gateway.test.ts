import type { CompletionRequest, LLMResponse, Middleware, MiddlewareContext } from '@elsium-ai/core'
import { type ElsiumStream, createStream } from '@elsium-ai/core'
import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
	calculateCost,
	composeMiddleware,
	costTrackingMiddleware,
	gateway,
	getProviderFactory,
	listProviders,
	registerPricing,
	registerProvider,
	registerProviderFactory,
} from './index'
import type { LLMProvider } from './provider'

// ─── Mock Provider ───────────────────────────────────────────────

function createMockProvider(responses: Partial<LLMResponse>[] = []): LLMProvider {
	let callIndex = 0

	return {
		name: 'mock',
		defaultModel: 'mock-model',
		async complete(req: CompletionRequest): Promise<LLMResponse> {
			const resp = responses[callIndex] ?? {}
			callIndex++
			return {
				id: `msg_${callIndex}`,
				message: { role: 'assistant', content: 'Hello from mock' },
				usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
				cost: { inputCost: 0, outputCost: 0, totalCost: 0, currency: 'USD' },
				model: req.model ?? 'mock-model',
				provider: 'mock',
				stopReason: 'end_turn',
				latencyMs: 50,
				traceId: 'trc_test',
				...resp,
			}
		},
		stream(req: CompletionRequest): ElsiumStream {
			return createStream(async (emit) => {
				emit({ type: 'message_start', id: 'msg_1', model: 'mock-model' })
				emit({ type: 'text_delta', text: 'Hello' })
				emit({
					type: 'message_end',
					usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
					stopReason: 'end_turn',
				})
			})
		},
		async listModels(): Promise<string[]> {
			return ['mock-model']
		},
	}
}

// ─── Pricing ─────────────────────────────────────────────────────

describe('calculateCost', () => {
	it('calculates cost for known models', () => {
		const cost = calculateCost('claude-sonnet-4-6', {
			inputTokens: 1000,
			outputTokens: 500,
			totalTokens: 1500,
		})

		expect(cost.inputCost).toBeCloseTo(0.003, 5)
		expect(cost.outputCost).toBeCloseTo(0.0075, 5)
		expect(cost.totalCost).toBeCloseTo(0.0105, 5)
		expect(cost.currency).toBe('USD')
	})

	it('returns zero cost for unknown models', () => {
		const cost = calculateCost('unknown-model', {
			inputTokens: 1000,
			outputTokens: 500,
			totalTokens: 1500,
		})

		expect(cost.totalCost).toBe(0)
	})
})

// ─── Middleware ───────────────────────────────────────────────────

describe('composeMiddleware', () => {
	it('executes middleware in order', async () => {
		const order: string[] = []

		const mw1: Middleware = async (ctx, next) => {
			order.push('mw1-before')
			const result = await next(ctx)
			order.push('mw1-after')
			return result
		}

		const mw2: Middleware = async (ctx, next) => {
			order.push('mw2-before')
			const result = await next(ctx)
			order.push('mw2-after')
			return result
		}

		const composed = composeMiddleware([mw1, mw2])
		const mockResponse: LLMResponse = {
			id: 'test',
			message: { role: 'assistant', content: 'test' },
			usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
			cost: { inputCost: 0, outputCost: 0, totalCost: 0, currency: 'USD' },
			model: 'test',
			provider: 'test',
			stopReason: 'end_turn',
			latencyMs: 0,
			traceId: 'test',
		}

		const ctx: MiddlewareContext = {
			request: { messages: [] },
			provider: 'test',
			model: 'test',
			traceId: 'test',
			startTime: 0,
			metadata: {},
		}

		await composed(ctx, async () => {
			order.push('handler')
			return mockResponse
		})

		expect(order).toEqual(['mw1-before', 'mw2-before', 'handler', 'mw2-after', 'mw1-after'])
	})
})

describe('costTrackingMiddleware', () => {
	it('tracks cost across calls', async () => {
		const tracker = costTrackingMiddleware()

		const response: LLMResponse = {
			id: 'test',
			message: { role: 'assistant', content: 'test' },
			usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
			cost: { inputCost: 0.001, outputCost: 0.002, totalCost: 0.003, currency: 'USD' },
			model: 'test',
			provider: 'test',
			stopReason: 'end_turn',
			latencyMs: 100,
			traceId: 'test',
		}

		const ctx: MiddlewareContext = {
			request: { messages: [] },
			provider: 'test',
			model: 'test',
			traceId: 'test',
			startTime: 0,
			metadata: {},
		}

		await tracker(ctx, async () => response)
		await tracker(ctx, async () => response)

		expect(tracker.getTotalCost()).toBeCloseTo(0.006, 5)
		expect(tracker.getTotalTokens()).toBe(300)
		expect(tracker.getCallCount()).toBe(2)

		tracker.reset()
		expect(tracker.getTotalCost()).toBe(0)
	})
})

// ─── Gateway ─────────────────────────────────────────────────────

describe('gateway', () => {
	beforeEach(() => {
		registerProviderFactory('mock', () => createMockProvider())
	})

	it('throws on unknown provider', () => {
		expect(() => gateway({ provider: 'nonexistent', apiKey: 'key' })).toThrow('Unknown provider')
	})

	it('completes a request with mock provider', async () => {
		const mockProvider = createMockProvider([{ message: { role: 'assistant', content: 'Hello!' } }])
		registerProviderFactory('mock', () => mockProvider)

		const gw = gateway({ provider: 'mock', apiKey: 'test-key' })
		const response = await gw.complete({
			messages: [{ role: 'user', content: 'Hi' }],
		})

		expect(response.message.content).toBe('Hello!')
		expect(response.provider).toBe('mock')
	})

	it('streams text from mock provider', async () => {
		const mockProvider = createMockProvider()
		registerProviderFactory('mock', () => mockProvider)

		const gw = gateway({ provider: 'mock', apiKey: 'test-key' })
		const stream = gw.stream({
			messages: [{ role: 'user', content: 'Hi' }],
		})

		const text = await stream.toText()
		expect(text).toBe('Hello')
	})

	it('generates structured output', async () => {
		const mockProvider = createMockProvider([
			{
				message: {
					role: 'assistant',
					content: '{"name": "John", "age": 30}',
				},
			},
		])
		registerProviderFactory('mock', () => mockProvider)

		const gw = gateway({ provider: 'mock', apiKey: 'test-key' })
		const schema = z.object({
			name: z.string(),
			age: z.number(),
		})

		const result = await gw.generate({
			messages: [{ role: 'user', content: 'Get person info' }],
			schema,
		})

		expect(result.data.name).toBe('John')
		expect(result.data.age).toBe(30)
	})

	it('throws validation error on bad structured output', async () => {
		const mockProvider = createMockProvider([
			{
				message: {
					role: 'assistant',
					content: 'This is not JSON at all',
				},
			},
		])
		registerProviderFactory('mock', () => mockProvider)

		const gw = gateway({ provider: 'mock', apiKey: 'test-key' })
		const schema = z.object({ name: z.string() })

		await expect(
			gw.generate({
				messages: [{ role: 'user', content: 'Get info' }],
				schema,
			}),
		).rejects.toThrow('did not contain valid JSON')
	})

	it('applies middleware', async () => {
		const mockProvider = createMockProvider([
			{
				cost: { inputCost: 0.01, outputCost: 0.02, totalCost: 0.03, currency: 'USD' },
			},
		])
		registerProviderFactory('mock', () => mockProvider)

		const tracker = costTrackingMiddleware()
		const gw = gateway({
			provider: 'mock',
			apiKey: 'test-key',
			middleware: [tracker],
		})

		await gw.complete({ messages: [{ role: 'user', content: 'Hi' }] })

		expect(tracker.getTotalCost()).toBeCloseTo(0.03, 5)
		expect(tracker.getCallCount()).toBe(1)
	})
})

// ─── Provider Registry ───────────────────────────────────────────

describe('registerProvider / getProviderFactory / listProviders', () => {
	it('registers and retrieves a provider factory', () => {
		const factory = () => createMockProvider()
		registerProvider('test-provider', factory)

		const retrieved = getProviderFactory('test-provider')
		expect(retrieved).toBe(factory)
	})

	it('returns undefined for unregistered provider', () => {
		const retrieved = getProviderFactory('nonexistent-provider-xyz')
		expect(retrieved).toBeUndefined()
	})

	it('lists all registered providers', () => {
		registerProvider('list-test-a', () => createMockProvider())
		registerProvider('list-test-b', () => createMockProvider())

		const providers = listProviders()
		expect(providers).toContain('list-test-a')
		expect(providers).toContain('list-test-b')
	})
})

// ─── costTrackingMiddleware (detailed) ───────────────────────────

describe('costTrackingMiddleware (methods)', () => {
	it('getTotalCost returns 0 initially', () => {
		const tracker = costTrackingMiddleware()
		expect(tracker.getTotalCost()).toBe(0)
	})

	it('getTotalTokens returns 0 initially', () => {
		const tracker = costTrackingMiddleware()
		expect(tracker.getTotalTokens()).toBe(0)
	})

	it('getCallCount returns 0 initially', () => {
		const tracker = costTrackingMiddleware()
		expect(tracker.getCallCount()).toBe(0)
	})

	it('accumulates cost, tokens, and call count', async () => {
		const tracker = costTrackingMiddleware()

		const response1: LLMResponse = {
			id: 'r1',
			message: { role: 'assistant', content: 'test' },
			usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
			cost: { inputCost: 0.001, outputCost: 0.002, totalCost: 0.003, currency: 'USD' },
			model: 'test',
			provider: 'test',
			stopReason: 'end_turn',
			latencyMs: 50,
			traceId: 'trc_1',
		}

		const response2: LLMResponse = {
			...response1,
			id: 'r2',
			usage: { inputTokens: 200, outputTokens: 100, totalTokens: 300 },
			cost: { inputCost: 0.002, outputCost: 0.004, totalCost: 0.006, currency: 'USD' },
		}

		const ctx: MiddlewareContext = {
			request: { messages: [] },
			provider: 'test',
			model: 'test',
			traceId: 'test',
			startTime: 0,
			metadata: {},
		}

		await tracker(ctx, async () => response1)
		await tracker(ctx, async () => response2)

		expect(tracker.getTotalCost()).toBeCloseTo(0.009, 5)
		expect(tracker.getTotalTokens()).toBe(450)
		expect(tracker.getCallCount()).toBe(2)
	})

	it('reset clears all tracked values', async () => {
		const tracker = costTrackingMiddleware()

		const response: LLMResponse = {
			id: 'r1',
			message: { role: 'assistant', content: 'test' },
			usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
			cost: { inputCost: 0.001, outputCost: 0.002, totalCost: 0.003, currency: 'USD' },
			model: 'test',
			provider: 'test',
			stopReason: 'end_turn',
			latencyMs: 50,
			traceId: 'trc_1',
		}

		const ctx: MiddlewareContext = {
			request: { messages: [] },
			provider: 'test',
			model: 'test',
			traceId: 'test',
			startTime: 0,
			metadata: {},
		}

		await tracker(ctx, async () => response)
		expect(tracker.getCallCount()).toBe(1)

		tracker.reset()
		expect(tracker.getTotalCost()).toBe(0)
		expect(tracker.getTotalTokens()).toBe(0)
		expect(tracker.getCallCount()).toBe(0)
	})
})

// ─── registerPricing ─────────────────────────────────────────────

describe('registerPricing', () => {
	it('registers custom model pricing and uses it for cost calculation', () => {
		registerPricing('my-custom-model', {
			inputPerMillion: 10,
			outputPerMillion: 20,
		})

		const cost = calculateCost('my-custom-model', {
			inputTokens: 1_000_000,
			outputTokens: 500_000,
			totalTokens: 1_500_000,
		})

		expect(cost.inputCost).toBeCloseTo(10, 2)
		expect(cost.outputCost).toBeCloseTo(10, 2)
		expect(cost.totalCost).toBeCloseTo(20, 2)
		expect(cost.currency).toBe('USD')
	})

	it('overrides existing model pricing', () => {
		registerPricing('override-test-model', {
			inputPerMillion: 5,
			outputPerMillion: 10,
		})

		// Override with new pricing
		registerPricing('override-test-model', {
			inputPerMillion: 1,
			outputPerMillion: 2,
		})

		const cost = calculateCost('override-test-model', {
			inputTokens: 1_000_000,
			outputTokens: 1_000_000,
			totalTokens: 2_000_000,
		})

		expect(cost.inputCost).toBeCloseTo(1, 2)
		expect(cost.outputCost).toBeCloseTo(2, 2)
	})
})

describe('loggingMiddleware', () => {
	it('logs request and response when composed', async () => {
		const { loggingMiddleware } = await import('./middleware')
		const { createLogger } = await import('@elsium-ai/core')

		const logs: unknown[] = []
		const logger = createLogger({ level: 'debug' })
		// Override info to capture
		const origLog = console.log
		console.log = (...args: unknown[]) => logs.push(args)

		const logging = loggingMiddleware()
		const mockNext = async (_ctx: MiddlewareContext) => ({
			id: 'test',
			message: { role: 'assistant', content: 'Hi' },
			usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
			cost: { inputCost: 0.001, outputCost: 0.002, totalCost: 0.003, currency: 'USD' },
			model: 'test',
			provider: 'test',
			stopReason: 'end_turn',
			latencyMs: 50,
			traceId: 'trc_test',
		})

		const result = await logging(
			{
				provider: 'test',
				model: 'test-model',
				traceId: 'trc_123',
				request: { messages: [{ role: 'user', content: 'Hi' }] },
				startTime: Date.now(),
			} as MiddlewareContext,
			mockNext,
		)

		console.log = origLog
		expect(result.message.content).toBe('Hi')
		expect(logs.length).toBeGreaterThanOrEqual(2) // request + response log
	})

	it('costTrackingMiddleware accumulates when called as middleware', async () => {
		const tracker = costTrackingMiddleware()
		const mockNext = async () => ({
			id: 'test',
			message: { role: 'assistant', content: 'Hi' },
			usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
			cost: { inputCost: 0.001, outputCost: 0.002, totalCost: 0.003, currency: 'USD' },
			model: 'test',
			provider: 'test',
			stopReason: 'end_turn',
			latencyMs: 50,
			traceId: 'trc_test',
		})

		await tracker(
			{
				provider: 'test',
				model: 'test',
				traceId: 'trc_1',
				request: { messages: [] },
				startTime: Date.now(),
			} as MiddlewareContext,
			mockNext,
		)
		await tracker(
			{
				provider: 'test',
				model: 'test',
				traceId: 'trc_2',
				request: { messages: [] },
				startTime: Date.now(),
			} as MiddlewareContext,
			mockNext,
		)

		expect(tracker.getTotalCost()).toBeCloseTo(0.006, 4)
		expect(tracker.getTotalTokens()).toBe(300)
		expect(tracker.getCallCount()).toBe(2)

		tracker.reset()
		expect(tracker.getTotalCost()).toBe(0)
	})
})
