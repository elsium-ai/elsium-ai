import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { detectProvider, elsiumToOpenai, openaiToElsium } from '../commands/proxy-format'

describe('proxy-format', () => {
	describe('detectProvider', () => {
		it('should detect anthropic from claude models', () => {
			expect(detectProvider('claude-sonnet-4-20250514')).toBe('anthropic')
			expect(detectProvider('claude-3-5-haiku-20241022')).toBe('anthropic')
		})

		it('should detect anthropic from anthropic/ prefix', () => {
			expect(detectProvider('anthropic/claude-sonnet-4-20250514')).toBe('anthropic')
		})

		it('should detect openai from gpt models', () => {
			expect(detectProvider('gpt-4o')).toBe('openai')
			expect(detectProvider('gpt-4o-mini')).toBe('openai')
			expect(detectProvider('gpt-4-turbo')).toBe('openai')
		})

		it('should detect openai from o-series models', () => {
			expect(detectProvider('o1-preview')).toBe('openai')
			expect(detectProvider('o3-mini')).toBe('openai')
			expect(detectProvider('o4-mini')).toBe('openai')
		})

		it('should detect google from gemini models', () => {
			expect(detectProvider('gemini-2.0-flash')).toBe('google')
			expect(detectProvider('gemini-1.5-pro')).toBe('google')
		})

		it('should default to openai for unknown models', () => {
			expect(detectProvider('some-custom-model')).toBe('openai')
			expect(detectProvider('llama-3')).toBe('openai')
		})
	})

	describe('openaiToElsium', () => {
		it('should convert basic request', () => {
			const result = openaiToElsium({
				model: 'gpt-4o',
				messages: [{ role: 'user', content: 'Hello' }],
			})

			expect(result.messages).toEqual([{ role: 'user', content: 'Hello' }])
			expect(result.model).toBe('gpt-4o')
		})

		it('should convert all optional fields', () => {
			const result = openaiToElsium({
				model: 'gpt-4o',
				messages: [
					{ role: 'system', content: 'You are helpful' },
					{ role: 'user', content: 'Hello' },
				],
				max_tokens: 1000,
				temperature: 0.7,
				seed: 42,
				top_p: 0.9,
				stop: ['END'],
				stream: true,
			})

			expect(result.maxTokens).toBe(1000)
			expect(result.temperature).toBe(0.7)
			expect(result.seed).toBe(42)
			expect(result.topP).toBe(0.9)
			expect(result.stopSequences).toEqual(['END'])
			expect(result.stream).toBe(true)
		})

		it('should not set optional fields when absent', () => {
			const result = openaiToElsium({
				model: 'gpt-4o',
				messages: [{ role: 'user', content: 'Hi' }],
			})

			expect(result.maxTokens).toBeUndefined()
			expect(result.temperature).toBeUndefined()
			expect(result.seed).toBeUndefined()
			expect(result.topP).toBeUndefined()
			expect(result.stopSequences).toBeUndefined()
			expect(result.stream).toBeUndefined()
		})
	})

	describe('elsiumToOpenai', () => {
		it('should convert string content response', () => {
			const result = elsiumToOpenai(
				{
					id: 'resp_123',
					message: { role: 'assistant', content: 'Hello there!' },
					usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
					cost: { inputCost: 0.001, outputCost: 0.002, totalCost: 0.003, currency: 'USD' },
					model: 'gpt-4o',
					provider: 'openai',
					stopReason: 'end_turn',
					latencyMs: 500,
					traceId: 'trc_123',
				},
				'gpt-4o',
			)

			expect(result.id).toBe('resp_123')
			expect(result.object).toBe('chat.completion')
			expect(result.model).toBe('gpt-4o')
			expect(result.choices[0].message.role).toBe('assistant')
			expect(result.choices[0].message.content).toBe('Hello there!')
			expect(result.choices[0].finish_reason).toBe('stop')
			expect(result.usage.prompt_tokens).toBe(10)
			expect(result.usage.completion_tokens).toBe(5)
			expect(result.usage.total_tokens).toBe(15)
		})

		it('should convert content parts response', () => {
			const result = elsiumToOpenai(
				{
					id: 'resp_456',
					message: {
						role: 'assistant',
						content: [
							{ type: 'text', text: 'Part 1' },
							{ type: 'text', text: ' Part 2' },
						],
					},
					usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
					cost: { inputCost: 0, outputCost: 0, totalCost: 0, currency: 'USD' },
					model: 'gpt-4o',
					provider: 'openai',
					stopReason: 'end_turn',
					latencyMs: 200,
					traceId: 'trc_456',
				},
				'gpt-4o',
			)

			expect(result.choices[0].message.content).toBe('Part 1 Part 2')
		})

		it('should map stop reasons correctly', () => {
			const makeResponse = (stopReason: 'end_turn' | 'max_tokens' | 'tool_use') => ({
				id: 'r',
				message: { role: 'assistant' as const, content: '' },
				usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
				cost: { inputCost: 0, outputCost: 0, totalCost: 0, currency: 'USD' as const },
				model: 'gpt-4o',
				provider: 'openai',
				stopReason,
				latencyMs: 0,
				traceId: 'trc',
			})

			expect(elsiumToOpenai(makeResponse('end_turn'), 'gpt-4o').choices[0].finish_reason).toBe(
				'stop',
			)
			expect(elsiumToOpenai(makeResponse('max_tokens'), 'gpt-4o').choices[0].finish_reason).toBe(
				'length',
			)
			expect(elsiumToOpenai(makeResponse('tool_use'), 'gpt-4o').choices[0].finish_reason).toBe(
				'tool_calls',
			)
		})
	})
})

function readBodyFromReq(req: IncomingMessage): Promise<string> {
	return new Promise((resolve) => {
		const chunks: Buffer[] = []
		req.on('data', (chunk: Buffer) => chunks.push(chunk))
		req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
	})
}

function sendTestJson(res: ServerResponse, status: number, data: unknown) {
	res.writeHead(status, { 'Content-Type': 'application/json' })
	res.end(JSON.stringify(data))
}

function validateCompletionRequest(body: Record<string, unknown>): string | null {
	if (!body.model || !body.messages || !Array.isArray(body.messages)) {
		return 'Missing required fields: model, messages'
	}
	return null
}

async function handleTestCompletions(req: IncomingMessage, res: ServerResponse) {
	const raw = await readBodyFromReq(req)
	let body: Record<string, unknown>

	try {
		body = JSON.parse(raw) as Record<string, unknown>
	} catch {
		sendTestJson(res, 400, {
			error: { message: 'Invalid JSON body', type: 'invalid_request_error' },
		})
		return
	}

	const validationError = validateCompletionRequest(body)
	if (validationError) {
		sendTestJson(res, 400, { error: { message: validationError, type: 'invalid_request_error' } })
		return
	}

	const authHeader = req.headers.authorization ?? ''
	if (!authHeader.startsWith('Bearer ')) {
		sendTestJson(res, 401, {
			error: { message: 'Missing Authorization header', type: 'authentication_error' },
		})
		return
	}

	sendTestJson(res, 200, {
		id: 'chatcmpl-test',
		object: 'chat.completion',
		created: Math.floor(Date.now() / 1000),
		model: body.model,
		choices: [
			{
				index: 0,
				message: { role: 'assistant', content: 'Mock response' },
				finish_reason: 'stop',
			},
		],
		usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
	})
}

function createTestServer(): Server {
	return createServer((req: IncomingMessage, res: ServerResponse) => {
		const url = req.url ?? ''
		const method = req.method ?? 'GET'

		if (method === 'GET' && url === '/health') {
			sendTestJson(res, 200, { status: 'ok' })
			return
		}

		if (method === 'POST' && url === '/v1/chat/completions') {
			handleTestCompletions(req, res)
			return
		}

		sendTestJson(res, 404, { error: { message: 'Not found', type: 'invalid_request_error' } })
	})
}

describe('proxy server', () => {
	let server: Server
	let port: number

	beforeAll(async () => {
		server = createTestServer()
		await new Promise<void>((resolve) => {
			server.listen(0, () => {
				const addr = server.address()
				port = typeof addr === 'object' && addr !== null ? addr.port : 0
				resolve()
			})
		})
	})

	afterAll(() => {
		server.close()
	})

	it('should respond to health check', async () => {
		const res = await fetch(`http://localhost:${port}/health`)
		expect(res.status).toBe(200)
		const data = (await res.json()) as { status: string }
		expect(data.status).toBe('ok')
	})

	it('should return 400 on invalid JSON body', async () => {
		const res = await fetch(`http://localhost:${port}/v1/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: 'Bearer test-key',
			},
			body: 'not valid json',
		})
		expect(res.status).toBe(400)
		const data = (await res.json()) as { error: { message: string } }
		expect(data.error.message).toContain('Invalid JSON')
	})

	it('should return 400 on missing required fields', async () => {
		const res = await fetch(`http://localhost:${port}/v1/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: 'Bearer test-key',
			},
			body: JSON.stringify({ model: 'gpt-4o' }),
		})
		expect(res.status).toBe(400)
		const data = (await res.json()) as { error: { message: string } }
		expect(data.error.message).toContain('Missing required fields')
	})

	it('should return 401 without authorization header', async () => {
		const res = await fetch(`http://localhost:${port}/v1/chat/completions`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model: 'gpt-4o',
				messages: [{ role: 'user', content: 'Hi' }],
			}),
		})
		expect(res.status).toBe(401)
	})

	it('should return 404 for unknown routes', async () => {
		const res = await fetch(`http://localhost:${port}/unknown`)
		expect(res.status).toBe(404)
	})
})
