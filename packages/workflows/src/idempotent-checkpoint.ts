/**
 * Idempotent workflow checkpoints (R1).
 *
 * Adds per-step deduplication to ResumableWorkflow so that side-effectful
 * steps (POST to external API, write to DB, send email, …) do not re-run
 * when a workflow is resumed from a checkpoint after a crash.
 *
 * Design:
 *  - IdempotentCheckpointStore extends CheckpointStore with three new
 *    methods: getStepResult / recordStepResult / listStepHistory, keyed
 *    by (workflowId, stepName, idempotencyKey).
 *  - Steps opt in via IdempotentStepConfig { idempotent: true,
 *    idempotencyKey?: (input) => string }. Default key when omitted is
 *    a stable SHA-256 over the input JSON.
 *  - Wrap a step with `wrapIdempotent(step, store)` to get an executor
 *    that checks the store before calling the underlying handler.
 *
 * Persistence: this package ships ONLY the in-memory adapter
 * (createInMemoryIdempotentCheckpointStore). For durability across
 * process restarts, the user implements IdempotentCheckpointStore
 * against their chosen backend. See docs/guides/persistent-stores.md.
 */

import { ElsiumError, sha256Hex } from '@elsium-ai/core'
import { type CheckpointStore, createInMemoryCheckpointStore } from './checkpoint'
import { executeStep } from './step'
import type { StepConfig, StepContext, StepResult } from './types'

// ─── Step execution records ─────────────────────────────────────

export interface StepExecutionRecord {
	readonly workflowId: string
	readonly stepName: string
	readonly idempotencyKey: string
	readonly status: 'completed' | 'failed' | 'skipped'
	readonly result: unknown
	readonly error?: string
	readonly executedAt: number
	readonly durationMs: number
}

// ─── Port (extends CheckpointStore) ─────────────────────────────

export interface IdempotentCheckpointStore extends CheckpointStore {
	getStepResult(
		workflowId: string,
		stepName: string,
		idempotencyKey: string,
	): Promise<StepExecutionRecord | null>
	recordStepResult(record: StepExecutionRecord): Promise<void>
	listStepHistory(workflowId: string): Promise<readonly StepExecutionRecord[]>
}

// ─── Step config extension ──────────────────────────────────────

export interface IdempotentStepConfig<TInput = unknown, TOutput = unknown>
	extends StepConfig<TInput, TOutput> {
	readonly idempotent?: boolean
	readonly idempotencyKey?: (input: TInput) => string
}

// ─── Default key derivation ─────────────────────────────────────

function stableStringify(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value)
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
	const keys = Object.keys(value as Record<string, unknown>).sort()
	const pairs = keys.map(
		(k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`,
	)
	return `{${pairs.join(',')}}`
}

export async function defaultIdempotencyKey(input: unknown): Promise<string> {
	return sha256Hex(stableStringify(input))
}

export async function resolveIdempotencyKey<TInput>(
	step: IdempotentStepConfig<TInput, unknown>,
	input: TInput,
): Promise<string | null> {
	if (!step.idempotent) return null
	return step.idempotencyKey ? step.idempotencyKey(input) : defaultIdempotencyKey(input)
}

// ─── In-memory reference adapter ────────────────────────────────

export function createInMemoryIdempotentCheckpointStore(): IdempotentCheckpointStore {
	const base = createInMemoryCheckpointStore()
	// Map from `${workflowId}::${stepName}::${idempotencyKey}` to the record.
	const stepResults = new Map<string, StepExecutionRecord>()

	function key(workflowId: string, stepName: string, idempotencyKey: string): string {
		return `${workflowId}::${stepName}::${idempotencyKey}`
	}

	return {
		...base,

		async getStepResult(workflowId, stepName, idempotencyKey) {
			const r = stepResults.get(key(workflowId, stepName, idempotencyKey))
			return r ? { ...r } : null
		},

		async recordStepResult(record) {
			stepResults.set(key(record.workflowId, record.stepName, record.idempotencyKey), {
				...record,
			})
		},

		async listStepHistory(workflowId) {
			const out: StepExecutionRecord[] = []
			for (const r of stepResults.values()) {
				if (r.workflowId === workflowId) out.push({ ...r })
			}
			return out
		},

		// We can't simply delegate to a fresh in-memory `base`; the user
		// expects a single coherent store. So we also wire delete() to
		// clear matching step results.
		async delete(workflowId) {
			await base.delete(workflowId)
			for (const k of [...stepResults.keys()]) {
				if (k.startsWith(`${workflowId}::`)) stepResults.delete(k)
			}
		},
	}
}

// ─── Executor that consults the store before running the step ───

export interface ExecuteIdempotentStepArgs<TInput, TOutput> {
	readonly workflowId: string
	readonly step: IdempotentStepConfig<TInput, TOutput>
	readonly input: unknown
	readonly context: StepContext
	readonly store: IdempotentCheckpointStore
}

function cachedResultToStepResult<TOutput>(
	cached: StepExecutionRecord,
	stepName: string,
): StepResult<TOutput> {
	if (cached.status === 'failed') {
		return {
			name: stepName,
			status: 'failed',
			error: cached.error ?? 'Cached failure with no error message',
			durationMs: 0,
			retryCount: 0,
		}
	}
	if (cached.status === 'skipped') {
		return {
			name: stepName,
			status: 'skipped',
			durationMs: 0,
			retryCount: 0,
		}
	}
	return {
		name: stepName,
		status: 'completed',
		data: cached.result as TOutput,
		durationMs: 0,
		retryCount: 0,
	}
}

function buildExecutionRecord(
	workflowId: string,
	stepName: string,
	idempotencyKey: string,
	result: StepResult<unknown>,
	durationMs: number,
): StepExecutionRecord {
	let status: StepExecutionRecord['status'] = 'failed'
	if (result.status === 'completed') status = 'completed'
	else if (result.status === 'skipped') status = 'skipped'

	return {
		workflowId,
		stepName,
		idempotencyKey,
		status,
		result: result.status === 'completed' ? result.data : undefined,
		error: result.status === 'failed' ? (result.error ?? 'unknown error') : undefined,
		executedAt: Date.now(),
		durationMs,
	}
}

export async function executeIdempotentStep<TInput, TOutput>(
	args: ExecuteIdempotentStepArgs<TInput, TOutput>,
): Promise<StepResult<TOutput>> {
	const { workflowId, step, input, context, store } = args

	const idempotencyKey = await resolveIdempotencyKey(step, input as TInput)
	if (idempotencyKey === null) {
		return executeStep(step, input, context)
	}

	const cached = await store.getStepResult(workflowId, step.name, idempotencyKey)
	if (cached) {
		return cachedResultToStepResult<TOutput>(cached, step.name)
	}

	const start = performance.now()
	const result = await executeStep(step, input, context)
	const record = buildExecutionRecord(
		workflowId,
		step.name,
		idempotencyKey,
		result,
		Math.round(performance.now() - start),
	)

	try {
		await store.recordStepResult(record)
	} catch (err) {
		throw ElsiumError.validation(
			`Failed to record idempotent step result for "${step.name}": ${err instanceof Error ? err.message : String(err)}`,
		)
	}

	return result
}
