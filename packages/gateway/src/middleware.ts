import type {
	LLMResponse,
	Middleware,
	MiddlewareContext,
	MiddlewareNext,
	XRayData,
} from '@elsium-ai/core'
import { createLogger } from '@elsium-ai/core'
import type { Logger } from '@elsium-ai/core'

export function composeMiddleware(middlewares: Middleware[]): Middleware {
	return (ctx, finalNext) => {
		let index = -1

		function dispatch(i: number): Promise<LLMResponse> {
			if (i <= index) {
				return Promise.reject(new Error('Middleware next() called multiple times'))
			}
			index = i

			const fn = i < middlewares.length ? middlewares[i] : finalNext
			if (i === middlewares.length) {
				return finalNext(ctx)
			}

			return fn(ctx, () => dispatch(i + 1))
		}

		return dispatch(0)
	}
}

export function loggingMiddleware(logger?: Logger): Middleware {
	const log = logger ?? createLogger({ level: 'info' })

	return async (ctx, next) => {
		log.info('LLM request', {
			provider: ctx.provider,
			model: ctx.model,
			traceId: ctx.traceId,
			messageCount: ctx.request.messages.length,
		})

		const response = await next(ctx)

		log.info('LLM response', {
			provider: ctx.provider,
			model: ctx.model,
			traceId: ctx.traceId,
			latencyMs: response.latencyMs,
			inputTokens: response.usage.inputTokens,
			outputTokens: response.usage.outputTokens,
			totalCost: response.cost.totalCost,
		})

		return response
	}
}

export function costTrackingMiddleware(): Middleware & {
	getTotalCost(): number
	getTotalTokens(): number
	getCallCount(): number
	reset(): void
} {
	let totalCost = 0
	let totalTokens = 0
	let callCount = 0

	const middleware = async (ctx: MiddlewareContext, next: MiddlewareNext) => {
		const response = await next(ctx)
		totalCost += response.cost.totalCost
		totalTokens += response.usage.totalTokens
		callCount++
		return response
	}

	middleware.getTotalCost = () => totalCost
	middleware.getTotalTokens = () => totalTokens
	middleware.getCallCount = () => callCount
	middleware.reset = () => {
		totalCost = 0
		totalTokens = 0
		callCount = 0
	}

	return middleware
}

// ─── X-Ray Middleware ────────────────────────────────────────────

const SENSITIVE_HEADERS = ['x-api-key', 'authorization', 'api-key']

function redactHeaders(headers: Record<string, string>): Record<string, string> {
	const redacted: Record<string, string> = {}
	for (const [key, value] of Object.entries(headers)) {
		if (SENSITIVE_HEADERS.includes(key.toLowerCase())) {
			// M4 fix: Fully redact sensitive headers — don't leak partial key material
			redacted[key] = '[REDACTED]'
		} else {
			redacted[key] = value
		}
	}
	return redacted
}

export interface XRayStore {
	lastCall(): XRayData | null
	callHistory(limit?: number): XRayData[]
	getByTraceId(traceId: string): XRayData | undefined
	clear(): void
}

export function xrayMiddleware(options: { maxHistory?: number } = {}): Middleware & XRayStore {
	const maxHistory = options.maxHistory ?? 100
	const history: XRayData[] = []

	const middleware = async (ctx: MiddlewareContext, next: MiddlewareNext) => {
		const startTime = performance.now()
		const response = await next(ctx)
		const latencyMs = Math.round(performance.now() - startTime)

		const providerUrls: Record<string, string> = {
			anthropic: 'https://api.anthropic.com/v1/messages',
			openai: 'https://api.openai.com/v1/chat/completions',
			google: 'https://generativelanguage.googleapis.com/v1beta/models',
		}

		const xrayData: XRayData = {
			traceId: ctx.traceId,
			timestamp: Date.now(),
			provider: ctx.provider,
			model: ctx.model,
			latencyMs,
			request: {
				url: providerUrls[ctx.provider] ?? `https://${ctx.provider}.api/v1/messages`,
				method: 'POST',
				headers: redactHeaders({
					'Content-Type': 'application/json',
					...(ctx.provider === 'anthropic'
						? { 'x-api-key': (ctx.metadata._apiKey as string) ?? '***' }
						: {}),
					...(ctx.provider === 'openai' || ctx.provider === 'google'
						? { Authorization: (ctx.metadata._apiKey as string) ?? '***' }
						: {}),
				}),
				body: {
					model: ctx.model,
					messages: ctx.request.messages.map((m) => ({
						role: m.role,
						content:
							typeof m.content === 'string'
								? m.content.slice(0, 200) + (m.content.length > 200 ? '...' : '')
								: '[complex content]',
					})),
					max_tokens: ctx.request.maxTokens,
					...(ctx.request.temperature !== undefined
						? { temperature: ctx.request.temperature }
						: {}),
					...(ctx.request.tools?.length ? { tools: ctx.request.tools.map((t) => t.name) } : {}),
				},
			},
			response: {
				status: 200,
				headers: { 'content-type': 'application/json' },
				body: {
					id: response.id,
					model: response.model,
					stop_reason: response.stopReason,
					content_preview:
						typeof response.message.content === 'string'
							? response.message.content.slice(0, 200) +
								(response.message.content.length > 200 ? '...' : '')
							: '[complex content]',
				},
			},
			usage: response.usage,
			cost: response.cost,
		}

		history.unshift(xrayData)
		if (history.length > maxHistory) {
			history.length = maxHistory
		}

		return response
	}

	middleware.lastCall = (): XRayData | null => history[0] ?? null
	middleware.callHistory = (limit = 10): XRayData[] => history.slice(0, limit)
	middleware.getByTraceId = (traceId: string): XRayData | undefined =>
		history.find((d) => d.traceId === traceId)
	middleware.clear = () => {
		history.length = 0
	}

	return middleware as Middleware & XRayStore
}
