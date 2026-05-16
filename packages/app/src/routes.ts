import type { Agent } from '@elsium-ai/agents'
import { ElsiumError } from '@elsium-ai/core'
import type { Gateway, ProviderMesh } from '@elsium-ai/gateway'
import type { Tracer } from '@elsium-ai/observe'
import type { ServerAdapter } from './adapter'
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

function elsiumErrorResponse(
	adapter: ServerAdapter,
	c: unknown,
	err: unknown,
	fallbackMessage: string,
) {
	if (err instanceof ElsiumError) {
		return adapter.json(
			c,
			{ error: err.message, code: err.code },
			(err.statusCode ?? 500) as number,
		)
	}
	return adapter.json(c, { error: fallbackMessage }, 500)
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
	adapter: ServerAdapter,
	c: unknown,
	rawText: string,
): { ok: true; data: T } | { ok: false; response: Response } {
	if (rawText.length > MAX_BODY_SIZE) {
		return {
			ok: false,
			response: adapter.json(c, { error: 'Request body too large (max 1MB)' }, 413),
		}
	}
	const parsed = parseJsonBody<T>(rawText)
	if (!parsed.ok) {
		return { ok: false, response: adapter.json(c, { error: 'Invalid JSON in request body' }, 400) }
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
	mesh?: ProviderMesh
	agents: Map<string, Agent>
	defaultAgent?: Agent
	tracer?: Tracer
	startTime: number
	version: string
	providers: string[]
}

export function createRoutes<TInstance>(
	adapter: ServerAdapter<TInstance>,
	deps: RoutesDeps,
): TInstance {
	const app = adapter.createSubRouter()
	let totalRequests = 0

	adapter.get(app, '/health', (c) => {
		const response: HealthResponse = {
			status: 'ok',
			version: deps.version,
			uptime: Math.round((Date.now() - deps.startTime) / 1000),
			providers: deps.providers,
		}
		return adapter.json(c, response)
	})

	adapter.get(app, '/metrics', (c) => {
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
		return adapter.json(c, response)
	})

	adapter.post(app, '/chat', async (c) => {
		totalRequests++

		const rawText = await adapter.bodyText(c)
		const parsed = parseRequestBody<ChatRequest>(adapter, c, rawText)
		if (!parsed.ok) return parsed.response

		const body = parsed.data
		if (!body.message) {
			return adapter.json(c, { error: 'message is required' }, 400)
		}

		const resolved = resolveAgent(body.agent, deps.agents, deps.defaultAgent)
		if ('error' in resolved) {
			return adapter.json(c, { error: resolved.error }, 404)
		}

		if (body.stream) {
			const streamSource = deps.mesh ?? deps.gateway
			const agentStream = streamSource.stream({
				messages: [{ role: 'user', content: body.message }],
				system: resolved.agent.config.system,
				model: resolved.agent.config.model,
			})
			return adapter.streamResponse(c, agentStream)
		}

		let result: Awaited<ReturnType<Agent['run']>>
		try {
			result = await resolved.agent.run(body.message)
		} catch (err) {
			return elsiumErrorResponse(adapter, c, err, 'Agent execution failed')
		}

		deps.tracer?.trackLLMCall({
			model: resolved.agent.config.model ?? 'unknown',
			inputTokens: result.usage.totalInputTokens,
			outputTokens: result.usage.totalOutputTokens,
			cost: result.usage.totalCost,
			latencyMs: 0,
		})

		return adapter.json(c, buildChatResponse(result, resolved.agent.config.model))
	})

	adapter.post(app, '/complete', async (c) => {
		totalRequests++

		const rawText = await adapter.bodyText(c)
		const parsed = parseRequestBody<CompleteRequest>(adapter, c, rawText)
		if (!parsed.ok) return parsed.response

		const body = parsed.data

		if (!body.messages?.length) {
			return adapter.json(c, { error: 'messages array is required' }, 400)
		}

		const messages = body.messages.map((m) => ({
			role: m.role as 'user' | 'assistant' | 'system',
			content: m.content,
		}))

		const completeSource = deps.mesh ?? deps.gateway

		if (body.stream) {
			const stream = completeSource.stream({
				messages,
				model: body.model,
				system: body.system,
				maxTokens: body.maxTokens,
				temperature: body.temperature,
			})
			return adapter.streamResponse(c, stream)
		}

		let response: Awaited<ReturnType<Gateway['complete']>>
		try {
			response = await completeSource.complete({
				messages,
				model: body.model,
				system: body.system,
				maxTokens: body.maxTokens,
				temperature: body.temperature,
			})
		} catch (err) {
			return elsiumErrorResponse(adapter, c, err, 'Completion failed')
		}

		deps.tracer?.trackLLMCall({
			model: response.model,
			inputTokens: response.usage.inputTokens,
			outputTokens: response.usage.outputTokens,
			cost: response.cost.totalCost,
			latencyMs: response.latencyMs,
		})

		return adapter.json(c, {
			id: response.id,
			message: response.message.content,
			model: response.model,
			usage: response.usage,
			cost: response.cost,
			traceId: response.traceId,
		})
	})

	adapter.get(app, '/agents', (c) => {
		const agents = Array.from(deps.agents.entries()).map(([name, agent]) => ({
			name,
			model: agent.config.model ?? 'default',
			tools: agent.config.tools?.map((t) => t.name) ?? [],
		}))
		return adapter.json(c, { agents })
	})

	return app
}
