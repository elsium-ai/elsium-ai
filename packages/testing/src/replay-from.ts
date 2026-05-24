import { ElsiumError, generateId } from '@elsium-ai/core'

export interface TraceStep<TInput = unknown, TOutput = unknown> {
	key: string
	input: TInput
	output: TOutput
	startedAt: number
	durationMs: number
	metadata?: Record<string, unknown>
}

export interface AgentTrace {
	id: string
	agentId?: string
	startedAt: number
	endedAt?: number
	steps: TraceStep[]
}

export interface TraceRecorder {
	readonly traceId: string
	recordStep<TIn, TOut>(args: {
		key: string
		input: TIn
		output: TOut
		startedAt?: number
		durationMs?: number
		metadata?: Record<string, unknown>
	}): TraceStep<TIn, TOut>
	finish(): AgentTrace
	readonly steps: ReadonlyArray<TraceStep>
}

export interface TraceRecorderConfig {
	agentId?: string
	traceId?: string
	clock?: () => number
}

export function createTraceRecorder(config: TraceRecorderConfig = {}): TraceRecorder {
	const clock = config.clock ?? (() => Date.now())
	const traceId = config.traceId ?? `trace_${generateId('').slice(1)}`
	const startedAt = clock()
	const steps: TraceStep[] = []

	return {
		traceId,
		get steps() {
			return steps
		},
		recordStep({ key, input, output, startedAt: stepStart, durationMs, metadata }) {
			const now = clock()
			const step: TraceStep<unknown, unknown> = {
				key,
				input,
				output,
				startedAt: stepStart ?? now,
				durationMs: durationMs ?? 0,
				metadata,
			}
			steps.push(step)
			return step as TraceStep<typeof input, typeof output>
		},
		finish() {
			return {
				id: traceId,
				agentId: config.agentId,
				startedAt,
				endedAt: clock(),
				steps: steps.slice(),
			}
		},
	}
}

export type StepExecutor<TInput = unknown, TOutput = unknown> = (args: {
	key: string
	input: TInput
	originalStep: TraceStep<TInput, TOutput> | undefined
}) => Promise<TOutput> | TOutput

export type StepOverride<TInput = unknown, TOutput = unknown> =
	| { kind: 'replace'; output: TOutput }
	| { kind: 'transform'; input?: (input: TInput) => TInput; output?: (output: TOutput) => TOutput }

export interface ReplayFromOptions<TInput = unknown, TOutput = unknown> {
	fromStep: number | string
	executor: StepExecutor<TInput, TOutput>
	overrides?: Record<string, StepOverride<TInput, TOutput>>
}

export interface ReplayedStep<TInput = unknown, TOutput = unknown>
	extends TraceStep<TInput, TOutput> {
	source: 'replay' | 'live'
	overridden: boolean
}

export interface ReplayResult<TInput = unknown, TOutput = unknown> {
	traceId: string
	steps: ReplayedStep<TInput, TOutput>[]
	finalOutput: TOutput | undefined
}

function resolveFromStepIndex(trace: AgentTrace, fromStep: number | string): number {
	if (typeof fromStep === 'number') {
		if (fromStep < 0 || fromStep > trace.steps.length) {
			throw new ElsiumError({
				code: 'VALIDATION_ERROR',
				message: `replayFrom: fromStep ${fromStep} out of range [0, ${trace.steps.length}]`,
				retryable: false,
			})
		}
		return fromStep
	}
	const idx = trace.steps.findIndex((s) => s.key === fromStep)
	if (idx < 0) {
		throw new ElsiumError({
			code: 'VALIDATION_ERROR',
			message: `replayFrom: step key "${fromStep}" not found in trace`,
			retryable: false,
		})
	}
	return idx
}

async function runLiveStep<TInput, TOutput>(
	originalStep: TraceStep<TInput, TOutput> | undefined,
	input: TInput,
	key: string,
	executor: StepExecutor<TInput, TOutput>,
	override: StepOverride<TInput, TOutput> | undefined,
): Promise<{ output: TOutput; overridden: boolean }> {
	if (override?.kind === 'replace') {
		return { output: override.output, overridden: true }
	}
	const effectiveInput =
		override?.kind === 'transform' && override.input ? override.input(input) : input
	const raw = await executor({ key, input: effectiveInput, originalStep })
	const output: TOutput =
		override?.kind === 'transform' && override.output
			? override.output(raw as TOutput)
			: (raw as TOutput)
	return { output, overridden: !!override }
}

export async function replayFrom<TInput = unknown, TOutput = unknown>(
	trace: AgentTrace,
	options: ReplayFromOptions<TInput, TOutput>,
): Promise<ReplayResult<TInput, TOutput>> {
	const fromIndex = resolveFromStepIndex(trace, options.fromStep)
	const overrides = options.overrides ?? {}
	const out: ReplayedStep<TInput, TOutput>[] = []
	let finalOutput: TOutput | undefined

	for (let i = 0; i < trace.steps.length; i++) {
		const recorded = trace.steps[i] as TraceStep<TInput, TOutput>
		if (i < fromIndex) {
			out.push({ ...recorded, source: 'replay', overridden: false })
			finalOutput = recorded.output
			continue
		}

		const override = overrides[recorded.key]
		const startedAt = Date.now()
		const { output, overridden } = await runLiveStep(
			recorded,
			recorded.input,
			recorded.key,
			options.executor,
			override,
		)

		out.push({
			...recorded,
			input: recorded.input,
			output,
			startedAt,
			durationMs: Date.now() - startedAt,
			source: 'live',
			overridden,
		})
		finalOutput = output
	}

	return {
		traceId: trace.id,
		steps: out,
		finalOutput,
	}
}
