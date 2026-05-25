import type { ToolDefinition } from '@elsium-ai/core'
import {
	ElsiumError,
	createLogger,
	generateId,
	isAgentPauseSignal,
	zodToJsonSchema,
} from '@elsium-ai/core'
import type { z } from 'zod'
import type {
	ApprovalHandler,
	IdempotencyStore,
	PreconditionFailure,
	PreconditionFn,
	RequireApproval,
	SideEffectLevel,
} from './contracts'
import { createSandboxRunner } from './sandbox/runner'
import type { SandboxConfig, SandboxRunner } from './sandbox/types'

const log = createLogger()

const IS_BUN =
	typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined' ||
	(typeof process !== 'undefined' &&
		Boolean((process.versions as Record<string, string | undefined>).bun))

let bunSandboxWarningShown = false

function warnBunSandboxOnce(toolName: string): void {
	if (bunSandboxWarningShown) return
	bunSandboxWarningShown = true
	log.warn(
		`Tool "${toolName}" uses sandbox.mode="worker" under Bun. Crash isolation is incomplete on Bun: process.exit() inside the handler does NOT terminate the worker (it does on Node). Switch to sandbox.mode="process" for full crash-isolation parity under Bun. Other guarantees (process, memory, closure-state, timeout, abort) hold.`,
	)
}

export interface ToolConfig<TInput = unknown, TOutput = unknown> {
	name: string
	description: string
	input?: z.ZodType<TInput>
	parameters?: z.ZodType<TInput>
	output?: z.ZodType<TOutput>
	handler?: (input: TInput, context: ToolContext) => Promise<TOutput>
	timeoutMs?: number
	sandbox?: SandboxConfig
	sideEffectLevel?: SideEffectLevel
	idempotencyKey?: (input: TInput) => string
	idempotencyStore?: IdempotencyStore
	preconditions?: Array<{ name: string; check: PreconditionFn<TInput> }>
	dryRunHandler?: (input: TInput, context: ToolContext) => Promise<TOutput> | TOutput
	requireApproval?: RequireApproval
}

export interface ToolContext {
	toolCallId: string
	traceId?: string
	signal?: AbortSignal
	dryRun?: boolean
	requestApproval?: ApprovalHandler
}

export interface Tool<TInput = unknown, TOutput = unknown> {
	readonly name: string
	readonly description: string
	readonly inputSchema: z.ZodType<TInput>
	readonly outputSchema?: z.ZodType<TOutput>
	readonly rawSchema?: Record<string, unknown>
	readonly timeoutMs: number
	readonly sandbox?: SandboxConfig
	readonly sideEffectLevel?: SideEffectLevel

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
	dryRun?: boolean
	idempotent?: boolean
	preconditionFailures?: PreconditionFailure[]
	approvalDenied?: boolean
	approvalReason?: string
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

function wireUserSignalToController(
	controller: AbortController,
	userSignal: AbortSignal | undefined,
): void {
	if (!userSignal) return
	if (userSignal.aborted) {
		controller.abort()
		return
	}
	userSignal.addEventListener('abort', () => controller.abort(), { once: true })
}

function createAbortRejection(
	signal: AbortSignal,
	isTimeout: () => boolean,
	name: string,
	timeoutMs: number,
): Promise<never> {
	return new Promise<never>((_, reject) => {
		signal.addEventListener(
			'abort',
			() => {
				if (isTimeout()) {
					reject(ElsiumError.timeout(name, timeoutMs))
				} else {
					reject(
						new ElsiumError({
							code: 'TOOL_ERROR',
							message: `Tool "${name}" was aborted`,
							retryable: false,
						}),
					)
				}
			},
			{ once: true },
		)
	})
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
	if (config.sandbox) {
		const mode = config.sandbox.mode
		if (mode !== 'worker' && mode !== 'process') {
			throw ElsiumError.validation(`Unknown sandbox mode: "${mode}"`)
		}
		if (IS_BUN && mode === 'worker') {
			warnBunSandboxOnce(config.name)
		}
	}

	const {
		name,
		description,
		output,
		sandbox,
		timeoutMs = 30_000,
		sideEffectLevel,
		idempotencyKey,
		idempotencyStore,
		preconditions,
		dryRunHandler,
		requireApproval = 'auto',
	} = config
	const handler = config.handler

	let sandboxRunner: SandboxRunner | null = null
	function getSandboxRunner(): SandboxRunner {
		if (!sandboxRunner) {
			if (!sandbox) {
				throw ElsiumError.validation(`Tool "${name}" has no sandbox config`)
			}
			sandboxRunner = createSandboxRunner(sandbox, timeoutMs)
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

	async function runPreconditions(
		parsedInput: TInput,
		context: ToolContext,
	): Promise<PreconditionFailure[]> {
		if (!preconditions?.length) return []
		const failures: PreconditionFailure[] = []
		for (const { name: ruleName, check } of preconditions) {
			const result = await check(parsedInput, {
				toolCallId: context.toolCallId,
				traceId: context.traceId,
			})
			if (!result.ok)
				failures.push({ name: ruleName, reason: result.reason ?? 'precondition failed' })
		}
		return failures
	}

	function shouldDryRun(context: ToolContext): boolean {
		if (!context.dryRun) return false
		if (!sideEffectLevel) return true
		return sideEffectLevel !== 'read'
	}

	function approvalNeeded(context: ToolContext): boolean {
		if (context.dryRun) return false
		if (requireApproval === 'never') return false
		if (requireApproval === 'always') return true
		return sideEffectLevel === 'destructive'
	}

	async function runApprovalGate(
		parsedInput: TInput,
		context: ToolContext,
		toolCallId: string,
		startTime: number,
	): Promise<ToolExecutionResult<TOutput> | null> {
		if (!approvalNeeded(context)) return null
		const handler = context.requestApproval
		if (!handler) {
			if (requireApproval === 'always' || sideEffectLevel === 'destructive') {
				log.warn(
					`Tool "${name}" requires approval (sideEffectLevel="${sideEffectLevel ?? 'unset'}", requireApproval="${requireApproval}") but no requestApproval handler was provided on the context. Proceeding without approval — wire context.requestApproval to enforce.`,
				)
			}
			return null
		}
		const decision = await handler({
			toolName: name,
			toolCallId,
			traceId: context.traceId,
			sideEffectLevel,
			input: parsedInput,
		})
		if (decision.status !== 'approved') {
			return {
				...buildExecutionFailure<TOutput>(
					toolCallId,
					startTime,
					`approval denied${decision.reason ? `: ${decision.reason}` : ''}`,
				),
				approvalDenied: true,
				approvalReason: decision.reason,
			}
		}
		return null
	}

	async function checkPreconditionsGate(
		parsedInput: TInput,
		context: ToolContext,
		toolCallId: string,
		startTime: number,
	): Promise<ToolExecutionResult<TOutput> | null> {
		const preFailures = await runPreconditions(parsedInput, context)
		if (preFailures.length === 0) return null
		const message = preFailures.map((f) => `${f.name}: ${f.reason}`).join('; ')
		return {
			...buildExecutionFailure<TOutput>(toolCallId, startTime, `precondition denied: ${message}`),
			preconditionFailures: preFailures,
		}
	}

	async function checkDryRunGate(
		parsedInput: TInput,
		context: ToolContext,
		toolCallId: string,
		startTime: number,
	): Promise<ToolExecutionResult<TOutput> | null> {
		if (!shouldDryRun(context)) return null
		const preview = dryRunHandler
			? await dryRunHandler(parsedInput, context)
			: (undefined as unknown as TOutput)
		return { ...buildExecutionSuccess(toolCallId, startTime, preview), dryRun: true }
	}

	async function checkIdempotencyGate(
		parsedInput: TInput,
		toolCallId: string,
		startTime: number,
	): Promise<ToolExecutionResult<TOutput> | null> {
		const idemKey = idempotencyKey ? idempotencyKey(parsedInput) : undefined
		if (!idemKey || !idempotencyStore) return null
		const cached = await idempotencyStore.get<TOutput>(name, idemKey)
		if (!cached) return null
		return { ...buildExecutionSuccess(toolCallId, startTime, cached.output), idempotent: true }
	}

	async function runPreGates(
		parsedInput: TInput,
		context: ToolContext,
		toolCallId: string,
		startTime: number,
	): Promise<ToolExecutionResult<TOutput> | null> {
		const pre = await checkPreconditionsGate(parsedInput, context, toolCallId, startTime)
		if (pre) return pre
		const approval = await runApprovalGate(parsedInput, context, toolCallId, startTime)
		if (approval) return approval
		const dry = await checkDryRunGate(parsedInput, context, toolCallId, startTime)
		if (dry) return dry
		return checkIdempotencyGate(parsedInput, toolCallId, startTime)
	}

	async function validateAndPersist(
		parsedInput: TInput,
		result: TOutput,
		toolCallId: string,
		startTime: number,
	): Promise<ToolExecutionResult<TOutput>> {
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

		const idemKey = idempotencyKey ? idempotencyKey(parsedInput) : undefined
		if (idemKey && idempotencyStore) {
			await idempotencyStore.put(name, idemKey, result)
		}

		return buildExecutionSuccess(toolCallId, startTime, result)
	}

	const tool: Tool<TInput, TOutput> = {
		name,
		description,
		inputSchema: input,
		outputSchema: output,
		timeoutMs,
		sandbox,
		sideEffectLevel,

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
			let timedOut = false
			const timer = setTimeout(() => {
				timedOut = true
				controller.abort()
			}, timeoutMs)

			wireUserSignalToController(controller, partialCtx?.signal)

			const context: ToolContext = {
				toolCallId,
				traceId: partialCtx?.traceId,
				signal: controller.signal,
				dryRun: partialCtx?.dryRun,
				requestApproval: partialCtx?.requestApproval,
			}

			try {
				const preGate = await runPreGates(parsed.data, context, toolCallId, startTime)
				if (preGate) return preGate

				const result = await Promise.race([
					runHandler(parsed.data, context),
					createAbortRejection(controller.signal, () => timedOut, name, timeoutMs),
				])

				const outputFailure = validateAndPersist(parsed.data, result, toolCallId, startTime)
				const resolved = await outputFailure
				return resolved
			} catch (error) {
				if (isAgentPauseSignal(error)) throw error
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
