import type { ToolDefinition } from '@elsium-ai/core'
import { ElsiumError, generateId } from '@elsium-ai/core'
import type { z } from 'zod'

export interface ToolConfig<TInput = unknown, TOutput = unknown> {
	name: string
	description: string
	input: z.ZodType<TInput>
	output?: z.ZodType<TOutput>
	handler: (input: TInput, context: ToolContext) => Promise<TOutput>
	timeoutMs?: number
}

export interface ToolContext {
	toolCallId: string
	traceId?: string
	signal?: AbortSignal
}

export interface Tool<TInput = unknown, TOutput = unknown> {
	readonly name: string
	readonly description: string
	readonly inputSchema: z.ZodType<TInput>
	readonly outputSchema?: z.ZodType<TOutput>
	readonly rawSchema?: Record<string, unknown>
	readonly timeoutMs: number

	execute(input: unknown, context?: Partial<ToolContext>): Promise<ToolExecutionResult<TOutput>>
	toDefinition(): ToolDefinition
}

export interface ToolExecutionResult<T = unknown> {
	success: boolean
	data?: T
	error?: string
	toolCallId: string
	durationMs: number
}

export function defineTool<TInput, TOutput>(
	config: ToolConfig<TInput, TOutput>,
): Tool<TInput, TOutput> {
	const { name, description, input, output, handler, timeoutMs = 30_000 } = config

	return {
		name,
		description,
		inputSchema: input,
		outputSchema: output,
		timeoutMs,

		async execute(
			rawInput: unknown,
			partialCtx?: Partial<ToolContext>,
		): Promise<ToolExecutionResult<TOutput>> {
			const toolCallId = partialCtx?.toolCallId ?? generateId('tc')
			const startTime = performance.now()

			const parsed = input.safeParse(rawInput)
			if (!parsed.success) {
				return {
					success: false,
					error: `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')}`,
					toolCallId,
					durationMs: Math.round(performance.now() - startTime),
				}
			}

			const controller = new AbortController()
			const timer = setTimeout(() => controller.abort(), timeoutMs)

			const context: ToolContext = {
				toolCallId,
				traceId: partialCtx?.traceId,
				signal: partialCtx?.signal ?? controller.signal,
			}

			try {
				const result = await Promise.race([
					handler(parsed.data, context),
					new Promise<never>((_, reject) => {
						controller.signal.addEventListener('abort', () => {
							reject(ElsiumError.timeout(name, timeoutMs))
						})
					}),
				])

				if (output) {
					const validated = output.safeParse(result)
					if (!validated.success) {
						return {
							success: false,
							error: `Invalid output: ${validated.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')}`,
							toolCallId,
							durationMs: Math.round(performance.now() - startTime),
						}
					}
				}

				return {
					success: true,
					data: result,
					toolCallId,
					durationMs: Math.round(performance.now() - startTime),
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				return {
					success: false,
					error: message,
					toolCallId,
					durationMs: Math.round(performance.now() - startTime),
				}
			} finally {
				clearTimeout(timer)
			}
		},

		toDefinition(): ToolDefinition {
			return {
				name,
				description,
				inputSchema: zodToJsonSchema(input),
			}
		},
	}
}

/**
 * Converts a Zod schema to JSON Schema for LLM tool definitions.
 * Uses Zod's internal `_def` property — this is the standard community pattern
 * since Zod does not expose a public schema introspection API.
 * Pin Zod minor version in package.json to guard against internal changes.
 */
function zodDefKind(def: Record<string, unknown>): string | undefined {
	return typeof def.type === 'string' ? (def.type as string) : (def.typeName as string | undefined)
}

function zodObjectToJsonSchema(def: Record<string, unknown>): Record<string, unknown> {
	const shape =
		typeof def.shape === 'function'
			? (def.shape as () => Record<string, unknown>)()
			: (def.shape as Record<string, unknown>)
	const properties: Record<string, unknown> = {}
	const required: string[] = []

	for (const [key, value] of Object.entries(shape)) {
		const fieldSchema = value as z.ZodType
		properties[key] = zodToJsonSchema(fieldSchema)
		const fieldDef = fieldSchema._def as Record<string, unknown>
		const fieldKind = zodDefKind(fieldDef)
		if (
			fieldKind !== 'optional' &&
			fieldKind !== 'ZodOptional' &&
			fieldKind !== 'default' &&
			fieldKind !== 'ZodDefault'
		) {
			required.push(key)
		}
		if (fieldDef.description) {
			;(properties[key] as Record<string, unknown>).description = fieldDef.description
		}
	}

	return { type: 'object', properties, required }
}

function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
	if (!('_def' in schema)) return { type: 'object' }

	const def = schema._def as Record<string, unknown>
	const kind = zodDefKind(def)

	switch (kind) {
		case 'object':
		case 'ZodObject':
			return zodObjectToJsonSchema(def)
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
			return {
				type: 'array',
				items: zodToJsonSchema((def.element ?? def.type) as z.ZodType),
			}
		case 'enum':
		case 'ZodEnum': {
			const values =
				(def.values as string[]) ??
				(def.entries ? Object.values(def.entries as Record<string, string>) : [])
			return { type: 'string', enum: values }
		}
		case 'optional':
		case 'ZodOptional':
			return zodToJsonSchema(def.innerType as z.ZodType)
		case 'default':
		case 'ZodDefault':
			return zodToJsonSchema(def.innerType as z.ZodType)
		case 'nullable':
		case 'ZodNullable': {
			const inner = zodToJsonSchema(def.innerType as z.ZodType)
			return { ...inner, nullable: true }
		}
		case 'ZodLiteral':
			return { type: typeof def.value, const: def.value }
		case 'ZodUnion': {
			const options = (def.options as z.ZodType[]).map(zodToJsonSchema)
			return { anyOf: options }
		}
		case 'ZodRecord':
			return {
				type: 'object',
				additionalProperties: def.valueType
					? zodToJsonSchema(def.valueType as z.ZodType)
					: { type: 'string' },
			}
		case 'ZodTuple': {
			const items = ((def.items as z.ZodType[]) ?? []).map(zodToJsonSchema)
			return { type: 'array', prefixItems: items, minItems: items.length, maxItems: items.length }
		}
		case 'ZodDate':
			return { type: 'string', format: 'date-time' }
		default:
			console.warn(`zodToJsonSchema: unsupported type ${kind}, defaulting to string`)
			return { type: 'string' }
	}
}
