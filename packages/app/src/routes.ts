import type { Agent } from '@elsium-ai/agents'
import { ElsiumError } from '@elsium-ai/core'
import type { Gateway } from '@elsium-ai/gateway'
import type { Tracer } from '@elsium-ai/observe'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { streamResponse } from './sse'
import type {
	ChatRequest,
	ChatResponse,
	CompleteRequest,
	HealthResponse,
	MetricsResponse,
} from './types'

function parseJsonBody<T>(raw: string): { ok: true; data: T } | { ok: false } {
	try {
		return { ok: true, data: JSON.parse(raw) as T }
	} catch {
		return { ok: false }
	}
}

function elsiumErrorResponse(c: Context, err: unknown, fallbackMessage: string) {
	if (err instanceof ElsiumError) {
		return c.json({ error: err.message, code: err.code }, (err.statusCode ?? 500) as 500)
	}
	return c.json({ error: fallbackMessage }, 500)
}

function resolveAgent(
	name: string | undefined,
	agents: Map<string, Agent>,
	defaultAgent?: Agent,
): { agent: Agent } | { error: string } {
	const agent = name ? agents.get(name) : defaultAgent
	if (agent) return { agent }
	return { error: name ? `Agent "${name}" not found` : 'No default agent configured' }
}

const MAX_BODY_SIZE = 1_048_576

function parseRequestBody<T>(
	c: Context,
	rawText: string,
): { ok: true; data: T } | { ok: false; response: Response } {
	if (rawText.length > MAX_BODY_SIZE) {
		return { ok: false, response: c.json({ error: 'Request body too large (max 1MB)' }, 413) }
	}
	const parsed = parseJsonBody<T>(rawText)
	if (!parsed.ok) {
		return { ok: false, response: c.json({ error: 'Invalid JSON in request body' }, 400) }
	}
	return { ok: true, data: parsed.data }
}

function buildChatResponse(
	result: Awaited<ReturnType<Agent['run']>>,
	model: string | undefined,
): ChatResponse {
	const content = typeof result.message.content === 'string' ? result.message.content : ''
	return {
		message: content,
		usage: {
			inputTokens: result.usage.totalInputTokens,
			outputTokens: result.usage.totalOutputTokens,
			totalTokens: result.usage.totalTokens,
			cost: result.usage.totalCost,
		},
		model: model ?? 'default',
		traceId: result.traceId,
	}
}

export interface RoutesDeps {
	gateway: Gateway
	agents: Map<string, Agent>
	defaultAgent?: Agent
	tracer?: Tracer
	startTime: number
	version: string
	providers: string[]
}

export function createRoutes(deps: RoutesDeps): Hono {
	const app = new Hono()
	let totalRequests = 0

	// ─── Health ────────────────────────────────────────────────

	app.get('/health', (c) => {
		const response: HealthResponse = {
			status: 'ok',
			version: deps.version,
			uptime: Math.round((Date.now() - deps.startTime) / 1000),
			providers: deps.providers,
		}
		return c.json(response)
	})

	// ─── Metrics ──────────────────────────────────────────────

	app.get('/metrics', (c) => {
		const costReport = deps.tracer?.getCostReport()

		const byModel: MetricsResponse['byModel'] = {}
		if (costReport?.byModel) {
			for (const [model, data] of Object.entries(costReport.byModel)) {
				byModel[model] = {
					requests: data.calls,
					tokens: data.tokens,
					cost: data.cost,
				}
			}
		}

		const response: MetricsResponse = {
			uptime: Math.round((Date.now() - deps.startTime) / 1000),
			totalRequests,
			totalTokens: costReport?.totalTokens ?? 0,
			totalCost: costReport?.totalCost ?? 0,
			byModel,
		}
		return c.json(response)
	})

	// ─── Chat ─────────────────────────────────────────────────

	app.post('/chat', async (c) => {
		totalRequests++

		const rawText = await c.req.text()
		const parsed = parseRequestBody<ChatRequest>(c, rawText)
		if (!parsed.ok) return parsed.response

		const body = parsed.data
		if (!body.message) {
			return c.json({ error: 'message is required' }, 400)
		}

		const resolved = resolveAgent(body.agent, deps.agents, deps.defaultAgent)
		if ('error' in resolved) {
			return c.json({ error: resolved.error }, 404)
		}

		if (body.stream) {
			const stream = deps.gateway.stream({
				messages: [{ role: 'user', content: body.message }],
				system: resolved.agent.config.system,
				model: resolved.agent.config.model,
			})
			return streamResponse(c, stream)
		}

		let result: Awaited<ReturnType<Agent['run']>>
		try {
			result = await resolved.agent.run(body.message)
		} catch (err) {
			return elsiumErrorResponse(c, err, 'Agent execution failed')
		}

		deps.tracer?.trackLLMCall({
			model: resolved.agent.config.model ?? 'unknown',
			inputTokens: result.usage.totalInputTokens,
			outputTokens: result.usage.totalOutputTokens,
			cost: result.usage.totalCost,
			latencyMs: 0,
		})

		return c.json(buildChatResponse(result, resolved.agent.config.model))
	})

	// ─── Complete ─────────────────────────────────────────────

	app.post('/complete', async (c) => {
		totalRequests++

		const rawText = await c.req.text()
		const parsed = parseRequestBody<CompleteRequest>(c, rawText)
		if (!parsed.ok) return parsed.response

		const body = parsed.data

		if (!body.messages?.length) {
			return c.json({ error: 'messages array is required' }, 400)
		}

		const messages = body.messages.map((m) => ({
			role: m.role as 'user' | 'assistant' | 'system',
			content: m.content,
		}))

		if (body.stream) {
			const stream = deps.gateway.stream({
				messages,
				model: body.model,
				system: body.system,
				maxTokens: body.maxTokens,
				temperature: body.temperature,
			})
			return streamResponse(c, stream)
		}

		let response: Awaited<ReturnType<Gateway['complete']>>
		try {
			response = await deps.gateway.complete({
				messages,
				model: body.model,
				system: body.system,
				maxTokens: body.maxTokens,
				temperature: body.temperature,
			})
		} catch (err) {
			return elsiumErrorResponse(c, err, 'Completion failed')
		}

		deps.tracer?.trackLLMCall({
			model: response.model,
			inputTokens: response.usage.inputTokens,
			outputTokens: response.usage.outputTokens,
			cost: response.cost.totalCost,
			latencyMs: response.latencyMs,
		})

		return c.json({
			id: response.id,
			message: response.message.content,
			model: response.model,
			usage: response.usage,
			cost: response.cost,
			traceId: response.traceId,
		})
	})

	// ─── List Agents ──────────────────────────────────────────

	app.get('/agents', (c) => {
		const agents = Array.from(deps.agents.entries()).map(([name, agent]) => ({
			name,
			model: agent.config.model ?? 'default',
			tools: agent.config.tools?.map((t) => t.name) ?? [],
		}))
		return c.json({ agents })
	})

	return app
}
