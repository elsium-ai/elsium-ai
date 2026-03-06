import type { CompletionRequest, LLMResponse } from '@elsium-ai/core'
import { describe, expect, it, vi } from 'vitest'
import { defineAgent } from './agent'
import type { TaskProgressEvent } from './async-agent'
import { createAsyncAgent } from './async-agent'

function mockResponse(overrides: Partial<LLMResponse> = {}): LLMResponse {
	return {
		id: 'msg_1',
		message: { role: 'assistant', content: 'Hello!' },
		usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
		cost: { inputCost: 0.001, outputCost: 0.002, totalCost: 0.003, currency: 'USD' },
		model: 'test-model',
		provider: 'test',
		stopReason: 'end_turn',
		latencyMs: 50,
		traceId: 'trc_test',
		...overrides,
	}
}

function mockDeps(responses: Partial<LLMResponse>[], delay = 0) {
	let callIndex = 0
	return {
		async complete(request: CompletionRequest): Promise<LLMResponse> {
			if (delay) await new Promise((r) => setTimeout(r, delay))
			const resp = responses[callIndex] ?? {}
			callIndex++
			return mockResponse(resp)
		},
	}
}

describe('createAsyncAgent', () => {
	it('submits a task and gets result', async () => {
		const deps = mockDeps([{ message: { role: 'assistant', content: 'Background result' } }])

		const agent = defineAgent({ name: 'worker', system: 'Work.' }, deps)
		const asyncAgent = createAsyncAgent({ agent })

		const task = asyncAgent.submit('Do some work')
		expect(task.id).toBeDefined()
		expect(task.agentName).toBe('worker')
		expect(task.input).toBe('Do some work')

		const result = await task.wait()
		expect(result.message.content).toBe('Background result')
	})

	it('tracks task status transitions', async () => {
		const progressEvents: TaskProgressEvent[] = []

		const deps = mockDeps([{ message: { role: 'assistant', content: 'Done' } }], 10)

		const agent = defineAgent({ name: 'worker', system: 'Work.' }, deps)
		const asyncAgent = createAsyncAgent({
			agent,
			onProgress: (_, event) => progressEvents.push(event),
		})

		const task = asyncAgent.submit('Work')
		await task.wait()

		const types = progressEvents.map((e) => e.type)
		expect(types).toContain('started')
		expect(types).toContain('completed')
	})

	it('calls onComplete callback', async () => {
		const onComplete = vi.fn()
		const deps = mockDeps([{ message: { role: 'assistant', content: 'Done' } }])

		const agent = defineAgent({ name: 'worker', system: 'Work.' }, deps)
		const asyncAgent = createAsyncAgent({ agent, onComplete })

		const task = asyncAgent.submit('Work')
		await task.wait()

		expect(onComplete).toHaveBeenCalledOnce()
		expect(onComplete.mock.calls[0][0].status).toBe('completed')
	})

	it('calls onError callback on failure', async () => {
		const onError = vi.fn()
		const deps = {
			async complete(): Promise<LLMResponse> {
				throw new Error('Provider down')
			},
		}

		const agent = defineAgent({ name: 'failing', system: 'Fail.' }, deps)
		const asyncAgent = createAsyncAgent({ agent, onError })

		const task = asyncAgent.submit('Work')

		await expect(task.wait()).rejects.toThrow('Provider down')
		expect(onError).toHaveBeenCalledOnce()
	})

	it('cancels a running task', async () => {
		const deps = mockDeps([{ message: { role: 'assistant', content: 'Done' } }], 100)

		const agent = defineAgent({ name: 'slow', system: 'Slow.' }, deps)
		const asyncAgent = createAsyncAgent({ agent })

		const task = asyncAgent.submit('Long work')
		task.cancel()

		await expect(task.wait()).rejects.toThrow('cancelled')
	})

	it('lists tasks', async () => {
		const deps = mockDeps([
			{ message: { role: 'assistant', content: 'A' } },
			{ message: { role: 'assistant', content: 'B' } },
		])

		const agent = defineAgent({ name: 'worker', system: 'Work.' }, deps)
		const asyncAgent = createAsyncAgent({ agent })

		const task1 = asyncAgent.submit('Task 1')
		const task2 = asyncAgent.submit('Task 2')

		await Promise.all([task1.wait(), task2.wait()])

		const allTasks = asyncAgent.listTasks()
		expect(allTasks).toHaveLength(2)

		const completed = asyncAgent.listTasks({ status: 'completed' })
		expect(completed).toHaveLength(2)
	})

	it('gets task by id', async () => {
		const deps = mockDeps([{ message: { role: 'assistant', content: 'Done' } }])

		const agent = defineAgent({ name: 'worker', system: 'Work.' }, deps)
		const asyncAgent = createAsyncAgent({ agent })

		const task = asyncAgent.submit('Work')
		await task.wait()

		const retrieved = asyncAgent.getTask(task.id)
		expect(retrieved).not.toBeNull()
		expect(retrieved?.id).toBe(task.id)
		expect(retrieved?.status).toBe('completed')
	})

	it('returns null for non-existent task', () => {
		const agent = defineAgent({ name: 'worker', system: 'Work.' }, mockDeps([]))
		const asyncAgent = createAsyncAgent({ agent })

		expect(asyncAgent.getTask('nonexistent')).toBeNull()
	})

	it('cancels all tasks', async () => {
		const deps = mockDeps(Array(5).fill({ message: { role: 'assistant', content: 'Done' } }), 200)

		const agent = defineAgent({ name: 'slow', system: 'Slow.' }, deps)
		const asyncAgent = createAsyncAgent({ agent })

		const tasks = [
			asyncAgent.submit('Task 1'),
			asyncAgent.submit('Task 2'),
			asyncAgent.submit('Task 3'),
		]

		asyncAgent.cancelAll()

		for (const task of tasks) {
			await expect(task.wait()).rejects.toThrow('cancelled')
		}
	})

	it('accepts custom task id', async () => {
		const deps = mockDeps([{ message: { role: 'assistant', content: 'Done' } }])

		const agent = defineAgent({ name: 'worker', system: 'Work.' }, deps)
		const asyncAgent = createAsyncAgent({ agent })

		const task = asyncAgent.submit('Work', { taskId: 'custom-123' })
		expect(task.id).toBe('custom-123')

		await task.wait()
	})

	it('runs multiple tasks concurrently', async () => {
		let concurrency = 0
		let maxConcurrency = 0

		const deps = {
			async complete(): Promise<LLMResponse> {
				concurrency++
				maxConcurrency = Math.max(maxConcurrency, concurrency)
				await new Promise((r) => setTimeout(r, 20))
				concurrency--
				return mockResponse()
			},
		}

		const agent = defineAgent({ name: 'worker', system: 'Work.' }, deps)
		const asyncAgent = createAsyncAgent({ agent })

		const tasks = [asyncAgent.submit('A'), asyncAgent.submit('B'), asyncAgent.submit('C')]

		await Promise.all(tasks.map((t) => t.wait()))
		expect(maxConcurrency).toBeGreaterThan(1)
	})

	it('swallows callback errors without crashing', async () => {
		const deps = mockDeps([{ message: { role: 'assistant', content: 'Done' } }])

		const agent = defineAgent({ name: 'worker', system: 'Work.' }, deps)
		const asyncAgent = createAsyncAgent({
			agent,
			onProgress: () => {
				throw new Error('Callback crash')
			},
			onComplete: () => {
				throw new Error('Complete crash')
			},
		})

		const task = asyncAgent.submit('Work')
		const result = await task.wait()
		expect(result.message.content).toBe('Done')
	})
})
