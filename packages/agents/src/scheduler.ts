import { generateId } from '@elsium-ai/core'
import type { Agent } from './agent'
import type { AgentResult } from './types'

export interface ScheduledTask {
	readonly id: string
	readonly name: string
	readonly cronExpression: string
	readonly enabled: boolean
	readonly lastRunAt: number | null
	readonly nextRunAt: number | null
	readonly runCount: number
}

export interface SchedulerConfig {
	agent: Agent
	resolveAgent?: (task: ScheduledTask) => Agent | undefined
	onComplete?: (task: ScheduledTask, result: AgentResult) => void
	onError?: (task: ScheduledTask, error: Error) => void
	tickIntervalMs?: number
}

export interface ScheduleOptions {
	id?: string
	name?: string
	startImmediately?: boolean
	maxRuns?: number
	metadata?: Record<string, unknown>
}

export interface Scheduler {
	schedule(cronExpression: string, input: string, options?: ScheduleOptions): ScheduledTask
	unschedule(taskId: string): boolean
	getTask(taskId: string): ScheduledTask | null
	listTasks(): ScheduledTask[]
	pause(taskId: string): boolean
	resume(taskId: string): boolean
	start(): void
	stop(): void
}

interface MutableScheduledTask {
	id: string
	name: string
	cronExpression: string
	input: string
	enabled: boolean
	lastRunAt: number | null
	nextRunAt: number | null
	runCount: number
	maxRuns: number | null
	metadata: Record<string, unknown>
	running: boolean
}

export function parseCronExpression(expression: string): CronFields | null {
	const parts = expression.trim().split(/\s+/)
	if (parts.length !== 5) return null

	const minute = parseCronField(parts[0], 0, 59)
	const hour = parseCronField(parts[1], 0, 23)
	const dayOfMonth = parseCronField(parts[2], 1, 31)
	const month = parseCronField(parts[3], 1, 12)
	const dayOfWeek = parseCronField(parts[4], 0, 6)

	if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) return null

	return { minute, hour, dayOfMonth, month, dayOfWeek }
}

export interface CronFields {
	minute: number[]
	hour: number[]
	dayOfMonth: number[]
	month: number[]
	dayOfWeek: number[]
}

function parseStepPart(match: RegExpMatchArray, min: number, max: number): number[] | null {
	const step = Number.parseInt(match[2], 10)
	if (step <= 0) return null

	let rangeStart = min
	let rangeEnd = max
	if (match[1] !== '*') {
		const rangeParts = match[1].split('-')
		rangeStart = Number.parseInt(rangeParts[0], 10)
		rangeEnd = rangeParts[1] ? Number.parseInt(rangeParts[1], 10) : max
	}

	const values: number[] = []
	for (let i = rangeStart; i <= rangeEnd; i += step) {
		if (i >= min && i <= max) values.push(i)
	}
	return values
}

function parseRangePart(match: RegExpMatchArray, min: number, max: number): number[] | null {
	const start = Number.parseInt(match[1], 10)
	const end = Number.parseInt(match[2], 10)
	if (start > end || start < min || end > max) return null

	const values: number[] = []
	for (let i = start; i <= end; i++) {
		values.push(i)
	}
	return values
}

function parseSinglePart(part: string, min: number, max: number): number[] | null {
	const stepMatch = part.match(/^(\*|\d+(?:-\d+)?)\/(\d+)$/)
	if (stepMatch) return parseStepPart(stepMatch, min, max)

	const rangeMatch = part.match(/^(\d+)-(\d+)$/)
	if (rangeMatch) return parseRangePart(rangeMatch, min, max)

	const num = Number.parseInt(part, 10)
	if (Number.isNaN(num) || num < min || num > max) return null
	return [num]
}

function parseCronField(field: string, min: number, max: number): number[] | null {
	if (field === '*') {
		return Array.from({ length: max - min + 1 }, (_, i) => min + i)
	}

	const values: number[] = []
	for (const part of field.split(',')) {
		const result = parseSinglePart(part, min, max)
		if (!result) return null
		values.push(...result)
	}
	return values.length > 0 ? values : null
}

export function cronMatchesDate(fields: CronFields, date: Date): boolean {
	return (
		fields.minute.includes(date.getMinutes()) &&
		fields.hour.includes(date.getHours()) &&
		fields.dayOfMonth.includes(date.getDate()) &&
		fields.month.includes(date.getMonth() + 1) &&
		fields.dayOfWeek.includes(date.getDay())
	)
}

export function getNextCronDate(fields: CronFields, after: Date): Date {
	const next = new Date(after.getTime())
	next.setSeconds(0, 0)
	next.setMinutes(next.getMinutes() + 1)

	const maxIterations = 525600
	for (let i = 0; i < maxIterations; i++) {
		if (cronMatchesDate(fields, next)) return next
		next.setMinutes(next.getMinutes() + 1)
	}

	return next
}

export function createScheduler(config: SchedulerConfig): Scheduler {
	const tasks = new Map<string, MutableScheduledTask>()
	let timer: ReturnType<typeof setInterval> | null = null
	const tickInterval = config.tickIntervalMs ?? 60_000

	function toPublicTask(task: MutableScheduledTask): ScheduledTask {
		return {
			id: task.id,
			name: task.name,
			cronExpression: task.cronExpression,
			enabled: task.enabled,
			lastRunAt: task.lastRunAt,
			nextRunAt: task.nextRunAt,
			runCount: task.runCount,
		}
	}

	function updateNextRun(task: MutableScheduledTask) {
		const fields = parseCronExpression(task.cronExpression)
		task.nextRunAt = fields ? getNextCronDate(fields, new Date()).getTime() : null
	}

	function handleTaskSuccess(task: MutableScheduledTask, result: AgentResult) {
		task.lastRunAt = Date.now()
		task.runCount++
		task.running = false

		if (task.maxRuns !== null && task.runCount >= task.maxRuns) {
			task.enabled = false
			task.nextRunAt = null
		} else {
			updateNextRun(task)
		}

		try {
			config.onComplete?.(toPublicTask(task), result)
		} catch {
			/* callback errors are swallowed */
		}
	}

	function handleTaskError(task: MutableScheduledTask, err: unknown) {
		task.running = false
		task.lastRunAt = Date.now()
		updateNextRun(task)

		const error = err instanceof Error ? err : new Error(String(err))
		try {
			config.onError?.(toPublicTask(task), error)
		} catch {
			/* callback errors are swallowed */
		}
	}

	async function executeTask(task: MutableScheduledTask) {
		if (task.running) return
		task.running = true

		const agent = config.resolveAgent?.(toPublicTask(task)) ?? config.agent

		try {
			const result = await agent.run(task.input)
			handleTaskSuccess(task, result)
		} catch (err) {
			handleTaskError(task, err)
		}
	}

	function tick() {
		const now = Date.now()
		for (const task of tasks.values()) {
			if (!task.enabled || task.running) continue
			if (task.nextRunAt !== null && task.nextRunAt <= now) {
				executeTask(task)
			}
		}
	}

	return {
		schedule(cronExpression: string, input: string, options: ScheduleOptions = {}): ScheduledTask {
			const fields = parseCronExpression(cronExpression)
			if (!fields) {
				throw new Error(`Invalid cron expression: ${cronExpression}`)
			}

			const id = options.id ?? generateId('sched')
			const now = new Date()
			const nextRunAt = options.startImmediately
				? Date.now()
				: getNextCronDate(fields, now).getTime()

			const task: MutableScheduledTask = {
				id,
				name: options.name ?? `task-${id}`,
				cronExpression,
				input,
				enabled: true,
				lastRunAt: null,
				nextRunAt,
				runCount: 0,
				maxRuns: options.maxRuns ?? null,
				metadata: options.metadata ?? {},
				running: false,
			}

			tasks.set(id, task)

			if (options.startImmediately) {
				executeTask(task)
			}

			return toPublicTask(task)
		},

		unschedule(taskId: string): boolean {
			return tasks.delete(taskId)
		},

		getTask(taskId: string): ScheduledTask | null {
			const task = tasks.get(taskId)
			return task ? toPublicTask(task) : null
		},

		listTasks(): ScheduledTask[] {
			return [...tasks.values()].map(toPublicTask)
		},

		pause(taskId: string): boolean {
			const task = tasks.get(taskId)
			if (!task) return false
			task.enabled = false
			return true
		},

		resume(taskId: string): boolean {
			const task = tasks.get(taskId)
			if (!task) return false
			task.enabled = true
			const fields = parseCronExpression(task.cronExpression)
			task.nextRunAt = fields ? getNextCronDate(fields, new Date()).getTime() : null
			return true
		},

		start() {
			if (timer) return
			tick()
			timer = setInterval(tick, tickInterval)
		},

		stop() {
			if (timer) {
				clearInterval(timer)
				timer = null
			}
		},
	}
}
