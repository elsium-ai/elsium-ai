import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { defineBranchWorkflow, defineParallelWorkflow, defineWorkflow, step } from './index'

// ─── Sequential Workflow ─────────────────────────────────────────

describe('defineWorkflow (sequential)', () => {
	it('runs steps in sequence', async () => {
		const workflow = defineWorkflow({
			name: 'process',
			steps: [
				step('double', {
					input: z.object({ value: z.number() }),
					handler: async ({ value }) => ({ value: value * 2 }),
				}),
				step('add-ten', {
					input: z.object({ value: z.number() }),
					handler: async ({ value }) => ({ value: value + 10 }),
				}),
			],
		})

		const result = await workflow.run({ value: 5 })

		expect(result.status).toBe('completed')
		expect(result.steps).toHaveLength(2)
		expect(result.outputs.double).toEqual({ value: 10 })
		expect(result.outputs['add-ten']).toEqual({ value: 20 })
	})

	it('passes output of each step as input to the next', async () => {
		const inputs: unknown[] = []

		const workflow = defineWorkflow({
			name: 'chain',
			steps: [
				step('step-1', {
					handler: async (input) => {
						inputs.push(input)
						return { from: 'step-1' }
					},
				}),
				step('step-2', {
					handler: async (input) => {
						inputs.push(input)
						return { from: 'step-2' }
					},
				}),
			],
		})

		await workflow.run({ initial: true })

		expect(inputs[0]).toEqual({ initial: true })
		expect(inputs[1]).toEqual({ from: 'step-1' })
	})

	it('stops on failure', async () => {
		const workflow = defineWorkflow({
			name: 'fail-test',
			steps: [
				step('ok-step', {
					handler: async () => ({ ok: true }),
				}),
				step('fail-step', {
					handler: async () => {
						throw new Error('boom')
					},
				}),
				step('unreached', {
					handler: async () => ({ unreached: true }),
				}),
			],
		})

		const result = await workflow.run({})

		expect(result.status).toBe('failed')
		expect(result.steps).toHaveLength(2)
		expect(result.steps[0].status).toBe('completed')
		expect(result.steps[1].status).toBe('failed')
		expect(result.steps[1].error).toBe('boom')
	})

	it('validates step input', async () => {
		const workflow = defineWorkflow({
			name: 'validate',
			steps: [
				step('strict', {
					input: z.object({ name: z.string(), age: z.number() }),
					handler: async (input) => input,
				}),
			],
		})

		const result = await workflow.run({ name: 123 })

		expect(result.status).toBe('failed')
		expect(result.steps[0].status).toBe('failed')
		expect(result.steps[0].error).toContain('validation failed')
	})

	it('skips conditional steps', async () => {
		const workflow = defineWorkflow({
			name: 'conditional',
			steps: [
				step('always', {
					handler: async (input) => input,
				}),
				step('only-if-admin', {
					condition: (input) => (input as { role: string }).role === 'admin',
					handler: async () => ({ admin: true }),
				}),
				step('final', {
					handler: async (input) => ({ done: true, input }),
				}),
			],
		})

		const result = await workflow.run({ role: 'user' })

		expect(result.status).toBe('completed')
		expect(result.steps[1].status).toBe('skipped')
		expect(result.outputs['only-if-admin']).toBeUndefined()
	})

	it('retries on failure', async () => {
		let attempts = 0

		const workflow = defineWorkflow({
			name: 'retry-test',
			steps: [
				step('flaky', {
					retry: { maxRetries: 2, baseDelayMs: 10 },
					handler: async () => {
						attempts++
						if (attempts < 3) throw new Error('temporary')
						return { ok: true }
					},
				}),
			],
		})

		const result = await workflow.run({})

		expect(result.status).toBe('completed')
		expect(result.steps[0].retryCount).toBe(2)
		expect(attempts).toBe(3)
	})

	it('uses fallback on failure', async () => {
		const workflow = defineWorkflow({
			name: 'fallback-test',
			steps: [
				step('with-fallback', {
					handler: async () => {
						throw new Error('primary failed')
					},
					fallback: async (error) => ({
						fallback: true,
						reason: error.message,
					}),
				}),
			],
		})

		const result = await workflow.run({})

		expect(result.status).toBe('completed')
		expect(result.outputs['with-fallback']).toEqual({
			fallback: true,
			reason: 'primary failed',
		})
	})

	it('respects step timeout', async () => {
		const workflow = defineWorkflow({
			name: 'timeout-test',
			steps: [
				step('slow', {
					timeoutMs: 50,
					handler: async () => {
						await new Promise((r) => setTimeout(r, 200))
						return {}
					},
				}),
			],
		})

		const result = await workflow.run({})

		expect(result.status).toBe('failed')
		expect(result.steps[0].status).toBe('failed')
		expect(result.steps[0].error).toContain('timed out')
	})

	it('calls event hooks', async () => {
		const onStepComplete = vi.fn()
		const onComplete = vi.fn()
		const onStepError = vi.fn()

		const workflow = defineWorkflow({
			name: 'hooks-test',
			steps: [step('ok', { handler: async () => ({ done: true }) })],
			onStepComplete,
			onStepError,
			onComplete,
		})

		await workflow.run({})

		expect(onStepComplete).toHaveBeenCalledOnce()
		expect(onComplete).toHaveBeenCalledOnce()
		expect(onStepError).not.toHaveBeenCalled()
	})

	it('calls error hook on failure', async () => {
		const onStepError = vi.fn()

		const workflow = defineWorkflow({
			name: 'error-hooks',
			steps: [
				step('fail', {
					handler: async () => {
						throw new Error('oops')
					},
				}),
			],
			onStepError,
		})

		await workflow.run({})

		expect(onStepError).toHaveBeenCalledOnce()
		expect(onStepError.mock.calls[0][1]).toBe('fail')
	})

	it('measures total duration', async () => {
		const workflow = defineWorkflow({
			name: 'duration-test',
			steps: [step('fast', { handler: async () => ({ ok: true }) })],
		})

		const result = await workflow.run({})

		expect(result.totalDurationMs).toBeGreaterThanOrEqual(0)
	})

	it('provides previousOutputs in context', async () => {
		let capturedContext: unknown = null

		const workflow = defineWorkflow({
			name: 'context-test',
			steps: [
				step('first', {
					handler: async () => ({ x: 42 }),
				}),
				step('second', {
					handler: async (input, context) => {
						capturedContext = context.previousOutputs
						return {}
					},
				}),
			],
		})

		await workflow.run({})

		expect(capturedContext).toEqual({ first: { x: 42 } })
	})
})

// ─── Parallel Workflow ───────────────────────────────────────────

describe('defineParallelWorkflow', () => {
	it('runs steps concurrently', async () => {
		const order: string[] = []

		const workflow = defineParallelWorkflow({
			name: 'parallel',
			steps: [
				step('fast', {
					handler: async () => {
						order.push('fast')
						return { speed: 'fast' }
					},
				}),
				step('also-fast', {
					handler: async () => {
						order.push('also-fast')
						return { speed: 'also-fast' }
					},
				}),
			],
		})

		const result = await workflow.run({})

		expect(result.status).toBe('completed')
		expect(result.steps).toHaveLength(2)
		expect(result.outputs.fast).toEqual({ speed: 'fast' })
		expect(result.outputs['also-fast']).toEqual({ speed: 'also-fast' })
	})

	it('all steps get same input', async () => {
		const receivedInputs: unknown[] = []

		const workflow = defineParallelWorkflow({
			name: 'same-input',
			steps: [
				step('a', {
					handler: async (input) => {
						receivedInputs.push(input)
						return {}
					},
				}),
				step('b', {
					handler: async (input) => {
						receivedInputs.push(input)
						return {}
					},
				}),
			],
		})

		await workflow.run({ shared: true })

		expect(receivedInputs[0]).toEqual({ shared: true })
		expect(receivedInputs[1]).toEqual({ shared: true })
	})

	it('reports failure if any step fails', async () => {
		const workflow = defineParallelWorkflow({
			name: 'partial-fail',
			steps: [
				step('ok', { handler: async () => ({ ok: true }) }),
				step('fail', {
					handler: async () => {
						throw new Error('nope')
					},
				}),
			],
		})

		const result = await workflow.run({})

		expect(result.status).toBe('failed')
		expect(result.steps[0].status).toBe('completed')
		expect(result.steps[1].status).toBe('failed')
	})
})

// ─── Branch Workflow ─────────────────────────────────────────────

describe('defineBranchWorkflow', () => {
	it('routes to matching branch', async () => {
		const premium = defineWorkflow({
			name: 'premium',
			steps: [step('vip', { handler: async () => ({ tier: 'premium' }) })],
		})

		const basic = defineWorkflow({
			name: 'basic',
			steps: [step('standard', { handler: async () => ({ tier: 'basic' }) })],
		})

		const router = defineBranchWorkflow('router', [
			{
				condition: (input) => (input as { plan: string }).plan === 'premium',
				workflow: premium,
			},
			{
				condition: (input) => (input as { plan: string }).plan === 'basic',
				workflow: basic,
			},
		])

		const result = await router.run({ plan: 'premium' })
		expect(result.outputs.vip).toEqual({ tier: 'premium' })
	})

	it('uses fallback when no branch matches', async () => {
		const fallback = defineWorkflow({
			name: 'fallback',
			steps: [step('default', { handler: async () => ({ tier: 'free' }) })],
		})

		const router = defineBranchWorkflow(
			'router',
			[
				{
					condition: () => false,
					workflow: defineWorkflow({ name: 'nope', steps: [] }),
				},
			],
			fallback,
		)

		const result = await router.run({})
		expect(result.outputs.default).toEqual({ tier: 'free' })
	})

	it('returns empty result when no branch and no fallback', async () => {
		const router = defineBranchWorkflow('router', [
			{ condition: () => false, workflow: defineWorkflow({ name: 'x', steps: [] }) },
		])

		const result = await router.run({})
		expect(result.status).toBe('completed')
		expect(result.steps).toHaveLength(0)
	})
})

// ─── Step Retry with Fallback ────────────────────────────────────

describe('step retry with fallback', () => {
	it('retries then uses fallback when all retries exhausted', async () => {
		let attempts = 0

		const workflow = defineWorkflow({
			name: 'retry-fallback-test',
			steps: [
				step('flaky-with-fallback', {
					retry: { maxRetries: 2, baseDelayMs: 10 },
					handler: async () => {
						attempts++
						throw new Error('always fails')
					},
					fallback: async (error) => ({
						recovered: true,
						originalError: error.message,
					}),
				}),
			],
		})

		const result = await workflow.run({})

		expect(result.status).toBe('completed')
		expect(result.steps[0].status).toBe('completed')
		expect(result.steps[0].retryCount).toBe(2)
		expect(attempts).toBe(3) // 1 initial + 2 retries
		expect(result.outputs['flaky-with-fallback']).toEqual({
			recovered: true,
			originalError: 'always fails',
		})
	})

	it('does not use fallback when retry succeeds', async () => {
		let attempts = 0
		const fallbackFn = vi.fn()

		const workflow = defineWorkflow({
			name: 'retry-success-test',
			steps: [
				step('eventually-works', {
					retry: { maxRetries: 3, baseDelayMs: 10 },
					handler: async () => {
						attempts++
						if (attempts < 2) throw new Error('temporary failure')
						return { ok: true }
					},
					fallback: fallbackFn,
				}),
			],
		})

		const result = await workflow.run({})

		expect(result.status).toBe('completed')
		expect(result.outputs['eventually-works']).toEqual({ ok: true })
		expect(fallbackFn).not.toHaveBeenCalled()
	})

	it('reports failure when both retries and fallback fail', async () => {
		const workflow = defineWorkflow({
			name: 'total-failure-test',
			steps: [
				step('total-fail', {
					retry: { maxRetries: 1, baseDelayMs: 10 },
					handler: async () => {
						throw new Error('handler error')
					},
					fallback: async () => {
						throw new Error('fallback also failed')
					},
				}),
			],
		})

		const result = await workflow.run({})

		expect(result.status).toBe('failed')
		expect(result.steps[0].status).toBe('failed')
		expect(result.steps[0].error).toContain('Fallback failed')
		expect(result.steps[0].error).toContain('fallback also failed')
	})
})
