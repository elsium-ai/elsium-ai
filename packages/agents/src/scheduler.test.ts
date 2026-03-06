import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Agent } from './agent'
import type { CronFields } from './scheduler'
import { createScheduler, cronMatchesDate, getNextCronDate, parseCronExpression } from './scheduler'
import type { AgentResult } from './types'

function mockAgent(name = 'test-agent'): Agent {
	const result: AgentResult = {
		message: { role: 'assistant', content: 'Done' },
		usage: {
			totalInputTokens: 10,
			totalOutputTokens: 5,
			totalTokens: 15,
			totalCost: 0,
			iterations: 1,
		},
		toolCalls: [],
		traceId: 'trace-1',
	}
	return {
		name,
		config: { name, system: 'test' } as Agent['config'],
		run: vi.fn().mockResolvedValue(result),
		stream: vi.fn(),
		chat: vi.fn(),
		resetMemory: vi.fn(),
	}
}

describe('parseCronExpression', () => {
	it('parses standard expressions', () => {
		const fields = parseCronExpression('0 * * * *')
		expect(fields).not.toBeNull()
		expect(fields?.minute).toEqual([0])
		expect(fields?.hour.length).toBe(24)
	})

	it('parses ranges', () => {
		const fields = parseCronExpression('0-5 * * * *')
		expect(fields?.minute).toEqual([0, 1, 2, 3, 4, 5])
	})

	it('parses steps', () => {
		const fields = parseCronExpression('*/15 * * * *')
		expect(fields?.minute).toEqual([0, 15, 30, 45])
	})

	it('parses comma-separated values', () => {
		const fields = parseCronExpression('0,30 * * * *')
		expect(fields?.minute).toEqual([0, 30])
	})

	it('returns null for invalid expressions', () => {
		expect(parseCronExpression('invalid')).toBeNull()
		expect(parseCronExpression('60 * * * *')).toBeNull()
		expect(parseCronExpression('* * *')).toBeNull()
	})

	it('parses range with step', () => {
		const fields = parseCronExpression('0-30/10 * * * *')
		expect(fields?.minute).toEqual([0, 10, 20, 30])
	})
})

describe('cronMatchesDate', () => {
	it('matches a specific time', () => {
		const fields = parseCronExpression('30 14 * * *') as CronFields
		const date = new Date('2026-03-06T14:30:00')
		expect(cronMatchesDate(fields, date)).toBe(true)
	})

	it('rejects non-matching time', () => {
		const fields = parseCronExpression('30 14 * * *') as CronFields
		const date = new Date('2026-03-06T14:31:00')
		expect(cronMatchesDate(fields, date)).toBe(false)
	})

	it('matches day of week', () => {
		const fields = parseCronExpression('0 9 * * 1') as CronFields
		const monday = new Date('2026-03-09T09:00:00')
		expect(cronMatchesDate(fields, monday)).toBe(true)

		const tuesday = new Date('2026-03-10T09:00:00')
		expect(cronMatchesDate(fields, tuesday)).toBe(false)
	})
})

describe('getNextCronDate', () => {
	it('finds next matching date', () => {
		const fields = parseCronExpression('0 * * * *') as CronFields
		const after = new Date('2026-03-06T14:30:00')
		const next = getNextCronDate(fields, after)
		expect(next.getHours()).toBe(15)
		expect(next.getMinutes()).toBe(0)
	})

	it('advances to next minute if already past', () => {
		const fields = parseCronExpression('*/5 * * * *') as CronFields
		const after = new Date('2026-03-06T14:05:00')
		const next = getNextCronDate(fields, after)
		expect(next.getMinutes()).toBe(10)
	})
})

describe('createScheduler', () => {
	afterEach(() => {
		vi.useRealTimers()
	})

	it('schedules a task', () => {
		const agent = mockAgent()
		const scheduler = createScheduler({ agent })

		const task = scheduler.schedule('0 * * * *', 'Do something')

		expect(task.id).toBeTruthy()
		expect(task.cronExpression).toBe('0 * * * *')
		expect(task.enabled).toBe(true)
		expect(task.nextRunAt).not.toBeNull()

		scheduler.stop()
	})

	it('throws on invalid cron expression', () => {
		const agent = mockAgent()
		const scheduler = createScheduler({ agent })

		expect(() => scheduler.schedule('invalid', 'Do something')).toThrow('Invalid cron expression')
		scheduler.stop()
	})

	it('executes task immediately when startImmediately is set', async () => {
		const agent = mockAgent()
		const onComplete = vi.fn()
		const scheduler = createScheduler({ agent, onComplete })

		scheduler.schedule('0 0 1 1 *', 'Run now', { startImmediately: true })

		await vi.waitFor(() => {
			expect(agent.run).toHaveBeenCalledWith('Run now')
			expect(onComplete).toHaveBeenCalled()
		})

		scheduler.stop()
	})

	it('lists and gets tasks', () => {
		const agent = mockAgent()
		const scheduler = createScheduler({ agent })

		scheduler.schedule('0 * * * *', 'Task 1', { name: 'task-one' })
		scheduler.schedule('30 * * * *', 'Task 2', { name: 'task-two' })

		const tasks = scheduler.listTasks()
		expect(tasks).toHaveLength(2)

		const task = scheduler.getTask(tasks[0].id)
		expect(task).not.toBeNull()
		expect(task?.name).toBe('task-one')

		scheduler.stop()
	})

	it('unschedules a task', () => {
		const agent = mockAgent()
		const scheduler = createScheduler({ agent })

		const task = scheduler.schedule('0 * * * *', 'Task')
		expect(scheduler.unschedule(task.id)).toBe(true)
		expect(scheduler.getTask(task.id)).toBeNull()

		scheduler.stop()
	})

	it('pauses and resumes a task', () => {
		const agent = mockAgent()
		const scheduler = createScheduler({ agent })

		const task = scheduler.schedule('0 * * * *', 'Task')

		expect(scheduler.pause(task.id)).toBe(true)
		const paused = scheduler.getTask(task.id)
		expect(paused?.enabled).toBe(false)

		expect(scheduler.resume(task.id)).toBe(true)
		const resumed = scheduler.getTask(task.id)
		expect(resumed?.enabled).toBe(true)

		scheduler.stop()
	})

	it('respects maxRuns', async () => {
		const agent = mockAgent()
		const onComplete = vi.fn()
		const scheduler = createScheduler({ agent, onComplete })

		scheduler.schedule('0 0 1 1 *', 'Limited task', {
			startImmediately: true,
			maxRuns: 1,
		})

		await vi.waitFor(() => {
			expect(onComplete).toHaveBeenCalledTimes(1)
		})

		const tasks = scheduler.listTasks()
		expect(tasks[0].enabled).toBe(false)

		scheduler.stop()
	})

	it('calls onError when agent fails', async () => {
		const agent = mockAgent()
		;(agent.run as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Agent failed'))
		const onError = vi.fn()
		const scheduler = createScheduler({ agent, onError })

		scheduler.schedule('0 0 1 1 *', 'Fail task', { startImmediately: true })

		await vi.waitFor(() => {
			expect(onError).toHaveBeenCalled()
			expect(onError.mock.calls[0][1].message).toBe('Agent failed')
		})

		scheduler.stop()
	})

	it('runs tick on interval', async () => {
		vi.useFakeTimers()
		const agent = mockAgent()
		const scheduler = createScheduler({ agent, tickIntervalMs: 100 })

		scheduler.start()
		scheduler.stop()
	})

	it('returns false for pause/resume on non-existent task', () => {
		const agent = mockAgent()
		const scheduler = createScheduler({ agent })

		expect(scheduler.pause('nonexistent')).toBe(false)
		expect(scheduler.resume('nonexistent')).toBe(false)

		scheduler.stop()
	})

	it('accepts custom task id', () => {
		const agent = mockAgent()
		const scheduler = createScheduler({ agent })

		const task = scheduler.schedule('0 * * * *', 'Task', { id: 'my-task' })
		expect(task.id).toBe('my-task')

		scheduler.stop()
	})
})
