import type { ToolDefinition } from '@elsium-ai/core'
import { ElsiumError, generateId, zodToJsonSchema } from '@elsium-ai/core'
import type { z } from 'zod'
import { createWorkerSandboxRunner } from './sandbox/runner'
import type { SandboxConfig, SandboxRunner } from './sandbox/types'

export interface ToolConfig<TInput = unknown, TOutput = unknown> {
	name: string
	description: string
	input?: z.ZodType<TInput>
	parameters?: z.ZodType<TInput>
	output?: z.ZodType<TOutput>
	handler?: (input: TInput, context: ToolContext) => Promise<TOutput>
	timeoutMs?: number
	sandbox?: SandboxConfig
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
	readonly sandbox?: SandboxConfig

	execute(input: unknown, context?: Partial<ToolContext>): Promise<ToolExecutionResult<TOutput>>
	toDefinition(): ToolDefinition
	dispose?(): Promise<void>
}

export interface ToolExecutionResult<T = unknown> {
	success: boolean
	data?: T
	error?: string
	toolCallId: string
	durationMs: number
}

function formatZodErrors(error: z.ZodError): string {
	return error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')
}

function buildExecutionFailure<T>(
	toolCallId: string,
	startTime: number,
	error: string,
): ToolExecutionResult<T> {
	return {
		success: false,
		error,
		toolCallId,
		durationMs: Math.round(performance.now() - startTime),
	}
}

function buildExecutionSuccess<T>(
	toolCallId: string,
	startTime: number,
	data: T,
): ToolExecutionResult<T> {
	return {
		success: true,
		data,
		toolCallId,
		durationMs: Math.round(performance.now() - startTime),
	}
}

export function defineTool<TInput, TOutput>(
	config: ToolConfig<TInput, TOutput>,
): Tool<TInput, TOutput> {
	const input = config.input ?? config.parameters
	if (!input) {
		throw ElsiumError.validation(
			`Tool "${config.name}" requires an input schema (use "input" or "parameters" key)`,
		)
	}
	if (!config.handler && !config.sandbox) {
		throw ElsiumError.validation(
			`Tool "${config.name}" requires either an inline "handler" or a "sandbox" config`,
		)
	}
	if (config.sandbox && config.sandbox.mode !== 'worker') {
		throw ElsiumError.validation(
			`Tool "${config.name}" sandbox.mode must be "worker" (received "${(config.sandbox as { mode: string }).mode}")`,
		)
	}

	const { name, description, output, sandbox, timeoutMs = 30_000 } = config
	const handler = config.handler

	let sandboxRunner: SandboxRunner | null = null
	function getSandboxRunner(): SandboxRunner {
		if (!sandboxRunner) {
			if (!sandbox) {
				throw ElsiumError.validation(`Tool "${name}" has no sandbox config`)
			}
			sandboxRunner = createWorkerSandboxRunner(sandbox, timeoutMs)
		}
		return sandboxRunner
	}

	async function runHandler(parsedInput: TInput, context: ToolContext): Promise<TOutput> {
		if (sandbox) {
			const result = await getSandboxRunner().invoke(parsedInput, context.signal)
			return result as TOutput
		}
		if (!handler) {
			throw ElsiumError.validation(`Tool "${name}" has no handler`)
		}
		return handler(parsedInput, context)
	}

	const tool: Tool<TInput, TOutput> = {
		name,
		description,
		inputSchema: input,
		outputSchema: output,
		timeoutMs,
		sandbox,

		async execute(
			rawInput: unknown,
			partialCtx?: Partial<ToolContext>,
		): Promise<ToolExecutionResult<TOutput>> {
			const toolCallId = partialCtx?.toolCallId ?? generateId('tc')
			const startTime = performance.now()

			const parsed = input.safeParse(rawInput)
			if (!parsed.success) {
				return buildExecutionFailure(
					toolCallId,
					startTime,
					`Invalid input: ${formatZodErrors(parsed.error)}`,
				)
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
					runHandler(parsed.data, context),
					new Promise<never>((_, reject) => {
						context.signal?.addEventListener('abort', () => {
							reject(ElsiumError.timeout(name, timeoutMs))
						})
					}),
				])

				if (output) {
					const validated = output.safeParse(result)
					if (!validated.success) {
						return buildExecutionFailure(
							toolCallId,
							startTime,
							`Invalid output: ${formatZodErrors(validated.error)}`,
						)
					}
				}

				return buildExecutionSuccess(toolCallId, startTime, result)
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				return buildExecutionFailure(toolCallId, startTime, message)
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

		async dispose(): Promise<void> {
			if (sandboxRunner) {
				const r = sandboxRunner
				sandboxRunner = null
				await r.dispose()
			}
		},
	}

	return tool
}
