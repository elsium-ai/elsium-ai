import { ElsiumError, createLogger, generateId } from '@elsium-ai/core'
import type { Agent } from './agent'
import type { PersistedTask, TaskStore } from './stores/task-store'
import type { AgentResult, AgentRunOptions } from './types'

const log = createLogger()

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface AgentTask {
	readonly id: string
	readonly agentName: string
	readonly input: string
	readonly status: TaskStatus
	readonly result: AgentResult | null
	readonly error: Error | null
	readonly createdAt: number
	readonly startedAt: number | null
	readonly completedAt: number | null
	readonly metadata: Record<string, unknown>
	cancel(): void
	wait(): Promise<AgentResult>
}

export interface AsyncAgentConfig {
	agent: Agent
	onProgress?: (task: AgentTask, event: TaskProgressEvent) => void
	onComplete?: (task: AgentTask) => void
	onError?: (task: AgentTask, error: Error) => void
	/**
	 * Optional store for durable task records. When set, every task transition
	 * is persisted (fire-and-forget). On process restart the caller can use
	 * `recover()` to surface tasks that were running/pending before.
	 */
	taskStore?: TaskStore
}

export type TaskProgressEvent =
	| { type: 'started'; taskId: string }
	| { type: 'iteration'; taskId: string; iteration: number }
	| { type: 'tool_call'; taskId: string; toolName: string }
	| { type: 'completed'; taskId: string; result: AgentResult }
	| { type: 'failed'; taskId: string; error: Error }
	| { type: 'cancelled'; taskId: string }

export interface AsyncAgent {
	submit(input: string, options?: AsyncAgentRunOptions): AgentTask
	getTask(taskId: string): AgentTask | null
	listTasks(filter?: { status?: TaskStatus }): AgentTask[]
	cancelAll(): void
	/**
	 * Loads tasks left in `pending` or `running` state from a previous process
	 * (requires `taskStore`), marks them as failed in the store with a
	 * "process restart" reason, and returns them so the caller can decide
	 * whether to resubmit or alert. Returns an empty array when no taskStore
	 * is configured or no orphaned tasks exist.
	 */
	recover(): Promise<PersistedTask[]>
}

export interface AsyncAgentRunOptions extends AgentRunOptions {
	taskId?: string
}

export function createAsyncAgent(config: AsyncAgentConfig): AsyncAgent {
	const tasks = new Map<string, MutableTask>()

	interface MutableTask {
		id: string
		agentName: string
		input: string
		status: TaskStatus
		result: AgentResult | null
		error: Error | null
		createdAt: number
		startedAt: number | null
		completedAt: number | null
		metadata: Record<string, unknown>
		abortController: AbortController
		promise: Promise<AgentResult>
		resolve: (result: AgentResult) => void
		reject: (error: Error) => void
	}

	function emitProgress(task: MutableTask, event: TaskProgressEvent) {
		try {
			config.onProgress?.(toPublicTask(task), event)
		} catch {
			/* progress callback errors are swallowed */
		}
	}

	function toPersistedTask(task: MutableTask): PersistedTask {
		return {
			id: task.id,
			agentName: task.agentName,
			input: task.input,
			status: task.status,
			result: task.result,
			error: task.error ? { message: task.error.message, stack: task.error.stack } : null,
			createdAt: task.createdAt,
			startedAt: task.startedAt,
			completedAt: task.completedAt,
			metadata: task.metadata,
		}
	}

	function persistTask(task: MutableTask): void {
		if (!config.taskStore) return
		const store = config.taskStore
		const snapshot = toPersistedTask(task)
		void store.save(snapshot).catch((err) => {
			log.warn('async agent task persistence failed', {
				taskId: task.id,
				status: task.status,
				error: err instanceof Error ? err.message : String(err),
			})
		})
	}

	function toPublicTask(task: MutableTask): AgentTask {
		return {
			id: task.id,
			agentName: task.agentName,
			input: task.input,
			status: task.status,
			result: task.result,
			error: task.error,
			createdAt: task.createdAt,
			startedAt: task.startedAt,
			completedAt: task.completedAt,
			metadata: task.metadata,
			cancel() {
				if (task.status === 'pending' || task.status === 'running') {
					task.status = 'cancelled'
					task.completedAt = Date.now()
					task.abortController.abort()
					emitProgress(task, { type: 'cancelled', taskId: task.id })
					persistTask(task)
					task.reject(
						new ElsiumError({
							code: 'VALIDATION_ERROR',
							message: `Task ${task.id} was cancelled`,
							retryable: false,
						}),
					)
				}
			},
			wait() {
				return task.promise
			},
		}
	}

	async function executeTask(task: MutableTask) {
		task.status = 'running'
		task.startedAt = Date.now()
		emitProgress(task, { type: 'started', taskId: task.id })
		persistTask(task)

		try {
			const result = await config.agent.run(task.input, {
				signal: task.abortController.signal,
				traceId: task.metadata.traceId as string | undefined,
			})

			if ((task.status as TaskStatus) === 'cancelled') return

			task.status = 'completed'
			task.result = result
			task.completedAt = Date.now()
			emitProgress(task, { type: 'completed', taskId: task.id, result })
			persistTask(task)

			try {
				config.onComplete?.(toPublicTask(task))
			} catch {
				/* callback errors are swallowed */
			}

			task.resolve(result)
		} catch (err) {
			if ((task.status as TaskStatus) === 'cancelled') return

			const error = err instanceof Error ? err : new Error(String(err))
			task.status = 'failed'
			task.error = error
			task.completedAt = Date.now()
			emitProgress(task, { type: 'failed', taskId: task.id, error })
			persistTask(task)

			try {
				config.onError?.(toPublicTask(task), error)
			} catch {
				/* callback errors are swallowed */
			}

			task.reject(error)
		}
	}

	return {
		submit(input: string, options: AsyncAgentRunOptions = {}): AgentTask {
			const taskId = options.taskId ?? generateId('task')
			const abortController = new AbortController()

			if (options.signal) {
				options.signal.addEventListener('abort', () => abortController.abort(), { once: true })
			}

			let resolvePromise!: (result: AgentResult) => void
			let rejectPromise!: (error: Error) => void
			const promise = new Promise<AgentResult>((resolve, reject) => {
				resolvePromise = resolve
				rejectPromise = reject
			})

			const task: MutableTask = {
				id: taskId,
				agentName: config.agent.name,
				input,
				status: 'pending',
				result: null,
				error: null,
				createdAt: Date.now(),
				startedAt: null,
				completedAt: null,
				metadata: { ...options.metadata },
				abortController,
				promise,
				resolve: resolvePromise,
				reject: rejectPromise,
			}

			tasks.set(taskId, task)
			persistTask(task)

			executeTask(task)

			return toPublicTask(task)
		},

		getTask(taskId: string): AgentTask | null {
			const task = tasks.get(taskId)
			return task ? toPublicTask(task) : null
		},

		listTasks(filter?: { status?: TaskStatus }): AgentTask[] {
			const all = [...tasks.values()]
			const filtered = filter?.status ? all.filter((t) => t.status === filter.status) : all
			return filtered.map(toPublicTask)
		},

		cancelAll() {
			for (const task of tasks.values()) {
				if (task.status === 'pending' || task.status === 'running') {
					task.status = 'cancelled'
					task.completedAt = Date.now()
					task.abortController.abort()
					emitProgress(task, { type: 'cancelled', taskId: task.id })
					persistTask(task)
					task.reject(
						new ElsiumError({
							code: 'VALIDATION_ERROR',
							message: `Task ${task.id} was cancelled`,
							retryable: false,
						}),
					)
				}
			}
		},

		async recover(): Promise<PersistedTask[]> {
			if (!config.taskStore) return []
			const store = config.taskStore
			const [pending, running] = await Promise.all([
				store.list({ status: 'pending' }),
				store.list({ status: 'running' }),
			])
			const orphans = [...pending, ...running]

			const now = Date.now()
			await Promise.all(
				orphans.map((orphan) =>
					store.save({
						...orphan,
						status: 'failed',
						completedAt: now,
						error: { message: 'Process restart: task did not complete' },
					}),
				),
			)

			return orphans
		},
	}
}
