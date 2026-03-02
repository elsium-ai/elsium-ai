import type {
	CompletionRequest,
	LLMResponse,
	Middleware,
	MiddlewareContext,
	ProviderConfig,
	StreamEvent,
	XRayData,
} from '@elsium-ai/core'
import { ElsiumError, type ElsiumStream, createStream, generateTraceId } from '@elsium-ai/core'
import type { z } from 'zod'
import { composeMiddleware, xrayMiddleware } from './middleware'
import type { XRayStore } from './middleware'
import { calculateCost, registerPricing } from './pricing'
import type { LLMProvider } from './provider'
import { registerProviderMetadata } from './provider'
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

export function registerProviderFactory(
	name: string,
	factory: (config: ProviderConfig) => LLMProvider,
): void {
	PROVIDER_FACTORIES[name] = factory
}

// ─── Extracted helpers ───────────────────────────────────────────

function validateGatewayConfig(config: GatewayConfig): (config: ProviderConfig) => LLMProvider {
	const factory = PROVIDER_FACTORIES[config.provider]
	if (!factory) {
		throw new ElsiumError({
			code: 'CONFIG_ERROR',
			message: `Unknown provider: ${config.provider}. Available: ${Object.keys(PROVIDER_FACTORIES).join(', ')}`,
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

			return provider.stream(req)
		},

		async generate<T>(
			request: CompletionRequest & { schema: z.ZodType<T> },
		): Promise<{ data: T; response: LLMResponse }> {
			const { schema, ...rest } = request

			const jsonSchema = schemaToJsonSchema(schema)
			const systemPrompt = [
				rest.system ?? '',
				'You MUST respond with valid JSON matching this schema:',
				JSON.stringify(jsonSchema, null, 2),
				'Respond ONLY with the JSON object, no markdown or explanation.',
			]
				.filter(Boolean)
				.join('\n\n')

			const response = await executeWithMiddleware({
				...rest,
				system: systemPrompt,
			})

			const text = typeof response.message.content === 'string' ? response.message.content : ''

			const jsonMatch = text.match(/\{[\s\S]*\}/)
			if (!jsonMatch) {
				throw ElsiumError.validation('LLM response did not contain valid JSON', {
					response: text,
				})
			}

			const parsed = JSON.parse(jsonMatch[0])
			const result = schema.safeParse(parsed)

			if (!result.success) {
				throw ElsiumError.validation('LLM response did not match schema', {
					errors: result.error.issues,
					response: text,
				})
			}

			return { data: result.data, response }
		},
	}
}

/**
 * Lightweight Zod-to-JSON-Schema for structured output prompts.
 * Uses Zod's internal `_def` — see packages/tools/src/define.ts for the full version.
 */
function schemaToJsonSchema(schema: z.ZodType): Record<string, unknown> {
	try {
		if ('_def' in schema) {
			const def = schema._def as Record<string, unknown>
			const result = convertZodDef(def)
			if (result) return result
		}
	} catch {
		// fallback
	}

	return { type: 'string' }
}

function zodDefKind(def: Record<string, unknown>): string | undefined {
	return typeof def.type === 'string' ? (def.type as string) : (def.typeName as string | undefined)
}

function convertZodDef(def: Record<string, unknown>): Record<string, unknown> | null {
	const kind = zodDefKind(def)
	switch (kind) {
		case 'object':
		case 'ZodObject':
			return convertZodObject(def)
		case 'string':
		case 'ZodString':
			return { type: 'string' }
		case 'number':
		case 'ZodNumber':
			return { type: 'number' }
		case 'boolean':
		case 'ZodBoolean':
			return { type: 'boolean' }
		case 'array':
		case 'ZodArray':
			return convertZodArray(def)
		case 'enum':
		case 'ZodEnum': {
			const values =
				(def.values as string[]) ??
				(def.entries ? Object.values(def.entries as Record<string, string>) : [])
			return { type: 'string', enum: values }
		}
		case 'optional':
		case 'ZodOptional':
			return convertZodOptional(def)
		default:
			return null
	}
}

function convertZodObject(def: Record<string, unknown>): Record<string, unknown> | null {
	if (!def.shape) return null

	const shape =
		typeof def.shape === 'function'
			? (def.shape as () => Record<string, unknown>)()
			: (def.shape as Record<string, unknown>)
	const properties: Record<string, unknown> = {}
	const required: string[] = []

	for (const [key, value] of Object.entries(shape)) {
		properties[key] = schemaToJsonSchema(value as z.ZodType)
		const valDef = (value as z.ZodType)._def as Record<string, unknown>
		const valKind = zodDefKind(valDef)
		if (valKind !== 'optional' && valKind !== 'ZodOptional') {
			required.push(key)
		}
	}

	return { type: 'object', properties, required }
}

function convertZodArray(def: Record<string, unknown>): Record<string, unknown> {
	return {
		type: 'array',
		items: schemaToJsonSchema((def.element ?? def.type) as z.ZodType),
	}
}

function convertZodOptional(def: Record<string, unknown>): Record<string, unknown> {
	return schemaToJsonSchema(
		(def.innerType as z.ZodType) ?? (def as Record<string, unknown>).innerType,
	)
}
