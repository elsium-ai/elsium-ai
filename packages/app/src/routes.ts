import type { Agent } from '@elsium-ai/agents'
import type { Gateway } from '@elsium-ai/gateway'
import type { Tracer } from '@elsium-ai/observe'
import { Hono } from 'hono'
import type {
	ChatRequest,
	ChatResponse,
	CompleteRequest,
	HealthResponse,
	MetricsResponse,
} from './types'

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

		const body = await c.req.json<ChatRequest>()

		if (!body.message) {
			return c.json({ error: 'message is required' }, 400)
		}

		const agent = body.agent ? deps.agents.get(body.agent) : deps.defaultAgent

		if (!agent) {
			const available = Array.from(deps.agents.keys())
			return c.json(
				{
					error: body.agent
						? `Agent "${body.agent}" not found. Available: ${available.join(', ')}`
						: 'No default agent configured',
				},
				404,
			)
		}

		const result = await agent.run(body.message)

		deps.tracer?.trackLLMCall({
			model: 'unknown',
			inputTokens: result.usage.totalInputTokens,
			outputTokens: result.usage.totalOutputTokens,
			cost: result.usage.totalCost,
			latencyMs: 0,
		})

		const content = typeof result.message.content === 'string' ? result.message.content : ''

		const response: ChatResponse = {
			message: content,
			usage: {
				inputTokens: result.usage.totalInputTokens,
				outputTokens: result.usage.totalOutputTokens,
				totalTokens: result.usage.totalTokens,
				cost: result.usage.totalCost,
			},
			model: agent.config.model ?? 'default',
			traceId: result.traceId,
		}

		return c.json(response)
	})

	// ─── Complete ─────────────────────────────────────────────

	app.post('/complete', async (c) => {
		totalRequests++

		const body = await c.req.json<CompleteRequest>()

		if (!body.messages?.length) {
			return c.json({ error: 'messages array is required' }, 400)
		}

		const messages = body.messages.map((m) => ({
			role: m.role as 'user' | 'assistant' | 'system',
			content: m.content,
		}))

		const response = await deps.gateway.complete({
			messages,
			model: body.model,
			system: body.system,
			maxTokens: body.maxTokens,
			temperature: body.temperature,
		})

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
