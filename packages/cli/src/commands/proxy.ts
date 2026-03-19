import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import {
	type Gateway,
	type Middleware,
	type StreamEvent,
	auditMiddleware,
	cacheMiddleware,
	costTrackingMiddleware,
	createAuditTrail,
	createInMemoryCache,
	gateway,
	loggingMiddleware,
} from 'elsium-ai'
import {
	type OpenAIChatRequest,
	type OpenAIModelList,
	detectProvider,
	elsiumToOpenai,
	openaiToElsium,
} from './proxy-format'

interface ProxyFlags {
	port: number
	budget: number | null
	audit: boolean
	cache: boolean
	log: boolean
}

function parseFlags(args: string[]): ProxyFlags {
	const flags: ProxyFlags = {
		port: 4000,
		budget: null,
		audit: false,
		cache: false,
		log: true,
	}

	for (let i = 0; i < args.length; i++) {
		const arg = args[i]
		if (arg === '--port' && args[i + 1]) {
			flags.port = Number.parseInt(args[i + 1], 10)
			i++
		} else if (arg === '--budget' && args[i + 1]) {
			flags.budget = Number.parseFloat(args[i + 1])
			i++
		} else if (arg === '--audit') {
			flags.audit = true
		} else if (arg === '--cache') {
			flags.cache = true
		} else if (arg === '--log') {
			flags.log = true
		} else if (arg === '--no-log') {
			flags.log = false
		}
	}

	return flags
}

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = []
		req.on('data', (chunk: Buffer) => chunks.push(chunk))
		req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
		req.on('error', reject)
	})
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
	const body = JSON.stringify(data)
	res.writeHead(status, {
		'Content-Type': 'application/json',
		'Access-Control-Allow-Origin': '*',
	})
	res.end(body)
}

function sendError(res: ServerResponse, status: number, message: string, type: string) {
	sendJson(res, status, { error: { message, type } })
}

function sendSSE(res: ServerResponse, data: string) {
	res.write(`data: ${data}\n\n`)
}

function gatewayKey(provider: string, apiKey: string): string {
	return `${provider}:${apiKey.slice(-8)}`
}

function parseRequestBody(raw: string): OpenAIChatRequest | null {
	try {
		return JSON.parse(raw) as OpenAIChatRequest
	} catch {
		return null
	}
}

function extractApiKey(req: IncomingMessage): string {
	const authHeader = req.headers.authorization ?? ''
	return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
}

function resolveProvider(req: IncomingMessage, model: string): string {
	const providerHeader = req.headers['x-provider']
	return typeof providerHeader === 'string' ? providerHeader : detectProvider(model)
}

interface RequestError {
	status: number
	message: string
	type: string
}

function validateCompletionBody(body: OpenAIChatRequest | null): RequestError | null {
	if (!body) {
		return {
			status: 400,
			message: 'Invalid JSON body',
			type: 'invalid_request_error',
		}
	}
	if (!body.model || !body.messages || !Array.isArray(body.messages)) {
		return {
			status: 400,
			message: 'Missing required fields: model, messages',
			type: 'invalid_request_error',
		}
	}
	return null
}

function catchToError(err: unknown): string {
	return err instanceof Error ? err.message : 'Internal server error'
}

function formatStreamChunk(event: StreamEvent, messageId: string, model: string) {
	if (event.type === 'message_start') {
		return { type: 'id' as const, id: event.id }
	}

	if (event.type === 'text_delta') {
		return {
			type: 'chunk' as const,
			data: {
				id: messageId || `chatcmpl-${Date.now()}`,
				object: 'chat.completion.chunk',
				created: Math.floor(Date.now() / 1000),
				model,
				choices: [{ index: 0, delta: { content: event.text }, finish_reason: null }],
			},
		}
	}

	if (event.type === 'message_end') {
		return {
			type: 'chunk' as const,
			data: {
				id: messageId || `chatcmpl-${Date.now()}`,
				object: 'chat.completion.chunk',
				created: Math.floor(Date.now() / 1000),
				model,
				choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
				usage: {
					prompt_tokens: event.usage.inputTokens,
					completion_tokens: event.usage.outputTokens,
					total_tokens: event.usage.totalTokens,
				},
			},
		}
	}

	return null
}

function handleCors(res: ServerResponse) {
	res.writeHead(204, {
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Provider',
	})
	res.end()
}

const SUPPORTED_MODELS: OpenAIModelList = {
	object: 'list',
	data: [
		{ id: 'gpt-4o', object: 'model', created: 0, owned_by: 'openai' },
		{ id: 'gpt-4o-mini', object: 'model', created: 0, owned_by: 'openai' },
		{ id: 'gpt-4-turbo', object: 'model', created: 0, owned_by: 'openai' },
		{ id: 'o1-preview', object: 'model', created: 0, owned_by: 'openai' },
		{ id: 'o3-mini', object: 'model', created: 0, owned_by: 'openai' },
		{ id: 'claude-sonnet-4-20250514', object: 'model', created: 0, owned_by: 'anthropic' },
		{ id: 'claude-3-5-haiku-20241022', object: 'model', created: 0, owned_by: 'anthropic' },
		{ id: 'gemini-2.0-flash', object: 'model', created: 0, owned_by: 'google' },
		{ id: 'gemini-1.5-pro', object: 'model', created: 0, owned_by: 'google' },
	],
}

export async function proxyCommand(args: string[]) {
	const flags = parseFlags(args)

	const _require = createRequire(import.meta.url)
	const pkg = _require('../../package.json') as { version: string }

	const costTracker = costTrackingMiddleware()
	const auditTrail = flags.audit ? createAuditTrail() : null
	const cacheAdapter = flags.cache ? createInMemoryCache() : null
	const gatewayCache = new Map<string, Gateway>()

	function getGateway(provider: string, apiKey: string, model: string): Gateway {
		const key = gatewayKey(provider, apiKey)
		const cached = gatewayCache.get(key)
		if (cached) return cached

		const mw: Middleware[] = [costTracker]
		if (flags.log) mw.push(loggingMiddleware())
		if (auditTrail) mw.push(auditMiddleware(auditTrail))
		if (cacheAdapter) mw.push(cacheMiddleware({ adapter: cacheAdapter }))

		const gw = gateway({ provider, model, apiKey, middleware: mw })
		gatewayCache.set(key, gw)
		return gw
	}

	async function handleStream(
		gw: Gateway,
		request: ReturnType<typeof openaiToElsium>,
		model: string,
		res: ServerResponse,
	) {
		res.writeHead(200, {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
			'Access-Control-Allow-Origin': '*',
		})

		const stream = gw.stream({ ...request, stream: true })
		let messageId = ''

		for await (const event of stream) {
			const result = formatStreamChunk(event, messageId, model)
			if (!result) continue
			if (result.type === 'id') {
				messageId = result.id
			} else {
				sendSSE(res, JSON.stringify(result.data))
			}
		}

		sendSSE(res, '[DONE]')
		res.end()
	}

	async function handleCompletions(req: IncomingMessage, res: ServerResponse) {
		const raw = await readBody(req)
		const parsed = parseRequestBody(raw)
		const error = validateCompletionBody(parsed)

		if (error) {
			sendError(res, error.status, error.message, error.type)
			return
		}

		const body = parsed as OpenAIChatRequest

		const apiKey = extractApiKey(req)
		if (!apiKey) {
			sendError(res, 401, 'Missing Authorization header', 'authentication_error')
			return
		}

		if (flags.budget !== null && costTracker.getTotalCost() >= flags.budget) {
			sendError(res, 429, 'Budget exceeded', 'budget_exceeded')
			return
		}

		const provider = resolveProvider(req, body.model)
		const gw = getGateway(provider, apiKey, body.model)
		const request = openaiToElsium(body)

		try {
			if (body.stream) {
				await handleStream(gw, request, body.model, res)
			} else {
				const response = await gw.complete(request)
				sendJson(res, 200, elsiumToOpenai(response, body.model))
			}
		} catch (err) {
			sendError(res, 500, catchToError(err), 'server_error')
		}
	}

	function handleGetRoute(url: string, res: ServerResponse): boolean {
		if (url === '/v1/models') {
			sendJson(res, 200, SUPPORTED_MODELS)
			return true
		}
		if (url === '/health') {
			sendJson(res, 200, { status: 'ok' })
			return true
		}
		if (url === '/stats') {
			sendJson(res, 200, {
				totalCost: costTracker.getTotalCost(),
				totalTokens: costTracker.getTotalTokens(),
				callCount: costTracker.getCallCount(),
			})
			return true
		}
		return false
	}

	function routeRequest(req: IncomingMessage, res: ServerResponse) {
		const url = req.url ?? ''
		const method = req.method ?? 'GET'

		if (method === 'OPTIONS') return handleCors(res)

		if (method === 'POST' && url === '/v1/chat/completions') {
			handleCompletions(req, res).catch((err) => {
				sendError(res, 500, catchToError(err), 'server_error')
			})
			return
		}

		if (method === 'GET' && handleGetRoute(url, res)) return

		sendError(res, 404, 'Not found', 'invalid_request_error')
	}

	const server = createServer(routeRequest)

	server.listen(flags.port, () => {
		const check = (on: boolean) => (on ? '\u2713' : '\u2717')

		console.log(`
  ElsiumAI Proxy v${pkg.version}

  Listening on http://localhost:${flags.port}

  Point your app to this URL:
    OPENAI_BASE_URL=http://localhost:${flags.port}/v1

  Features:
    ${check(true)} Cost tracking
    ${check(flags.log)} Request logging
    ${check(flags.audit)} Audit trail ${flags.audit ? '' : '(--audit)'}
    ${check(flags.cache)} Response cache ${flags.cache ? '' : '(--cache)'}${flags.budget !== null ? `\n    ${check(true)} Budget limit: $${flags.budget}` : ''}
`)
	})

	process.on('SIGINT', () => {
		console.log('\n  Shutting down proxy...')
		if (costTracker.getCallCount() > 0) {
			console.log(`  Total cost: $${costTracker.getTotalCost().toFixed(6)}`)
			console.log(`  Total calls: ${costTracker.getCallCount()}`)
		}
		server.close()
		process.exit(0)
	})
}
