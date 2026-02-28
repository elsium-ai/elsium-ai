import { executeStep } from './step'
import type {
	StepConfig,
	StepContext,
	StepResult,
	WorkflowConfig,
	WorkflowResult,
	WorkflowRunOptions,
} from './types'

export interface Workflow {
	readonly name: string
	run(input: unknown, options?: WorkflowRunOptions): Promise<WorkflowResult>
}

export function defineWorkflow(config: WorkflowConfig): Workflow {
	return {
		name: config.name,

		async run(input: unknown, options?: WorkflowRunOptions): Promise<WorkflowResult> {
			const startTime = performance.now()
			const stepResults: StepResult[] = []
			const outputs: Record<string, unknown> = {}
			let currentInput = input

			for (let i = 0; i < config.steps.length; i++) {
				const stepConfig = config.steps[i]

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

			const workflowResult: WorkflowResult = {
				name: config.name,
				status: 'completed',
				steps: stepResults,
				totalDurationMs: Math.round(performance.now() - startTime),
				outputs,
			}

			await config.onComplete?.(workflowResult)
			return workflowResult
		},
	}
}

// ─── Parallel Workflow ───────────────────────────────────────────

export interface ParallelWorkflowConfig {
	name: string
	steps: StepConfig[]
	onComplete?: (result: WorkflowResult) => void | Promise<void>
}

export function defineParallelWorkflow(config: ParallelWorkflowConfig): Workflow {
	return {
		name: config.name,

		async run(input: unknown, options?: WorkflowRunOptions): Promise<WorkflowResult> {
			const startTime = performance.now()

			const resultPromises = config.steps.map((stepConfig, i) => {
				const context: StepContext = {
					workflowName: config.name,
					stepIndex: i,
					previousOutputs: {},
					signal: options?.signal,
				}
				return executeStep(stepConfig, input, context)
			})

			const stepResults = await Promise.all(resultPromises)
			const outputs: Record<string, unknown> = {}
			let failed = false

			for (let i = 0; i < stepResults.length; i++) {
				const result = stepResults[i]
				if (result.status === 'completed' && result.data !== undefined) {
					outputs[config.steps[i].name] = result.data
				}
				if (result.status === 'failed') {
					failed = true
				}
			}

			const workflowResult: WorkflowResult = {
				name: config.name,
				status: failed ? 'failed' : 'completed',
				steps: stepResults,
				totalDurationMs: Math.round(performance.now() - startTime),
				outputs,
			}

			await config.onComplete?.(workflowResult)
			return workflowResult
		},
	}
}

// ─── Conditional Workflow ────────────────────────────────────────

export interface BranchConfig {
	condition: (input: unknown) => boolean
	workflow: Workflow
}

export function defineBranchWorkflow(
	name: string,
	branches: BranchConfig[],
	fallback?: Workflow,
): Workflow {
	return {
		name,

		async run(input: unknown, options?: WorkflowRunOptions): Promise<WorkflowResult> {
			for (const branch of branches) {
				if (branch.condition(input)) {
					return branch.workflow.run(input, options)
				}
			}

			if (fallback) {
				return fallback.run(input, options)
			}

			return {
				name,
				status: 'completed',
				steps: [],
				totalDurationMs: 0,
				outputs: {},
			}
		},
	}
}
