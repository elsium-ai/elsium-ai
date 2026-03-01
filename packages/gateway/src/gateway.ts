import type {
	CompletionRequest,
	LLMResponse,
	Middleware,
	MiddlewareContext,
	ProviderConfig,
	XRayData,
} from '@elsium-ai/core'
import { ElsiumError, type ElsiumStream, createStream, generateTraceId } from '@elsium-ai/core'
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

			// Run pre-call middleware (security, policy) before the stream starts
			if (composedMiddleware) {
				const ctx: MiddlewareContext = {
					request: req,
					provider: provider.name,
					model: req.model ?? defaultModel,
					traceId: generateTraceId(),
					startTime: performance.now(),
					metadata: request.metadata ?? {},
				}

				// Return a stream that first validates via middleware, then streams
				return createStream(async (emit) => {
					await composedMiddleware(ctx, async (c) => {
						const stream = provider.stream(c.request)
						for await (const event of stream) {
							emit(event)
						}
						// Return a dummy LLMResponse to satisfy middleware chain type
						return {
							id: '',
							message: { role: 'assistant' as const, content: '' },
							usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
							cost: { inputCost: 0, outputCost: 0, totalCost: 0, currency: 'USD' as const },
							model: c.model,
							provider: provider.name,
							stopReason: 'end_turn' as const,
							latencyMs: 0,
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
