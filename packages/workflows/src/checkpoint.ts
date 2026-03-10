import { ElsiumError, generateId } from '@elsium-ai/core'
import { executeStep } from './step'
import type {
	StepContext,
	StepResult,
	WorkflowConfig,
	WorkflowResult,
	WorkflowRunOptions,
} from './types'

export interface WorkflowCheckpoint {
	workflowId: string
	workflowName: string
	status: 'running' | 'completed' | 'failed' | 'paused'
	input: unknown
	currentStepIndex: number
	stepResults: StepResult[]
	outputs: Record<string, unknown>
	createdAt: number
	updatedAt: number
}

export interface CheckpointStore {
	save(checkpoint: WorkflowCheckpoint): Promise<void>
	load(workflowId: string): Promise<WorkflowCheckpoint | null>
	delete(workflowId: string): Promise<void>
	list(workflowName?: string): Promise<WorkflowCheckpoint[]>
}

export function createInMemoryCheckpointStore(): CheckpointStore {
	const store = new Map<string, WorkflowCheckpoint>()

	return {
		async save(checkpoint) {
			store.set(checkpoint.workflowId, { ...checkpoint })
		},

		async load(workflowId) {
			const cp = store.get(workflowId)
			return cp ? { ...cp } : null
		},

		async delete(workflowId) {
			store.delete(workflowId)
		},

		async list(workflowName?) {
			const all = Array.from(store.values())
			if (workflowName) return all.filter((c) => c.workflowName === workflowName)
			return all
		},
	}
}

export interface ResumableWorkflowConfig extends WorkflowConfig {
	checkpointStore: CheckpointStore
}

export interface ResumableWorkflow {
	readonly name: string
	run(input: unknown, options?: ResumableWorkflowRunOptions): Promise<WorkflowResult>
	resume(workflowId: string, options?: WorkflowRunOptions): Promise<WorkflowResult>
	getCheckpoint(workflowId: string): Promise<WorkflowCheckpoint | null>
	listCheckpoints(): Promise<WorkflowCheckpoint[]>
}

export interface ResumableWorkflowRunOptions extends WorkflowRunOptions {
	workflowId?: string
}

async function getCreatedAt(store: CheckpointStore, workflowId: string): Promise<number> {
	const existing = await store.load(workflowId)
	return existing?.createdAt ?? Date.now()
}

export function defineResumableWorkflow(config: ResumableWorkflowConfig): ResumableWorkflow {
	const { checkpointStore } = config

	async function executeFromStep(
		workflowId: string,
		input: unknown,
		startIndex: number,
		existingResults: StepResult[],
		existingOutputs: Record<string, unknown>,
		options?: WorkflowRunOptions,
	): Promise<WorkflowResult> {
		const startTime = performance.now()
		const stepResults = [...existingResults]
		const outputs = { ...existingOutputs }
		let currentInput =
			startIndex > 0 ? (outputs[config.steps[startIndex - 1].name] ?? input) : input

		const createdAt = await getCreatedAt(checkpointStore, workflowId)

		for (let i = startIndex; i < config.steps.length; i++) {
			const stepConfig = config.steps[i]

			await checkpointStore.save({
				workflowId,
				workflowName: config.name,
				status: 'running',
				input,
				currentStepIndex: i,
				stepResults: [...stepResults],
				outputs: { ...outputs },
				createdAt,
				updatedAt: Date.now(),
			})

			const context: StepContext = {
				workflowName: config.name,
				stepIndex: i,
				previousOutputs: { ...outputs },
				signal: options?.signal,
			}

			const result = await executeStep(stepConfig, currentInput, context)
			stepResults.push(result)

			if (result.status === 'completed' && result.data !== undefined) {
				outputs[stepConfig.name] = result.data
				currentInput = result.data
			}

			await config.onStepComplete?.(result)

			if (result.status === 'failed') {
				await config.onStepError?.(new Error(result.error ?? 'Step failed'), stepConfig.name)

				await checkpointStore.save({
					workflowId,
					workflowName: config.name,
					status: 'failed',
					input,
					currentStepIndex: i,
					stepResults: [...stepResults],
					outputs: { ...outputs },
					createdAt,
					updatedAt: Date.now(),
				})

				const workflowResult: WorkflowResult = {
					name: config.name,
					status: 'failed',
					steps: stepResults,
					totalDurationMs: Math.round(performance.now() - startTime),
					outputs,
				}

				await config.onComplete?.(workflowResult)
				return workflowResult
			}
		}

		await checkpointStore.save({
			workflowId,
			workflowName: config.name,
			status: 'completed',
			input,
			currentStepIndex: config.steps.length,
			stepResults: [...stepResults],
			outputs: { ...outputs },
			createdAt,
			updatedAt: Date.now(),
		})

		const workflowResult: WorkflowResult = {
			name: config.name,
			status: 'completed',
			steps: stepResults,
			totalDurationMs: Math.round(performance.now() - startTime),
			outputs,
		}

		await config.onComplete?.(workflowResult)
		return workflowResult
	}

	return {
		name: config.name,

		async run(input, options = {}) {
			const workflowId = options.workflowId ?? generateId('wf')
			return executeFromStep(workflowId, input, 0, [], {}, options)
		},

		async resume(workflowId, options = {}) {
			const checkpoint = await checkpointStore.load(workflowId)
			if (!checkpoint) {
				throw new ElsiumError({
					code: 'VALIDATION_ERROR',
					message: `No checkpoint found for workflow "${workflowId}"`,
					retryable: false,
				})
			}
			if (checkpoint.status === 'completed') {
				return {
					name: config.name,
					status: 'completed' as const,
					steps: checkpoint.stepResults,
					totalDurationMs: 0,
					outputs: checkpoint.outputs,
				}
			}

			const resumeIndex = checkpoint.currentStepIndex

			return executeFromStep(
				workflowId,
				checkpoint.input,
				resumeIndex,
				checkpoint.stepResults.slice(0, resumeIndex),
				checkpoint.outputs,
				options,
			)
		},

		async getCheckpoint(workflowId) {
			return checkpointStore.load(workflowId)
		},

		async listCheckpoints() {
			return checkpointStore.list(config.name)
		},
	}
}
