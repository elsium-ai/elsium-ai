import type { MiddlewareContext } from '@elsium-ai/core'
import { describe, expect, it } from 'vitest'
import { xrayMiddleware } from './middleware'

function createMockContext(overrides: Partial<MiddlewareContext> = {}): MiddlewareContext {
	return {
		request: {
			messages: [{ role: 'user', content: 'Hello' }],
			model: 'claude-sonnet-4-6',
		},
		provider: 'anthropic',
		model: 'claude-sonnet-4-6',
		traceId: 'trc_test123',
		startTime: performance.now(),
		metadata: {},
		...overrides,
	}
}

const mockResponse = {
	id: 'msg_123',
	message: { role: 'assistant' as const, content: 'Hello!' },
	usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
	cost: { inputCost: 0.00003, outputCost: 0.000075, totalCost: 0.000105, currency: 'USD' as const },
	model: 'claude-sonnet-4-6',
	provider: 'anthropic',
	stopReason: 'end_turn' as const,
	latencyMs: 100,
	traceId: 'trc_test123',
}

describe('xrayMiddleware', () => {
	it('should capture call data', async () => {
		const xray = xrayMiddleware()
		const ctx = createMockContext()

		await xray(ctx, async () => mockResponse)

		const last = xray.lastCall()
		expect(last).not.toBeNull()
		expect(last?.provider).toBe('anthropic')
		expect(last?.model).toBe('claude-sonnet-4-6')
		expect(last?.usage.totalTokens).toBe(15)
		expect(last?.cost.totalCost).toBe(0.000105)
	})

	it('should maintain call history', async () => {
		const xray = xrayMiddleware()

		for (let i = 0; i < 5; i++) {
			const ctx = createMockContext({ traceId: `trc_${i}` })
			await xray(ctx, async () => ({ ...mockResponse, traceId: `trc_${i}` }))
		}

		const history = xray.callHistory(3)
		expect(history).toHaveLength(3)
		expect(history[0].traceId).toBe('trc_4')
		expect(history[1].traceId).toBe('trc_3')
	})

	it('should find by trace ID', async () => {
		const xray = xrayMiddleware()
		const ctx = createMockContext({ traceId: 'trc_find_me' })

		await xray(ctx, async () => ({ ...mockResponse, traceId: 'trc_find_me' }))

		const found = xray.getByTraceId('trc_find_me')
		expect(found).toBeDefined()
		expect(found?.traceId).toBe('trc_find_me')
	})

	it('should respect maxHistory limit', async () => {
		const xray = xrayMiddleware({ maxHistory: 3 })

		for (let i = 0; i < 5; i++) {
			const ctx = createMockContext({ traceId: `trc_${i}` })
			await xray(ctx, async () => ({ ...mockResponse, traceId: `trc_${i}` }))
		}

		const history = xray.callHistory(10)
		expect(history).toHaveLength(3)
	})

	it('should redact API keys in headers', async () => {
		const xray = xrayMiddleware()
		const ctx = createMockContext({ metadata: { _apiKey: 'sk-ant-api03-verysecretkey' } })

		await xray(ctx, async () => mockResponse)

		const last = xray.lastCall()
		expect(last?.request.headers['x-api-key']).not.toBe('sk-ant-api03-verysecretkey')
		expect(last?.request.headers['x-api-key']).toContain('...')
	})

	it('should clear history', async () => {
		const xray = xrayMiddleware()
		const ctx = createMockContext()

		await xray(ctx, async () => mockResponse)
		expect(xray.lastCall()).not.toBeNull()

		xray.clear()
		expect(xray.lastCall()).toBeNull()
	})
})
