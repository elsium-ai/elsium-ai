import { describe, expect, it, vi } from 'vitest'
import type { Agent } from './agent'
import { runParallel, runSequential, runSupervisor } from './multi'
import { createSharedMemory } from './shared-memory'
import type { AgentResult } from './types'

function makeResult(text: string): AgentResult {
	return {
		message: { role: 'assistant', content: text },
		usage: {
			totalInputTokens: 10,
			totalOutputTokens: 20,
			totalTokens: 30,
			totalCost: 0.001,
			iterations: 1,
		},
		toolCalls: [],
		traceId: 'trace-test',
	}
}

function makeAgent(name: string, run: (input: string) => Promise<AgentResult>): Agent {
	return {
		name,
		config: { name, system: `System prompt for ${name}`, model: 'mock' },
		run: vi.fn(run),
		chat: vi.fn(),
		resetMemory: vi.fn(),
	}
}

describe('runSequential', () => {
	it('calls each agent in order', async () => {
		const order: string[] = []
		const agentA = makeAgent('A', async (input) => {
			order.push(`A:${input}`)
			return makeResult('output-A')
		})
		const agentB = makeAgent('B', async (input) => {
			order.push(`B:${input}`)
			return makeResult('output-B')
		})

		await runSequential([agentA, agentB], 'start')

		expect(order).toEqual(['A:start', 'B:output-A'])
	})

	it('chains the output of one agent as input to the next', async () => {
		const agentA = makeAgent('A', async () => makeResult('step-one'))
		const agentB = makeAgent('B', async (input) => makeResult(`got:${input}`))

		const results = await runSequential([agentA, agentB], 'initial')

		expect(results[1].message.content).toBe('got:step-one')
	})

	it('returns results for every agent', async () => {
		const agents = ['X', 'Y', 'Z'].map((n) => makeAgent(n, async () => makeResult(`result-${n}`)))
		const results = await runSequential(agents, 'go')
		expect(results).toHaveLength(3)
	})

	it('writes each result to shared memory keyed by agent name', async () => {
		const sharedMemory = createSharedMemory()
		const agentA = makeAgent('alpha', async () => makeResult('alpha-out'))
		const agentB = makeAgent('beta', async () => makeResult('beta-out'))

		await runSequential([agentA, agentB], 'start', { sharedMemory })

		const alphaEntry = sharedMemory.get<{ output: string }>('alpha')
		const betaEntry = sharedMemory.get<{ output: string }>('beta')
		expect(alphaEntry?.output).toBe('alpha-out')
		expect(betaEntry?.output).toBe('beta-out')
	})

	it('passes sharedMemory as metadata to each agent', async () => {
		const sharedMemory = createSharedMemory()
		const agent = makeAgent('A', async () => makeResult('out'))

		await runSequential([agent], 'input', { sharedMemory })

		expect(agent.run).toHaveBeenCalledWith(
			'input',
			expect.objectContaining({
				metadata: expect.objectContaining({ sharedMemory }),
			}),
		)
	})

	it('works with a single agent', async () => {
		const agent = makeAgent('solo', async () => makeResult('only-result'))
		const results = await runSequential([agent], 'hi')
		expect(results).toHaveLength(1)
		expect(results[0].message.content).toBe('only-result')
	})
})

describe('runParallel', () => {
	it('runs all agents concurrently and returns all results', async () => {
		const agents = ['P', 'Q', 'R'].map((n) => makeAgent(n, async () => makeResult(`out-${n}`)))
		const results = await runParallel(agents, 'go')
		expect(results).toHaveLength(3)
	})

	it('passes the same input to every agent', async () => {
		const agentA = makeAgent('A', async () => makeResult('a'))
		const agentB = makeAgent('B', async () => makeResult('b'))

		await runParallel([agentA, agentB], 'shared-input')

		expect(agentA.run).toHaveBeenCalledWith('shared-input', expect.anything())
		expect(agentB.run).toHaveBeenCalledWith('shared-input', expect.anything())
	})

	it('writes successful results to shared memory', async () => {
		const sharedMemory = createSharedMemory()
		const agentA = makeAgent('alpha', async () => makeResult('alpha-out'))
		const agentB = makeAgent('beta', async () => makeResult('beta-out'))

		await runParallel([agentA, agentB], 'go', { sharedMemory })

		expect(sharedMemory.get<{ output: string }>('alpha')?.output).toBe('alpha-out')
		expect(sharedMemory.get<{ output: string }>('beta')?.output).toBe('beta-out')
	})

	it('handles partial failure — returns successful results when at least one succeeds', async () => {
		const agentOk = makeAgent('ok', async () => makeResult('success'))
		const agentFail = makeAgent('fail', async () => {
			throw new Error('boom')
		})

		const results = await runParallel([agentOk, agentFail], 'go')

		expect(results).toHaveLength(1)
		expect(results[0].message.content).toBe('success')
	})

	it('throws the first error when all agents fail', async () => {
		const agentA = makeAgent('A', async () => {
			throw new Error('error-A')
		})
		const agentB = makeAgent('B', async () => {
			throw new Error('error-B')
		})

		await expect(runParallel([agentA, agentB], 'go')).rejects.toThrow('error-A')
	})

	it('does not write a failed agent to shared memory', async () => {
		const sharedMemory = createSharedMemory()
		const agentOk = makeAgent('ok', async () => makeResult('success'))
		const agentFail = makeAgent('fail', async () => {
			throw new Error('boom')
		})

		await runParallel([agentOk, agentFail], 'go', { sharedMemory })

		expect(sharedMemory.get('fail')).toBeUndefined()
		expect(sharedMemory.get<{ output: string }>('ok')?.output).toBe('success')
	})
})

describe('runSupervisor', () => {
	it('passes worker names and truncated system prompts in the supervisor input', async () => {
		let capturedInput = ''
		const supervisor = makeAgent('sup', async (input) => {
			capturedInput = input
			return makeResult('supervisor-out')
		})
		const workerA = makeAgent('workerA', async () => makeResult('a'))
		const workerB = makeAgent('workerB', async () => makeResult('b'))

		workerA.config.system = 'I handle task A in great detail'
		workerB.config.system = 'I handle task B with precision'

		await runSupervisor(supervisor, [workerA, workerB], 'do the thing')

		expect(capturedInput).toContain('workerA')
		expect(capturedInput).toContain('workerB')
		expect(capturedInput).toContain('do the thing')
	})

	it('wraps user input in <user_request> tags', async () => {
		let capturedInput = ''
		const supervisor = makeAgent('sup', async (input) => {
			capturedInput = input
			return makeResult('done')
		})
		const worker = makeAgent('w', async () => makeResult('w-out'))

		await runSupervisor(supervisor, [worker], 'my request')

		expect(capturedInput).toContain('<user_request>')
		expect(capturedInput).toContain('my request')
		expect(capturedInput).toContain('</user_request>')
	})

	it('returns the supervisor result', async () => {
		const supervisor = makeAgent('sup', async () => makeResult('final-answer'))
		const worker = makeAgent('w', async () => makeResult('w-out'))

		const result = await runSupervisor(supervisor, [worker], 'input')

		expect(result.message.content).toBe('final-answer')
	})

	it('truncates worker system prompt to 100 characters in the description', async () => {
		let capturedInput = ''
		const supervisor = makeAgent('sup', async (input) => {
			capturedInput = input
			return makeResult('done')
		})
		const worker = makeAgent('w', async () => makeResult('w-out'))
		worker.config.system = 'A'.repeat(200)

		await runSupervisor(supervisor, [worker], 'request')

		// The description line should only contain the first 100 chars of the system prompt
		const descLine = capturedInput.split('\n').find((line) => line.startsWith('- w:'))
		expect(descLine).toBeDefined()
		// "- w: " is 5 chars, then up to 100 chars of system prompt
		expect(descLine?.length).toBeLessThanOrEqual(5 + 100)
	})

	it('passes sharedMemory as metadata to the supervisor', async () => {
		const sharedMemory = createSharedMemory()
		const supervisor = makeAgent('sup', async () => makeResult('done'))
		const worker = makeAgent('w', async () => makeResult('w-out'))

		await runSupervisor(supervisor, [worker], 'request', { sharedMemory })

		expect(supervisor.run).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				metadata: expect.objectContaining({ sharedMemory }),
			}),
		)
	})
})
