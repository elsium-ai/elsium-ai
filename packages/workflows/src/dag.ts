import { executeStep } from './step'
import type {
	DagStepConfig,
	DagWorkflowConfig,
	StepContext,
	StepResult,
	WorkflowResult,
	WorkflowRunOptions,
} from './types'
import type { Workflow } from './workflow'

function topologicalSort(steps: DagStepConfig[]): string[][] {
	const stepMap = new Map(steps.map((s) => [s.name, s]))
	const inDegree = new Map<string, number>()
	const dependents = new Map<string, string[]>()

	for (const step of steps) {
		inDegree.set(step.name, 0)
		dependents.set(step.name, [])
	}

	for (const step of steps) {
		for (const dep of step.dependsOn ?? []) {
			if (!stepMap.has(dep)) {
				throw new Error(`Step "${step.name}" depends on unknown step "${dep}"`)
			}
			inDegree.set(step.name, (inDegree.get(step.name) ?? 0) + 1)
			dependents.get(dep)?.push(step.name)
		}
	}

	const waves: string[][] = []
	const resolved = new Set<string>()

	while (resolved.size < steps.length) {
		const wave: string[] = []

		for (const [name, degree] of inDegree) {
			if (degree === 0 && !resolved.has(name)) {
				wave.push(name)
			}
		}

		if (wave.length === 0) {
			const remaining = steps.filter((s) => !resolved.has(s.name)).map((s) => s.name)
			throw new Error(`Cycle detected in DAG workflow. Remaining steps: ${remaining.join(', ')}`)
		}

		for (const name of wave) {
			resolved.add(name)
			for (const dep of dependents.get(name) ?? []) {
				inDegree.set(dep, (inDegree.get(dep) ?? 0) - 1)
			}
		}

		waves.push(wave)
	}

	return waves
}

export function defineDagWorkflow(config: DagWorkflowConfig): Workflow {
	const stepMap = new Map(config.steps.map((s) => [s.name, s]))

	return {
		name: config.name,

		async run(input: unknown, options?: WorkflowRunOptions): Promise<WorkflowResult> {
			const startTime = performance.now()
			const waves = topologicalSort(config.steps)
			const stepResults: StepResult[] = []
			const outputs: Record<string, unknown> = {}
			let failed = false

			for (const wave of waves) {
				const wavePromises = wave
					.map((stepName) => stepMap.get(stepName))
					.filter((s): s is DagStepConfig => s !== undefined)
					.map(async (stepConfig) => {
						const deps = stepConfig.dependsOn ?? []

						// Use first dependency output as input, or initial input
						const stepInput = deps.length > 0 ? (outputs[deps[0]] ?? input) : input

						const context: StepContext = {
							workflowName: config.name,
							stepIndex: config.steps.indexOf(stepConfig),
							previousOutputs: { ...outputs },
							signal: options?.signal,
						}

						return executeStep(stepConfig, stepInput, context)
					})

				const waveResults = await Promise.all(wavePromises)

				for (let i = 0; i < waveResults.length; i++) {
					const result = waveResults[i]
					const stepName = wave[i]
					stepResults.push(result)

					if (result.status === 'completed' && result.data !== undefined) {
						outputs[stepName] = result.data
					}

					await config.onStepComplete?.(result)

					if (result.status === 'failed') {
						failed = true
						await config.onStepError?.(new Error(result.error ?? 'Step failed'), stepName)
					}
				}

				if (failed) break
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
