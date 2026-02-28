import type {
	CompletionRequest,
	LLMResponse,
	Middleware,
	MiddlewareContext,
	ProviderConfig,
	XRayData,
} from '@elsium-ai/core'
import { ElsiumError, type ElsiumStream, generateTraceId } from '@elsium-ai/core'
import type { z } from 'zod'
import { composeMiddleware, xrayMiddleware } from './middleware'
import type { XRayStore } from './middleware'
import type { LLMProvider } from './provider'
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

export function gateway(config: GatewayConfig): Gateway {
	const factory = PROVIDER_FACTORIES[config.provider]
	if (!factory) {
		throw new ElsiumError({
			code: 'CONFIG_ERROR',
			message: `Unknown provider: ${config.provider}. Available: ${Object.keys(PROVIDER_FACTORIES).join(', ')}`,
			retryable: false,
		})
	}

	const provider = factory({
		apiKey: config.apiKey,
		baseUrl: config.baseUrl,
		timeout: config.timeout,
		maxRetries: config.maxRetries,
	})

	const defaultModel = config.model ?? provider.defaultModel

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

		const ctx: MiddlewareContext = {
			request: req,
			provider: provider.name,
			model: req.model ?? defaultModel,
			traceId: generateTraceId(),
			startTime: performance.now(),
			metadata: request.metadata ?? {},
		}

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
			return executeWithMiddleware(request)
		},

		stream(request: CompletionRequest): ElsiumStream {
			const req = { ...request, model: request.model ?? defaultModel }
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

function schemaToJsonSchema(schema: z.ZodType): Record<string, unknown> {
	try {
		if ('_def' in schema) {
			const def = schema._def as Record<string, unknown>
			if (def.typeName === 'ZodObject' && def.shape) {
				const shape =
					typeof def.shape === 'function'
						? (def.shape as () => Record<string, unknown>)()
						: (def.shape as Record<string, unknown>)
				const properties: Record<string, unknown> = {}
				const required: string[] = []

				for (const [key, value] of Object.entries(shape)) {
					properties[key] = schemaToJsonSchema(value as z.ZodType)
					const valDef = (value as z.ZodType)._def as Record<string, unknown>
					if (valDef.typeName !== 'ZodOptional') {
						required.push(key)
					}
				}

				return { type: 'object', properties, required }
			}
			if (def.typeName === 'ZodString') return { type: 'string' }
			if (def.typeName === 'ZodNumber') return { type: 'number' }
			if (def.typeName === 'ZodBoolean') return { type: 'boolean' }
			if (def.typeName === 'ZodArray') {
				return {
					type: 'array',
					items: schemaToJsonSchema(
						(def.type as z.ZodType) ?? (def as Record<string, unknown>).type,
					),
				}
			}
			if (def.typeName === 'ZodEnum') {
				return { type: 'string', enum: def.values }
			}
			if (def.typeName === 'ZodOptional') {
				return schemaToJsonSchema(
					(def.innerType as z.ZodType) ?? (def as Record<string, unknown>).innerType,
				)
			}
		}
	} catch {
		// fallback
	}

	return { type: 'string' }
}
