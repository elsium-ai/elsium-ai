import type { ClientConfig } from './client'
import { createClient } from './client'

// ─── Helpers ─────────────────────────────────────────────────────

const baseConfig: ClientConfig = {
	baseUrl: 'http://localhost:3000',
}

const healthResponse = {
	status: 'ok',
	version: '1.0.0',
	uptime: 12345,
	providers: ['anthropic', 'openai'],
}

const chatResponse = {
	message: 'Hello from the server',
	usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, cost: 0.003 },
	model: 'test-model',
	traceId: 'trc_123',
}

const completeResponse = {
	id: 'msg_1',
	message: 'Completed response',
	model: 'test-model',
	usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
	cost: { inputCost: 0.001, outputCost: 0.002, totalCost: 0.003, currency: 'USD' },
	traceId: 'trc_456',
}

const agentsResponse = {
	agents: [
		{ name: 'helper', model: 'test-model', tools: ['search'] },
		{ name: 'coder', model: 'test-model', tools: [] },
	],
}

function mockFetch(
	responseBody: unknown,
	status = 200,
	options: { text?: string } = {},
): ReturnType<typeof vi.fn> {
	return vi.fn().mockResolvedValue({
		ok: status >= 200 && status < 300,
		status,
		json: async () => responseBody,
		text: async () => options.text ?? JSON.stringify(responseBody),
	})
}

// ─── health() ────────────────────────────────────────────────────

describe('health()', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('makes GET request to /health', async () => {
		const fetchMock = mockFetch(healthResponse)
		vi.stubGlobal('fetch', fetchMock)

		const client = createClient(baseConfig)
		const result = await client.health()

		expect(result).toEqual(healthResponse)
		expect(fetchMock).toHaveBeenCalledOnce()

		const [url, init] = fetchMock.mock.calls[0]
		expect(url).toBe('http://localhost:3000/health')
		expect(init.method).toBe('GET')
	})

	it('does not include body in GET request', async () => {
		const fetchMock = mockFetch(healthResponse)
		vi.stubGlobal('fetch', fetchMock)

		const client = createClient(baseConfig)
		await client.health()

		const [, init] = fetchMock.mock.calls[0]
		expect(init.body).toBeUndefined()
	})
})

// ─── chat() ──────────────────────────────────────────────────────

describe('chat()', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('makes POST request to /chat with message', async () => {
		const fetchMock = mockFetch(chatResponse)
		vi.stubGlobal('fetch', fetchMock)

		const client = createClient(baseConfig)
		const result = await client.chat({ message: 'Hello' })

		expect(result).toEqual(chatResponse)

		const [url, init] = fetchMock.mock.calls[0]
		expect(url).toBe('http://localhost:3000/chat')
		expect(init.method).toBe('POST')

		const body = JSON.parse(init.body)
		expect(body.message).toBe('Hello')
		expect(body.stream).toBe(false)
	})

	it('includes agent name when specified', async () => {
		const fetchMock = mockFetch(chatResponse)
		vi.stubGlobal('fetch', fetchMock)

		const client = createClient(baseConfig)
		await client.chat({ message: 'Hello', agent: 'coder' })

		const [, init] = fetchMock.mock.calls[0]
		const body = JSON.parse(init.body)
		expect(body.agent).toBe('coder')
	})
})

// ─── complete() ──────────────────────────────────────────────────

describe('complete()', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('makes POST request to /complete with messages', async () => {
		const fetchMock = mockFetch(completeResponse)
		vi.stubGlobal('fetch', fetchMock)

		const client = createClient(baseConfig)
		const result = await client.complete({
			messages: [{ role: 'user', content: 'Hello' }],
		})

		expect(result).toEqual(completeResponse)

		const [url, init] = fetchMock.mock.calls[0]
		expect(url).toBe('http://localhost:3000/complete')
		expect(init.method).toBe('POST')

		const body = JSON.parse(init.body)
		expect(body.messages).toEqual([{ role: 'user', content: 'Hello' }])
		expect(body.stream).toBe(false)
	})

	it('sends optional parameters (model, system, maxTokens, temperature)', async () => {
		const fetchMock = mockFetch(completeResponse)
		vi.stubGlobal('fetch', fetchMock)

		const client = createClient(baseConfig)
		await client.complete({
			messages: [{ role: 'user', content: 'Hello' }],
			model: 'gpt-4o',
			system: 'You are helpful.',
			maxTokens: 1000,
			temperature: 0.7,
		})

		const [, init] = fetchMock.mock.calls[0]
		const body = JSON.parse(init.body)
		expect(body.model).toBe('gpt-4o')
		expect(body.system).toBe('You are helpful.')
		expect(body.maxTokens).toBe(1000)
		expect(body.temperature).toBe(0.7)
	})
})

// ─── agents() ────────────────────────────────────────────────────

describe('agents()', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('makes GET request to /agents', async () => {
		const fetchMock = mockFetch(agentsResponse)
		vi.stubGlobal('fetch', fetchMock)

		const client = createClient(baseConfig)
		const result = await client.agents()

		expect(result).toEqual(agentsResponse)

		const [url, init] = fetchMock.mock.calls[0]
		expect(url).toBe('http://localhost:3000/agents')
		expect(init.method).toBe('GET')
	})
})

// ─── Auth header ─────────────────────────────────────────────────

describe('auth header', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('includes Authorization header when apiKey is set', async () => {
		const fetchMock = mockFetch(healthResponse)
		vi.stubGlobal('fetch', fetchMock)

		const client = createClient({ ...baseConfig, apiKey: 'sk-test-123' })
		await client.health()

		const [, init] = fetchMock.mock.calls[0]
		expect(init.headers.Authorization).toBe('Bearer sk-test-123')
	})

	it('does not include Authorization header when apiKey is not set', async () => {
		const fetchMock = mockFetch(healthResponse)
		vi.stubGlobal('fetch', fetchMock)

		const client = createClient(baseConfig)
		await client.health()

		const [, init] = fetchMock.mock.calls[0]
		expect(init.headers.Authorization).toBeUndefined()
	})

	it('always includes Content-Type header', async () => {
		const fetchMock = mockFetch(healthResponse)
		vi.stubGlobal('fetch', fetchMock)

		const client = createClient(baseConfig)
		await client.health()

		const [, init] = fetchMock.mock.calls[0]
		expect(init.headers['Content-Type']).toBe('application/json')
	})
})

// ─── Error handling ──────────────────────────────────────────────

describe('error handling', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('throws on non-200 response with status and body', async () => {
		const fetchMock = mockFetch({ error: 'Not found' }, 404, { text: '{"error":"Not found"}' })
		vi.stubGlobal('fetch', fetchMock)

		const client = createClient(baseConfig)

		await expect(client.health()).rejects.toThrow('HTTP 404')
	})

	it('throws on 500 server error', async () => {
		const fetchMock = mockFetch({ error: 'Internal server error' }, 500, {
			text: 'Internal server error',
		})
		vi.stubGlobal('fetch', fetchMock)

		const client = createClient(baseConfig)

		await expect(
			client.complete({
				messages: [{ role: 'user', content: 'Hello' }],
			}),
		).rejects.toThrow('HTTP 500: Internal server error')
	})

	it('throws on 401 unauthorized', async () => {
		const fetchMock = mockFetch({ error: 'Unauthorized' }, 401, { text: 'Unauthorized' })
		vi.stubGlobal('fetch', fetchMock)

		const client = createClient(baseConfig)

		await expect(client.chat({ message: 'Hi' })).rejects.toThrow('HTTP 401')
	})

	it('throws on 429 rate limit', async () => {
		const fetchMock = mockFetch({ error: 'Too many requests' }, 429, { text: 'Too many requests' })
		vi.stubGlobal('fetch', fetchMock)

		const client = createClient(baseConfig)

		await expect(client.agents()).rejects.toThrow('HTTP 429')
	})
})
