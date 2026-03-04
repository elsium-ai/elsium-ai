import type {
	CompletionRequest,
	LLMResponse,
	Middleware,
	MiddlewareContext,
	ProviderConfig,
	StreamEvent,
	StreamMiddleware,
	XRayData,
} from '@elsium-ai/core'
import {
	ElsiumError,
	type ElsiumStream,
	createStream,
	generateTraceId,
	zodToJsonSchema,
} from '@elsium-ai/core'
import type { z } from 'zod'
import { composeMiddleware, composeStreamMiddleware, xrayMiddleware } from './middleware'
import type { XRayStore } from './middleware'
import { calculateCost, registerPricing } from './pricing'
import type { LLMProvider } from './provider'
import { getProviderFactory, listProviders, registerProviderMetadata } from './provider'
import { createAnthropicProvider } from './providers/anthropic'
import { createGoogleProvider } from './providers/google'
import { createOpenAIProvider } from './providers/openai'

export interface GatewayConfig {
	provider: string
	model?: string
	apiKey: string
	baseUrl?: string
	timeout?: number
	maxRetries?: number
	middleware?: Middleware[]
	streamMiddleware?: StreamMiddleware[]
	xray?: boolean | { maxHistory?: number }
	maxMessages?: number
	maxInputTokens?: number
}

export interface Gateway {
	complete(request: CompletionRequest): Promise<LLMResponse>
	stream(request: CompletionRequest): ElsiumStream
	generate<T>(request: CompletionRequest & { schema: z.ZodType<T> }): Promise<{
		data: T
		response: LLMResponse
	}>
	readonly provider: LLMProvider
	lastCall(): XRayData | null
	callHistory(limit?: number): XRayData[]
}

const PROVIDER_FACTORIES: Record<string, (config: ProviderConfig) => LLMProvider> = {
	anthropic: createAnthropicProvider,
	openai: createOpenAIProvider,
	google: createGoogleProvider,
}

// Register built-in provider metadata at module load so getProviderMetadata() works
// without requiring a gateway instance to be created first
registerProviderMetadata('anthropic', {
	baseUrl: 'https://api.anthropic.com/v1/messages',
	capabilities: ['tools', 'vision', 'streaming', 'system'],
	authStyle: 'x-api-key',
})
registerProviderMetadata('openai', {
	baseUrl: 'https://api.openai.com/v1/chat/completions',
	capabilities: ['tools', 'vision', 'streaming', 'system', 'json_mode'],
	authStyle: 'bearer',
})
registerProviderMetadata('google', {
	baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
	capabilities: ['tools', 'vision', 'streaming', 'system'],
	authStyle: 'bearer',
})

export function registerProviderFactory(
	name: string,
	factory: (config: ProviderConfig) => LLMProvider,
): void {
	PROVIDER_FACTORIES[name] = factory
}

// ─── Extracted helpers ───────────────────────────────────────────

function validateGatewayConfig(config: GatewayConfig): (config: ProviderConfig) => LLMProvider {
	const factory = PROVIDER_FACTORIES[config.provider] ?? getProviderFactory(config.provider)
	if (!factory) {
		const available = [...Object.keys(PROVIDER_FACTORIES), ...listProviders()]
		const unique = [...new Set(available)]
		throw new ElsiumError({
			code: 'CONFIG_ERROR',
			message: `Unknown provider: ${config.provider}. Available: ${unique.join(', ')}`,
			retryable: false,
		})
	}

	if (typeof config.apiKey !== 'string' || config.apiKey.trim() === '') {
		throw new ElsiumError({
			code: 'CONFIG_ERROR',
			message: 'apiKey must be a non-empty string',
			retryable: false,
		})
	}

	if (config.timeout !== undefined && (!Number.isFinite(config.timeout) || config.timeout <= 0)) {
		throw new ElsiumError({
			code: 'CONFIG_ERROR',
			message: 'timeout must be a positive finite number',
			retryable: false,
		})
	}

	if (
		config.maxRetries !== undefined &&
		(!Number.isFinite(config.maxRetries) ||
			!Number.isInteger(config.maxRetries) ||
			config.maxRetries < 0)
	) {
		throw new ElsiumError({
			code: 'CONFIG_ERROR',
			message: 'maxRetries must be a non-negative finite integer',
			retryable: false,
		})
	}

	return factory
}

function autoRegisterProvider(provider: LLMProvider): void {
	if (!provider.metadata) return
	registerProviderMetadata(provider.name, provider.metadata)
	if (!provider.metadata.pricing) return
	for (const [model, pricing] of Object.entries(provider.metadata.pricing)) {
		registerPricing(model, pricing)
	}
}

function validateRequestLimits(
	request: CompletionRequest,
	maxMessages: number,
	maxInputTokens: number,
): void {
	if (request.messages.length > maxMessages) {
		throw ElsiumError.validation(
			`Message count ${request.messages.length} exceeds limit of ${maxMessages}`,
		)
	}
	let estimatedTokens = 0
	for (const msg of request.messages) {
		const text =
			typeof msg.content === 'string'
				? msg.content
				: msg.content.map((p) => (p.type === 'text' ? p.text : '')).join('')
		estimatedTokens += Math.ceil(text.length / 4)
	}
	if (estimatedTokens > maxInputTokens) {
		throw ElsiumError.validation(
			`Estimated input tokens (~${estimatedTokens}) exceeds limit of ${maxInputTokens}`,
		)
	}
}

function buildMiddlewareContext(
	req: CompletionRequest,
	providerName: string,
	defaultModel: string,
	metadata: Record<string, unknown>,
): MiddlewareContext {
	return {
		request: req,
		provider: providerName,
		model: req.model ?? defaultModel,
		traceId: generateTraceId(),
		startTime: performance.now(),
		metadata,
	}
}

interface StreamAccumulator {
	textContent: string
	usage: LLMResponse['usage']
	stopReason: LLMResponse['stopReason']
	id: string
}

async function accumulateStreamEvents(
	stream: AsyncIterable<StreamEvent>,
	emit: (event: StreamEvent) => void,
): Promise<StreamAccumulator> {
	let textContent = ''
	let usage: LLMResponse['usage'] = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
	let stopReason: LLMResponse['stopReason'] = 'end_turn'
	let id = ''

	for await (const event of stream) {
		emit(event)
		if (event.type === 'text_delta') {
			textContent += event.text
		} else if (event.type === 'message_end') {
			usage = event.usage
			stopReason = event.stopReason
		} else if (event.type === 'message_start') {
			id = event.id
		}
	}

	return { textContent, usage, stopReason, id }
}

// ─── Main gateway factory ────────────────────────────────────────

export function gateway(config: GatewayConfig): Gateway {
	const factory = validateGatewayConfig(config)

	const provider = factory({
		apiKey: config.apiKey,
		baseUrl: config.baseUrl,
		timeout: config.timeout,
		maxRetries: config.maxRetries,
	})

	autoRegisterProvider(provider)

	const defaultModel = config.model ?? provider.defaultModel
	const maxMessages = config.maxMessages ?? 1000
	const maxInputTokens = config.maxInputTokens ?? 1_000_000

	let xrayStore: XRayStore | null = null
	const allMiddleware: Middleware[] = [...(config.middleware ?? [])]

	if (config.xray) {
		const xrayOpts = typeof config.xray === 'object' ? config.xray : {}
		const xm = xrayMiddleware(xrayOpts)
		xrayStore = xm
		allMiddleware.push(xm)
	}

	const composedMiddleware = allMiddleware.length ? composeMiddleware(allMiddleware) : null
	const composedStreamMiddleware = config.streamMiddleware?.length
		? composeStreamMiddleware(config.streamMiddleware)
		: null

	async function executeWithMiddleware(request: CompletionRequest): Promise<LLMResponse> {
		const req = { ...request, model: request.model ?? defaultModel }

		if (!composedMiddleware) {
			return provider.complete(req)
		}

		const ctx = buildMiddlewareContext(req, provider.name, defaultModel, request.metadata ?? {})
		return composedMiddleware(ctx, async (c) => provider.complete(c.request))
	}

	return {
		provider,

		lastCall(): XRayData | null {
			return xrayStore?.lastCall() ?? null
		},

		callHistory(limit?: number): XRayData[] {
			return xrayStore?.callHistory(limit) ?? []
		},

		async complete(request: CompletionRequest): Promise<LLMResponse> {
			validateRequestLimits(request, maxMessages, maxInputTokens)
			return executeWithMiddleware(request)
		},

		stream(request: CompletionRequest): ElsiumStream {
			validateRequestLimits(request, maxMessages, maxInputTokens)
			const req = { ...request, model: request.model ?? defaultModel }

			if (composedMiddleware) {
				const ctx = buildMiddlewareContext(req, provider.name, defaultModel, request.metadata ?? {})
				return createStream(async (emit) => {
					await composedMiddleware(ctx, async (c) => {
						const result = await accumulateStreamEvents(provider.stream(c.request), emit)
						const latencyMs = Math.round(performance.now() - ctx.startTime)
						return {
							id: result.id,
							message: { role: 'assistant' as const, content: result.textContent },
							usage: result.usage,
							cost: calculateCost(c.model, result.usage),
							model: c.model,
							provider: provider.name,
							stopReason: result.stopReason,
							latencyMs,
							traceId: ctx.traceId,
						}
					})
				})
			}

			const rawStream = provider.stream(req)
			if (!composedStreamMiddleware) return rawStream

			const ctx = buildMiddlewareContext(req, provider.name, defaultModel, request.metadata ?? {})
			return createStream(async (emit) => {
				const processed = composedStreamMiddleware(ctx, rawStream, (_c, s) => s)
				for await (const event of processed) {
					emit(event)
				}
			})
		},

		async generate<T>(
			request: CompletionRequest & { schema: z.ZodType<T> },
		): Promise<{ data: T; response: LLMResponse }> {
			const { schema, ...rest } = request

			const jsonSchema = zodToJsonSchema(schema)

			// Pass schema to provider for native JSON mode support
			const response = await executeWithMiddleware({
				...rest,
				schema,
				system: [
					rest.system ?? '',
					'You MUST respond with valid JSON matching this schema:',
					JSON.stringify(jsonSchema, null, 2),
					'Respond ONLY with the JSON object, no markdown or explanation.',
				]
					.filter(Boolean)
					.join('\n\n'),
			})

			// Extract structured data — check tool call result first (Anthropic approach),
			// then try parsing text content
			let parsed: unknown

			if (response.stopReason === 'tool_use' && response.message.toolCalls?.length) {
				const structuredCall = response.message.toolCalls.find(
					(tc) => tc.name === '_structured_output',
				)
				if (structuredCall) {
					parsed = structuredCall.arguments
				}
			}

			if (parsed === undefined) {
				let text = typeof response.message.content === 'string' ? response.message.content : ''
				// Strip markdown code fences
				text = text.replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/gm, '$1').trim()
				const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
				if (!jsonMatch) {
					throw ElsiumError.validation('LLM response did not contain valid JSON', {
						response: text,
					})
				}
				parsed = JSON.parse(jsonMatch[0])
			}

			const result = schema.safeParse(parsed)
			if (!result.success) {
				throw ElsiumError.validation('LLM response did not match schema', {
					errors: result.error.issues,
				})
			}

			return { data: result.data, response }
		},
	}
}
