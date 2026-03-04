import type { ToolDefinition } from '@elsium-ai/core'
import { ElsiumError, generateId, zodToJsonSchema } from '@elsium-ai/core'
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
