import type {
	LLMResponse,
	Middleware,
	MiddlewareContext,
	StreamEvent,
	StreamMiddleware,
} from '@elsium-ai/core'
import { describe, expect, it, vi } from 'vitest'
import {
	composeMiddleware,
	composeStreamMiddleware,
	costTrackingMiddleware,
	loggingMiddleware,
} from './middleware'

// ─── Helpers ─────────────────────────────────────────────────────

function createMockContext(overrides: Partial<MiddlewareContext> = {}): MiddlewareContext {
	return {
		request: {
			messages: [{ role: 'user', content: 'Hello' }],
		},
		provider: 'anthropic',
		model: 'claude-sonnet-4-6',
		traceId: 'trc_test123',
		startTime: performance.now(),
		metadata: {},
		...overrides,
	}
}

function createMockResponse(overrides: Partial<LLMResponse> = {}): LLMResponse {
	return {
		id: 'msg_123',
		message: { role: 'assistant', content: 'Hello!' },
		usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
		cost: { inputCost: 0.0003, outputCost: 0.00075, totalCost: 0.00105, currency: 'USD' },
		model: 'claude-sonnet-4-6',
		provider: 'anthropic',
		stopReason: 'end_turn',
		latencyMs: 100,
		traceId: 'trc_test123',
		...overrides,
	}
}

async function* makeAsyncIterable(events: StreamEvent[]): AsyncIterable<StreamEvent> {
	for (const event of events) {
		yield event
	}
}

async function collectStream(source: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
	const events: StreamEvent[] = []
	for await (const event of source) {
		events.push(event)
	}
	return events
}

// ─── composeMiddleware ────────────────────────────────────────────

describe('composeMiddleware', () => {
	it('executes a single middleware and calls next', async () => {
		const order: string[] = []
		const mw: Middleware = async (ctx, next) => {
			order.push('before')
			const result = await next(ctx)
			order.push('after')
			return result
		}

		const composed = composeMiddleware([mw])
		const mockResponse = createMockResponse()
		const ctx = createMockContext()

		await composed(ctx, async () => {
			order.push('handler')
			return mockResponse
		})

		expect(order).toEqual(['before', 'handler', 'after'])
	})

	it('executes multiple middlewares in onion order', async () => {
		const order: string[] = []

		const mw1: Middleware = async (ctx, next) => {
			order.push('mw1-pre')
			const result = await next(ctx)
			order.push('mw1-post')
			return result
		}

		const mw2: Middleware = async (ctx, next) => {
			order.push('mw2-pre')
			const result = await next(ctx)
			order.push('mw2-post')
			return result
		}

		const mw3: Middleware = async (ctx, next) => {
			order.push('mw3-pre')
			const result = await next(ctx)
			order.push('mw3-post')
			return result
		}

		const composed = composeMiddleware([mw1, mw2, mw3])
		const mockResponse = createMockResponse()
		const ctx = createMockContext()

		await composed(ctx, async () => {
			order.push('handler')
			return mockResponse
		})

		expect(order).toEqual([
			'mw1-pre',
			'mw2-pre',
			'mw3-pre',
			'handler',
			'mw3-post',
			'mw2-post',
			'mw1-post',
		])
	})

	it('passes the context through to the handler', async () => {
		let capturedCtx: MiddlewareContext | null = null
		const mw: Middleware = async (ctx, next) => next(ctx)

		const composed = composeMiddleware([mw])
		const ctx = createMockContext({ traceId: 'trc_custom' })

		await composed(ctx, async (receivedCtx) => {
			capturedCtx = receivedCtx
			return createMockResponse()
		})

		expect(capturedCtx?.traceId).toBe('trc_custom')
	})

	it('returns the response from the final handler', async () => {
		const mw: Middleware = async (ctx, next) => next(ctx)
		const composed = composeMiddleware([mw])
		const expected = createMockResponse({ id: 'msg_unique' })
		const ctx = createMockContext()

		const result = await composed(ctx, async () => expected)

		expect(result.id).toBe('msg_unique')
	})

	it('works with an empty middleware array and calls final handler', async () => {
		const composed = composeMiddleware([])
		const expected = createMockResponse()
		const ctx = createMockContext()

		const result = await composed(ctx, async () => expected)

		expect(result).toBe(expected)
	})

	it('throws if next() is called twice in the same middleware', async () => {
		const doubleNext: Middleware = async (ctx, next) => {
			await next(ctx)
			return next(ctx) // second call — should throw
		}

		const composed = composeMiddleware([doubleNext])
		const ctx = createMockContext()

		await expect(composed(ctx, async () => createMockResponse())).rejects.toThrow(
			'Middleware next() called multiple times',
		)
	})

	it('allows middleware to modify the response before returning', async () => {
		const mw: Middleware = async (ctx, next) => {
			const response = await next(ctx)
			return { ...response, latencyMs: 9999 }
		}

		const composed = composeMiddleware([mw])
		const ctx = createMockContext()

		const result = await composed(ctx, async () => createMockResponse({ latencyMs: 1 }))

		expect(result.latencyMs).toBe(9999)
	})
})

// ─── composeStreamMiddleware ──────────────────────────────────────

describe('composeStreamMiddleware', () => {
	it('passes stream events through with no middlewares', async () => {
		const events: StreamEvent[] = [
			{ type: 'message_start', id: 'msg_1', model: 'claude-sonnet-4-6' },
			{ type: 'text_delta', text: 'Hello' },
			{
				type: 'message_end',
				usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
				stopReason: 'end_turn',
			},
		]

		const composed = composeStreamMiddleware([])
		const ctx = createMockContext()
		const source = makeAsyncIterable(events)

		const result = composed(ctx, source, (_c, s) => s)
		const collected = await collectStream(result)

		expect(collected).toEqual(events)
	})

	it('passes stream events through a single middleware', async () => {
		const events: StreamEvent[] = [
			{ type: 'text_delta', text: 'Hello' },
			{ type: 'text_delta', text: ' World' },
		]

		const seen: StreamEvent[] = []
		const mw: StreamMiddleware = async function* (ctx, source, next) {
			for await (const event of next(ctx, source)) {
				seen.push(event)
				yield event
			}
		}

		const composed = composeStreamMiddleware([mw])
		const ctx = createMockContext()
		const source = makeAsyncIterable(events)

		const result = composed(ctx, source, (_c, s) => s)
		await collectStream(result)

		expect(seen).toEqual(events)
	})

	it('chains multiple stream middlewares in order', async () => {
		const order: string[] = []

		const mw1: StreamMiddleware = async function* (ctx, source, next) {
			order.push('mw1-start')
			for await (const event of next(ctx, source)) {
				order.push('mw1-event')
				yield event
			}
			order.push('mw1-end')
		}

		const mw2: StreamMiddleware = async function* (ctx, source, next) {
			order.push('mw2-start')
			for await (const event of next(ctx, source)) {
				order.push('mw2-event')
				yield event
			}
			order.push('mw2-end')
		}

		const events: StreamEvent[] = [{ type: 'text_delta', text: 'Hi' }]
		const composed = composeStreamMiddleware([mw1, mw2])
		const ctx = createMockContext()
		const source = makeAsyncIterable(events)

		const result = composed(ctx, source, (_c, s) => s)
		await collectStream(result)

		expect(order).toEqual([
			'mw1-start',
			'mw2-start',
			'mw2-event',
			'mw1-event',
			'mw2-end',
			'mw1-end',
		])
	})

	it('allows middleware to transform stream events', async () => {
		const mw: StreamMiddleware = async function* (ctx, source, next) {
			for await (const event of next(ctx, source)) {
				if (event.type === 'text_delta') {
					yield { type: 'text_delta', text: event.text.toUpperCase() }
				} else {
					yield event
				}
			}
		}

		const events: StreamEvent[] = [
			{ type: 'text_delta', text: 'hello' },
			{ type: 'text_delta', text: 'world' },
		]

		const composed = composeStreamMiddleware([mw])
		const ctx = createMockContext()
		const source = makeAsyncIterable(events)

		const result = composed(ctx, source, (_c, s) => s)
		const collected = await collectStream(result)

		expect(collected).toEqual([
			{ type: 'text_delta', text: 'HELLO' },
			{ type: 'text_delta', text: 'WORLD' },
		])
	})
})

// ─── loggingMiddleware ────────────────────────────────────────────

describe('loggingMiddleware', () => {
	it('calls log.info twice — once for request, once for response', async () => {
		const mockLogger = {
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			child: vi.fn(),
		}

		const middleware = loggingMiddleware(mockLogger)
		const ctx = createMockContext()
		const response = createMockResponse()

		await middleware(ctx, async () => response)

		expect(mockLogger.info).toHaveBeenCalledTimes(2)
	})

	it('logs request fields including provider, model, traceId and messageCount', async () => {
		const mockLogger = {
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			child: vi.fn(),
		}

		const middleware = loggingMiddleware(mockLogger)
		const ctx = createMockContext({
			provider: 'openai',
			model: 'gpt-4o',
			traceId: 'trc_abc',
			request: {
				messages: [
					{ role: 'system', content: 'You are helpful.' },
					{ role: 'user', content: 'What is 2+2?' },
				],
			},
		})

		await middleware(ctx, async () => createMockResponse())

		const [firstCallMessage, firstCallData] = mockLogger.info.mock.calls[0]
		expect(firstCallMessage).toBe('LLM request')
		expect(firstCallData).toMatchObject({
			provider: 'openai',
			model: 'gpt-4o',
			traceId: 'trc_abc',
			messageCount: 2,
		})
	})

	it('logs response fields including latencyMs, tokens, and cost', async () => {
		const mockLogger = {
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			child: vi.fn(),
		}

		const middleware = loggingMiddleware(mockLogger)
		const ctx = createMockContext()
		const response = createMockResponse({
			latencyMs: 250,
			usage: { inputTokens: 200, outputTokens: 100, totalTokens: 300 },
			cost: { inputCost: 0.0006, outputCost: 0.0015, totalCost: 0.0021, currency: 'USD' },
		})

		await middleware(ctx, async () => response)

		const [secondCallMessage, secondCallData] = mockLogger.info.mock.calls[1]
		expect(secondCallMessage).toBe('LLM response')
		expect(secondCallData).toMatchObject({
			latencyMs: 250,
			inputTokens: 200,
			outputTokens: 100,
			totalCost: 0.0021,
		})
	})

	it('returns the response from next unchanged', async () => {
		const mockLogger = {
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			child: vi.fn(),
		}

		const middleware = loggingMiddleware(mockLogger)
		const ctx = createMockContext()
		const expected = createMockResponse({ id: 'msg_unique_456' })

		const result = await middleware(ctx, async () => expected)

		expect(result.id).toBe('msg_unique_456')
	})

	it('uses createLogger internally when no logger is provided', async () => {
		// Should not throw even without a logger argument
		const middleware = loggingMiddleware()
		const ctx = createMockContext()

		const result = await middleware(ctx, async () => createMockResponse())

		expect(result).toBeDefined()
	})
})

// ─── costTrackingMiddleware ───────────────────────────────────────

describe('costTrackingMiddleware', () => {
	it('starts with zero values', () => {
		const tracker = costTrackingMiddleware()

		expect(tracker.getTotalCost()).toBe(0)
		expect(tracker.getTotalTokens()).toBe(0)
		expect(tracker.getCallCount()).toBe(0)
	})

	it('accumulates cost after a single call', async () => {
		const tracker = costTrackingMiddleware()
		const ctx = createMockContext()
		const response = createMockResponse({
			usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
			cost: { inputCost: 0.001, outputCost: 0.002, totalCost: 0.003, currency: 'USD' },
		})

		await tracker(ctx, async () => response)

		expect(tracker.getTotalCost()).toBeCloseTo(0.003, 6)
		expect(tracker.getTotalTokens()).toBe(150)
		expect(tracker.getCallCount()).toBe(1)
	})

	it('accumulates cost across multiple calls', async () => {
		const tracker = costTrackingMiddleware()
		const ctx = createMockContext()

		const response1 = createMockResponse({
			usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
			cost: { inputCost: 0.001, outputCost: 0.002, totalCost: 0.003, currency: 'USD' },
		})
		const response2 = createMockResponse({
			usage: { inputTokens: 200, outputTokens: 100, totalTokens: 300 },
			cost: { inputCost: 0.002, outputCost: 0.004, totalCost: 0.006, currency: 'USD' },
		})

		await tracker(ctx, async () => response1)
		await tracker(ctx, async () => response2)

		expect(tracker.getTotalCost()).toBeCloseTo(0.009, 6)
		expect(tracker.getTotalTokens()).toBe(450)
		expect(tracker.getCallCount()).toBe(2)
	})

	it('reset clears all tracked values to zero', async () => {
		const tracker = costTrackingMiddleware()
		const ctx = createMockContext()
		const response = createMockResponse({
			usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
			cost: { inputCost: 0.001, outputCost: 0.002, totalCost: 0.003, currency: 'USD' },
		})

		await tracker(ctx, async () => response)
		expect(tracker.getCallCount()).toBe(1)

		tracker.reset()

		expect(tracker.getTotalCost()).toBe(0)
		expect(tracker.getTotalTokens()).toBe(0)
		expect(tracker.getCallCount()).toBe(0)
	})

	it('continues accumulating after reset', async () => {
		const tracker = costTrackingMiddleware()
		const ctx = createMockContext()
		const response = createMockResponse({
			usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
			cost: { inputCost: 0.001, outputCost: 0.002, totalCost: 0.003, currency: 'USD' },
		})

		await tracker(ctx, async () => response)
		tracker.reset()
		await tracker(ctx, async () => response)

		expect(tracker.getTotalCost()).toBeCloseTo(0.003, 6)
		expect(tracker.getTotalTokens()).toBe(150)
		expect(tracker.getCallCount()).toBe(1)
	})

	it('returns the response from next unchanged', async () => {
		const tracker = costTrackingMiddleware()
		const ctx = createMockContext()
		const expected = createMockResponse({ id: 'msg_passthrough' })

		const result = await tracker(ctx, async () => expected)

		expect(result.id).toBe('msg_passthrough')
	})

	it('getTotalTokens uses totalTokens from usage (not sum of input+output)', async () => {
		const tracker = costTrackingMiddleware()
		const ctx = createMockContext()
		// totalTokens differs from inputTokens + outputTokens (e.g. cache tokens)
		const response = createMockResponse({
			usage: { inputTokens: 100, outputTokens: 50, totalTokens: 200 },
			cost: { inputCost: 0, outputCost: 0, totalCost: 0, currency: 'USD' },
		})

		await tracker(ctx, async () => response)

		expect(tracker.getTotalTokens()).toBe(200)
	})
})
