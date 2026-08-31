import type { Agent } from '@elsium-ai/agents'
import { ElsiumError, type LLMResponse, createStream } from '@elsium-ai/core'
import type { Gateway } from '@elsium-ai/gateway'
import type { Tracer } from '@elsium-ai/observe'
import { describe, expect, it, vi } from 'vitest'
import { type RoutesDeps, createRoutes } from './routes'

// ─── Helpers ─────────────────────────────────────────────────────

function makeLLMResponse(overrides: Partial<LLMResponse> = {}): LLMResponse {
	return {
		id: 'msg_1',
		message: { role: 'assistant', content: 'Gateway response' },
		usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
		cost: { inputCost: 0.001, outputCost: 0.002, totalCost: 0.003, currency: 'USD' },
		model: 'gpt-4o',
		provider: 'openai',
		stopReason: 'end_turn',
		latencyMs: 42,
		traceId: 'trc_abc',
		...overrides,
	}
}

function mockGateway(overrides: Partial<LLMResponse> = {}): Gateway {
	const response = makeLLMResponse(overrides)
	return {
		async complete() {
			return response
		},
		stream() {
			return createStream(async (emit) => {
				emit({ type: 'text_delta', text: 'hello' })
			})
		},
		async generate() {
			return { data: {} as never, response }
		},
		provider: {
			name: 'openai',
			defaultModel: 'gpt-4o',
			async complete() {
				return response
			},
			stream() {
				return createStream(async () => {})
			},
			async listModels() {
				return ['gpt-4o']
			},
		},
	}
}

function mockAgent(name: string, content = 'Agent says hello'): Agent {
	return {
		name,
		config: { name, system: 'You are helpful.', model: 'gpt-4o' },
		async run(_input) {
			return {
				message: { role: 'assistant' as const, content },
				usage: {
					totalInputTokens: 10,
					totalOutputTokens: 20,
					totalTokens: 30,
					totalCost: 0.003,
					iterations: 1,
				},
				toolCalls: [],
				traceId: 'trc_agent',
			}
		},
		async chat() {
			return this.run('')
		},
		resetMemory() {},
	}
}

function mockTracer(): Tracer {
	return {
		trackLLMCall: vi.fn(),
		getCostReport: vi.fn().mockReturnValue({
			totalTokens: 100,
			totalCost: 0.01,
			byModel: {
				'gpt-4o': { calls: 3, tokens: 100, cost: 0.01 },
			},
		}),
	} as unknown as Tracer
}

function setupDeps(overrides: Partial<RoutesDeps> = {}): RoutesDeps {
	return {
		gateway: mockGateway(),
		agents: new Map([['helper', mockAgent('helper')]]),
		defaultAgent: mockAgent('helper'),
		tracer: mockTracer(),
		startTime: Date.now(),
		version: '1.0.0',
		providers: ['openai'],
		...overrides,
	}
}

function jsonReq(method: string, path: string, body?: unknown): Request {
	return new Request(`http://localhost${path}`, {
		method,
		headers: { 'Content-Type': 'application/json' },
		body: body !== undefined ? JSON.stringify(body) : undefined,
	})
}

function rawReq(method: string, path: string, raw: string): Request {
	return new Request(`http://localhost${path}`, {
		method,
		headers: { 'Content-Type': 'application/json' },
		body: raw,
	})
}

// ─── GET /health ──────────────────────────────────────────────────

describe('GET /health', () => {
	it('returns status ok with version and providers', async () => {
		const app = createRoutes(setupDeps())
		const res = await app.request('/health')
		const json = await res.json()

		expect(res.status).toBe(200)
		expect(json.status).toBe('ok')
		expect(json.version).toBe('1.0.0')
		expect(json.providers).toEqual(['openai'])
		expect(json.uptime).toBeGreaterThanOrEqual(0)
	})

	it('reflects uptime since startTime', async () => {
		const startTime = Date.now() - 5000
		const app = createRoutes(setupDeps({ startTime }))
		const res = await app.request('/health')
		const json = await res.json()

		expect(json.uptime).toBeGreaterThanOrEqual(4)
	})

	it('returns multiple providers', async () => {
		const app = createRoutes(setupDeps({ providers: ['openai', 'anthropic'] }))
		const res = await app.request('/health')
		const json = await res.json()

		expect(json.providers).toHaveLength(2)
		expect(json.providers).toContain('anthropic')
	})
})

// ─── GET /metrics ─────────────────────────────────────────────────

describe('GET /metrics', () => {
	it('returns metrics with tracer cost report', async () => {
		const app = createRoutes(setupDeps())
		const res = await app.request('/metrics')
		const json = await res.json()

		expect(res.status).toBe(200)
		expect(json.totalTokens).toBe(100)
		expect(json.totalCost).toBe(0.01)
		expect(json.byModel['gpt-4o'].requests).toBe(3)
		expect(json.byModel['gpt-4o'].tokens).toBe(100)
		expect(json.byModel['gpt-4o'].cost).toBe(0.01)
	})

	it('returns zero values when no tracer is provided', async () => {
		const app = createRoutes(setupDeps({ tracer: undefined }))
		const res = await app.request('/metrics')
		const json = await res.json()

		expect(json.totalTokens).toBe(0)
		expect(json.totalCost).toBe(0)
		expect(json.byModel).toEqual({})
	})

	it('increments totalRequests per chat call', async () => {
		const app = createRoutes(setupDeps())
		await app.fetch(jsonReq('POST', '/chat', { message: 'Hi' }))

		const metricsRes = await app.request('/metrics')
		const json = await metricsRes.json()
		expect(json.totalRequests).toBe(1)
	})
})

// ─── POST /chat ───────────────────────────────────────────────────

describe('POST /chat', () => {
	it('runs default agent and returns response', async () => {
		const app = createRoutes(setupDeps())
		const res = await app.fetch(jsonReq('POST', '/chat', { message: 'Hello' }))
		const json = await res.json()

		expect(res.status).toBe(200)
		expect(json.message).toBe('Agent says hello')
		expect(json.model).toBe('gpt-4o')
		expect(json.traceId).toBe('trc_agent')
		expect(json.usage.totalTokens).toBe(30)
	})

	it('routes to named agent', async () => {
		const agents = new Map([
			['writer', mockAgent('writer', 'Written content')],
			['coder', mockAgent('coder', 'Code content')],
		])
		const app = createRoutes(setupDeps({ agents, defaultAgent: agents.get('writer') }))

		const res = await app.fetch(jsonReq('POST', '/chat', { message: 'Write', agent: 'coder' }))
		const json = await res.json()

		expect(json.message).toBe('Code content')
	})

	it('tracks LLM call on tracer', async () => {
		const tracer = mockTracer()
		const app = createRoutes(setupDeps({ tracer }))
		await app.fetch(jsonReq('POST', '/chat', { message: 'Hello' }))

		expect(tracer.trackLLMCall).toHaveBeenCalledOnce()
		const args = (tracer.trackLLMCall as ReturnType<typeof vi.fn>).mock.calls[0][0]
		expect(args.model).toBe('gpt-4o')
		expect(args.inputTokens).toBe(10)
		expect(args.outputTokens).toBe(20)
	})

	it('returns 400 when message field is missing', async () => {
		const app = createRoutes(setupDeps())
		const res = await app.fetch(jsonReq('POST', '/chat', {}))

		expect(res.status).toBe(400)
		const json = await res.json()
		expect(json.error).toBe('message is required')
	})

	it('returns 400 for malformed JSON', async () => {
		const app = createRoutes(setupDeps())
		const res = await app.fetch(rawReq('POST', '/chat', '{bad json'))

		expect(res.status).toBe(400)
		const json = await res.json()
		expect(json.error).toBe('Invalid JSON in request body')
	})

	it('returns 413 when body exceeds 1MB', async () => {
		const app = createRoutes(setupDeps())
		const bigBody = JSON.stringify({ message: 'x'.repeat(1_100_000) })
		const res = await app.fetch(rawReq('POST', '/chat', bigBody))

		expect(res.status).toBe(413)
	})

	it('returns 404 for unknown agent name', async () => {
		const app = createRoutes(setupDeps())
		const res = await app.fetch(jsonReq('POST', '/chat', { message: 'Hi', agent: 'missing' }))

		expect(res.status).toBe(404)
		const json = await res.json()
		expect(json.error).toContain('"missing"')
	})

	it('returns 404 when no default agent and no agent name', async () => {
		const app = createRoutes(setupDeps({ agents: new Map(), defaultAgent: undefined }))
		const res = await app.fetch(jsonReq('POST', '/chat', { message: 'Hi' }))

		expect(res.status).toBe(404)
	})

	it('returns ElsiumError status code when agent throws', async () => {
		const agent = mockAgent('failing')
		agent.run = async () => {
			throw ElsiumError.rateLimit('openai', 3000)
		}
		const app = createRoutes(
			setupDeps({ agents: new Map([['failing', agent]]), defaultAgent: agent }),
		)
		const res = await app.fetch(jsonReq('POST', '/chat', { message: 'Hi' }))
		const json = await res.json()

		expect(res.status).toBe(429)
		expect(json.code).toBe('RATE_LIMIT')
	})

	it('returns 500 when agent throws generic error', async () => {
		const agent = mockAgent('failing')
		agent.run = async () => {
			throw new Error('Unexpected crash')
		}
		const app = createRoutes(
			setupDeps({ agents: new Map([['failing', agent]]), defaultAgent: agent }),
		)
		const res = await app.fetch(jsonReq('POST', '/chat', { message: 'Hi' }))
		const json = await res.json()

		expect(res.status).toBe(500)
		expect(json.error).toBe('Agent execution failed')
	})
})

// ─── POST /complete ───────────────────────────────────────────────

describe('POST /complete', () => {
	it('calls gateway.complete and returns response', async () => {
		const app = createRoutes(setupDeps())
		const res = await app.fetch(
			jsonReq('POST', '/complete', {
				messages: [{ role: 'user', content: 'Hello' }],
			}),
		)
		const json = await res.json()

		expect(res.status).toBe(200)
		expect(json.message).toBe('Gateway response')
		expect(json.model).toBe('gpt-4o')
		expect(json.usage.totalTokens).toBe(30)
		expect(json.traceId).toBe('trc_abc')
	})

	it('passes optional parameters to gateway', async () => {
		const completeSpy = vi.fn().mockResolvedValue(makeLLMResponse())
		const gw = mockGateway()
		gw.complete = completeSpy

		const app = createRoutes(setupDeps({ gateway: gw }))
		await app.fetch(
			jsonReq('POST', '/complete', {
				messages: [{ role: 'user', content: 'Hi' }],
				model: 'gpt-4o-mini',
				system: 'Be concise.',
				maxTokens: 512,
				temperature: 0.3,
			}),
		)

		expect(completeSpy).toHaveBeenCalledOnce()
		const callArg = completeSpy.mock.calls[0][0]
		expect(callArg.model).toBe('gpt-4o-mini')
		expect(callArg.system).toBe('Be concise.')
		expect(callArg.maxTokens).toBe(512)
		expect(callArg.temperature).toBe(0.3)
	})

	it('tracks LLM call on tracer', async () => {
		const tracer = mockTracer()
		const app = createRoutes(setupDeps({ tracer }))
		await app.fetch(jsonReq('POST', '/complete', { messages: [{ role: 'user', content: 'Hi' }] }))

		expect(tracer.trackLLMCall).toHaveBeenCalledOnce()
	})

	it('returns 400 when messages array is absent', async () => {
		const app = createRoutes(setupDeps())
		const res = await app.fetch(jsonReq('POST', '/complete', {}))

		expect(res.status).toBe(400)
	})

	it('returns 400 when messages array is empty', async () => {
		const app = createRoutes(setupDeps())
		const res = await app.fetch(jsonReq('POST', '/complete', { messages: [] }))

		expect(res.status).toBe(400)
	})

	it('returns 400 for malformed JSON', async () => {
		const app = createRoutes(setupDeps())
		const res = await app.fetch(rawReq('POST', '/complete', 'not-json'))
		const json = await res.json()

		expect(res.status).toBe(400)
		expect(json.error).toBe('Invalid JSON in request body')
	})

	it('returns 413 when body is too large', async () => {
		const app = createRoutes(setupDeps())
		const bigBody = JSON.stringify({
			messages: [{ role: 'user', content: 'x'.repeat(1_100_000) }],
		})
		const res = await app.fetch(rawReq('POST', '/complete', bigBody))

		expect(res.status).toBe(413)
	})

	it('returns ElsiumError status when gateway throws', async () => {
		const gw = mockGateway()
		gw.complete = async () => {
			throw ElsiumError.authError('openai')
		}
		const app = createRoutes(setupDeps({ gateway: gw }))
		const res = await app.fetch(
			jsonReq('POST', '/complete', { messages: [{ role: 'user', content: 'Hi' }] }),
		)
		const json = await res.json()

		expect(res.status).toBe(401)
		expect(json.code).toBe('AUTH_ERROR')
	})

	it('returns 500 when gateway throws generic error', async () => {
		const gw = mockGateway()
		gw.complete = async () => {
			throw new Error('Connection refused')
		}
		const app = createRoutes(setupDeps({ gateway: gw }))
		const res = await app.fetch(
			jsonReq('POST', '/complete', { messages: [{ role: 'user', content: 'Hi' }] }),
		)
		const json = await res.json()

		expect(res.status).toBe(500)
		expect(json.error).toBe('Completion failed')
	})
})

// ─── GET /agents ──────────────────────────────────────────────────

describe('GET /agents', () => {
	it('returns list of registered agents', async () => {
		const agents = new Map([
			['writer', mockAgent('writer')],
			['coder', mockAgent('coder')],
		])
		const app = createRoutes(setupDeps({ agents }))
		const res = await app.request('/agents')
		const json = await res.json()

		expect(res.status).toBe(200)
		expect(json.agents).toHaveLength(2)
		const names = json.agents.map((a: { name: string }) => a.name)
		expect(names).toContain('writer')
		expect(names).toContain('coder')
	})

	it('returns empty list when no agents registered', async () => {
		const app = createRoutes(setupDeps({ agents: new Map() }))
		const res = await app.request('/agents')
		const json = await res.json()

		expect(json.agents).toHaveLength(0)
	})

	it('includes model and tools in agent entries', async () => {
		const agent: Agent = {
			name: 'search-agent',
			config: {
				name: 'search-agent',
				model: 'gpt-4o',
				system: 'Search agent',
				tools: [{ name: 'web_search', description: 'Search the web', inputSchema: {} }],
			},
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
					traceId: 'trc_x',
				}
			},
			async chat() {
				return this.run('')
			},
			resetMemory() {},
		}

		const app = createRoutes(setupDeps({ agents: new Map([['search-agent', agent]]) }))
		const res = await app.request('/agents')
		const json = await res.json()
		const entry = json.agents[0]

		expect(entry.model).toBe('gpt-4o')
		expect(entry.tools).toContain('web_search')
	})

	it('falls back to "default" when agent has no model', async () => {
		const agent = mockAgent('no-model')
		agent.config = { name: 'no-model', system: 'Minimal' }

		const app = createRoutes(setupDeps({ agents: new Map([['no-model', agent]]) }))
		const res = await app.request('/agents')
		const json = await res.json()

		expect(json.agents[0].model).toBe('default')
	})
})
