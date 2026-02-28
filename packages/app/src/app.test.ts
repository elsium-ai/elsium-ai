import type { Agent } from '@elsium-ai/agents'
import type { CompletionRequest, LLMResponse } from '@elsium-ai/core'
import { ElsiumStream, createStream } from '@elsium-ai/core'
import type { Gateway } from '@elsium-ai/gateway'
import { registerProviderFactory } from '@elsium-ai/gateway'
import { observe } from '@elsium-ai/observe'
import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app'
import { authMiddleware, corsMiddleware, rateLimitMiddleware } from './middleware'
import { type RoutesDeps, createRoutes } from './routes'

// ─── Helpers ─────────────────────────────────────────────────────

function mockGateway(responseOverrides: Partial<LLMResponse> = {}): Gateway {
	const response: LLMResponse = {
		id: 'msg_1',
		message: { role: 'assistant', content: 'Hello from gateway!' },
		usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
		cost: { inputCost: 0.001, outputCost: 0.002, totalCost: 0.003, currency: 'USD' },
		model: 'test-model',
		provider: 'test',
		stopReason: 'end_turn',
		latencyMs: 50,
		traceId: 'trc_test',
		...responseOverrides,
	}

	return {
		async complete() {
			return response
		},
		stream() {
			return createStream(async (emit) => {
				emit({ type: 'text_delta', text: 'Hello' })
			})
		},
		async generate() {
			return { data: {} as never, response }
		},
		provider: {
			name: 'test',
			defaultModel: 'test-model',
			async complete() {
				return response
			},
			stream() {
				return createStream(async () => {})
			},
			async listModels() {
				return ['test-model']
			},
		},
	}
}

function mockAgent(name: string, responseContent = 'Agent response'): Agent {
	return {
		name,
		config: { name, system: 'Test agent', model: 'test-model' },
		async run(input) {
			return {
				message: { role: 'assistant' as const, content: responseContent },
				usage: {
					totalInputTokens: 100,
					totalOutputTokens: 50,
					totalTokens: 150,
					totalCost: 0.003,
					iterations: 1,
				},
				toolCalls: [],
				traceId: 'trc_test',
			}
		},
		async chat() {
			return this.run('')
		},
		resetMemory() {},
	}
}

function setupRoutes(overrides: Partial<RoutesDeps> = {}): Hono {
	const deps: RoutesDeps = {
		gateway: mockGateway(),
		agents: new Map([['helper', mockAgent('helper')]]),
		defaultAgent: mockAgent('helper'),
		tracer: observe({ output: [] }),
		startTime: Date.now(),
		version: '0.1.0',
		providers: ['anthropic'],
		...overrides,
	}
	return createRoutes(deps)
}

function req(method: string, path: string, body?: unknown): Request {
	const init: RequestInit = { method, headers: { 'Content-Type': 'application/json' } }
	if (body) init.body = JSON.stringify(body)
	return new Request(`http://localhost${path}`, init)
}

// ─── Health ──────────────────────────────────────────────────────

describe('GET /health', () => {
	it('returns ok status', async () => {
		const app = setupRoutes()
		const res = await app.fetch(req('GET', '/health'))
		const json = await res.json()

		expect(res.status).toBe(200)
		expect(json.status).toBe('ok')
		expect(json.version).toBe('0.1.0')
		expect(json.providers).toEqual(['anthropic'])
		expect(json.uptime).toBeGreaterThanOrEqual(0)
	})
})

// ─── Metrics ─────────────────────────────────────────────────────

describe('GET /metrics', () => {
	it('returns metrics', async () => {
		const app = setupRoutes()
		const res = await app.fetch(req('GET', '/metrics'))
		const json = await res.json()

		expect(res.status).toBe(200)
		expect(json.uptime).toBeGreaterThanOrEqual(0)
		expect(json.totalRequests).toBe(0)
		expect(json.totalCost).toBe(0)
	})
})

// ─── Chat ────────────────────────────────────────────────────────

describe('POST /chat', () => {
	it('chats with default agent', async () => {
		const app = setupRoutes()
		const res = await app.fetch(req('POST', '/chat', { message: 'Hello' }))
		const json = await res.json()

		expect(res.status).toBe(200)
		expect(json.message).toBe('Agent response')
		expect(json.usage.totalTokens).toBe(150)
		expect(json.traceId).toBe('trc_test')
	})

	it('chats with specific agent', async () => {
		const agents = new Map([
			['writer', mockAgent('writer', 'Written by writer')],
			['coder', mockAgent('coder', 'Code from coder')],
		])

		const app = setupRoutes({ agents, defaultAgent: agents.get('writer') })
		const res = await app.fetch(req('POST', '/chat', { message: 'Hi', agent: 'coder' }))
		const json = await res.json()

		expect(json.message).toBe('Code from coder')
	})

	it('returns 400 when message is missing', async () => {
		const app = setupRoutes()
		const res = await app.fetch(req('POST', '/chat', {}))

		expect(res.status).toBe(400)
	})

	it('returns 404 for unknown agent', async () => {
		const app = setupRoutes()
		const res = await app.fetch(req('POST', '/chat', { message: 'Hi', agent: 'nonexistent' }))

		expect(res.status).toBe(404)
		const json = await res.json()
		expect(json.error).toContain('not found')
	})

	it('returns 404 when no default agent', async () => {
		const app = setupRoutes({
			agents: new Map(),
			defaultAgent: undefined,
		})
		const res = await app.fetch(req('POST', '/chat', { message: 'Hi' }))

		expect(res.status).toBe(404)
	})
})

// ─── Complete ────────────────────────────────────────────────────

describe('POST /complete', () => {
	it('completes with gateway', async () => {
		const app = setupRoutes()
		const res = await app.fetch(
			req('POST', '/complete', {
				messages: [{ role: 'user', content: 'Hello' }],
			}),
		)
		const json = await res.json()

		expect(res.status).toBe(200)
		expect(json.message).toBe('Hello from gateway!')
		expect(json.model).toBe('test-model')
		expect(json.usage.totalTokens).toBe(150)
	})

	it('returns 400 when messages are missing', async () => {
		const app = setupRoutes()
		const res = await app.fetch(req('POST', '/complete', {}))

		expect(res.status).toBe(400)
	})
})

// ─── Agents List ─────────────────────────────────────────────────

describe('GET /agents', () => {
	it('lists available agents', async () => {
		const agents = new Map([
			['writer', mockAgent('writer')],
			['coder', mockAgent('coder')],
		])

		const app = setupRoutes({ agents })
		const res = await app.fetch(req('GET', '/agents'))
		const json = await res.json()

		expect(res.status).toBe(200)
		expect(json.agents).toHaveLength(2)
		expect(json.agents.map((a: { name: string }) => a.name)).toContain('writer')
		expect(json.agents.map((a: { name: string }) => a.name)).toContain('coder')
	})
})

// ─── CORS Middleware ─────────────────────────────────────────────

describe('corsMiddleware', () => {
	it('adds CORS headers', async () => {
		const app = new Hono()
		app.use('*', corsMiddleware())
		app.get('/test', (c) => c.text('ok'))

		const res = await app.fetch(req('GET', '/test'))
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
	})

	it('handles preflight OPTIONS', async () => {
		const app = new Hono()
		app.use('*', corsMiddleware())
		app.get('/test', (c) => c.text('ok'))

		const res = await app.fetch(req('OPTIONS', '/test'))
		expect(res.status).toBe(200)
	})
})

// ─── Auth Middleware ─────────────────────────────────────────────

describe('authMiddleware', () => {
	it('allows requests with valid token', async () => {
		const app = new Hono()
		app.use('*', authMiddleware({ type: 'bearer', token: 'secret123' }))
		app.get('/test', (c) => c.text('ok'))

		const r = new Request('http://localhost/test', {
			headers: { Authorization: 'Bearer secret123' },
		})
		const res = await app.fetch(r)
		expect(res.status).toBe(200)
	})

	it('rejects requests without token', async () => {
		const app = new Hono()
		app.use('*', authMiddleware({ type: 'bearer', token: 'secret123' }))
		app.get('/test', (c) => c.text('ok'))

		const res = await app.fetch(req('GET', '/test'))
		expect(res.status).toBe(401)
	})

	it('rejects invalid tokens', async () => {
		const app = new Hono()
		app.use('*', authMiddleware({ type: 'bearer', token: 'secret123' }))
		app.get('/test', (c) => c.text('ok'))

		const r = new Request('http://localhost/test', {
			headers: { Authorization: 'Bearer wrong' },
		})
		const res = await app.fetch(r)
		expect(res.status).toBe(401)
	})

	it('skips auth for health endpoint', async () => {
		const app = new Hono()
		app.use('*', authMiddleware({ type: 'bearer', token: 'secret123' }))
		app.get('/health', (c) => c.json({ status: 'ok' }))

		const res = await app.fetch(req('GET', '/health'))
		expect(res.status).toBe(200)
	})
})

// ─── Rate Limit Middleware ───────────────────────────────────────

describe('rateLimitMiddleware', () => {
	it('allows requests within limit', async () => {
		const app = new Hono()
		app.use('*', rateLimitMiddleware({ windowMs: 60_000, maxRequests: 5 }))
		app.get('/test', (c) => c.text('ok'))

		const res = await app.fetch(req('GET', '/test'))
		expect(res.status).toBe(200)
		expect(res.headers.get('X-RateLimit-Limit')).toBe('5')
	})

	it('blocks requests over limit', async () => {
		const app = new Hono()
		app.use('*', rateLimitMiddleware({ windowMs: 60_000, maxRequests: 2 }))
		app.get('/test', (c) => c.text('ok'))

		await app.fetch(req('GET', '/test'))
		await app.fetch(req('GET', '/test'))
		const res = await app.fetch(req('GET', '/test'))

		expect(res.status).toBe(429)
		const json = await res.json()
		expect(json.error).toContain('Too many requests')
	})
})

// ─── createApp ───────────────────────────────────────────────────

describe('createApp', () => {
	beforeEach(() => {
		// Register a mock provider so createApp can instantiate a gateway
		registerProviderFactory('mock-app', () => ({
			name: 'mock-app',
			defaultModel: 'mock-model',
			async complete() {
				return {
					id: 'msg_1',
					message: { role: 'assistant' as const, content: 'Hello from app mock' },
					usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
					cost: { inputCost: 0, outputCost: 0, totalCost: 0, currency: 'USD' as const },
					model: 'mock-model',
					provider: 'mock-app',
					stopReason: 'end_turn' as const,
					latencyMs: 10,
					traceId: 'trc_test',
				}
			},
			stream() {
				return createStream(async (emit) => {
					emit({ type: 'text_delta', text: 'Hello' })
				})
			},
			async listModels() {
				return ['mock-model']
			},
		}))
	})

	it('creates an app with hono, gateway, and tracer', () => {
		const app = createApp({
			gateway: {
				providers: {
					'mock-app': { apiKey: 'test-key' },
				},
				defaultModel: 'mock-model',
			},
		})

		expect(app.hono).toBeInstanceOf(Hono)
		expect(app.gateway).toBeDefined()
		expect(app.gateway.complete).toBeTypeOf('function')
		expect(app.gateway.stream).toBeTypeOf('function')
		expect(app.tracer).toBeDefined()
	})

	it('registers agents and serves health endpoint', async () => {
		const agent: Agent = {
			name: 'test-agent',
			config: { name: 'test-agent', system: 'Test' },
			async run() {
				return {
					message: { role: 'assistant' as const, content: 'agent response' },
					usage: {
						totalInputTokens: 10,
						totalOutputTokens: 5,
						totalTokens: 15,
						totalCost: 0,
						iterations: 1,
					},
					toolCalls: [],
					traceId: 'trc_test',
				}
			},
			async chat() {
				return this.run('')
			},
			resetMemory() {},
		}

		const app = createApp({
			gateway: {
				providers: { 'mock-app': { apiKey: 'test-key' } },
			},
			agents: [agent],
		})

		// Test health endpoint through the Hono instance
		const res = await app.hono.fetch(new Request('http://localhost/health', { method: 'GET' }))
		const json = await res.json()

		expect(res.status).toBe(200)
		expect(json.status).toBe('ok')
		expect(json.providers).toContain('mock-app')
	})

	it('serves agents list endpoint', async () => {
		const agent: Agent = {
			name: 'my-agent',
			config: { name: 'my-agent', system: 'Test system prompt' },
			async run() {
				return {
					message: { role: 'assistant' as const, content: 'ok' },
					usage: {
						totalInputTokens: 0,
						totalOutputTokens: 0,
						totalTokens: 0,
						totalCost: 0,
						iterations: 1,
					},
					toolCalls: [],
					traceId: 'trc_test',
				}
			},
			async chat() {
				return this.run('')
			},
			resetMemory() {},
		}

		const app = createApp({
			gateway: {
				providers: { 'mock-app': { apiKey: 'key' } },
			},
			agents: [agent],
		})

		const res = await app.hono.fetch(new Request('http://localhost/agents', { method: 'GET' }))
		const json = await res.json()

		expect(res.status).toBe(200)
		expect(json.agents).toHaveLength(1)
		expect(json.agents[0].name).toBe('my-agent')
	})

	it('provides a listen method', () => {
		const app = createApp({
			gateway: {
				providers: { 'mock-app': { apiKey: 'key' } },
			},
		})

		expect(app.listen).toBeTypeOf('function')
	})
})
