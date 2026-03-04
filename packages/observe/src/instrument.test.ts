import type { CompletionRequest, LLMResponse } from '@elsium-ai/core'
import { describe, expect, it, vi } from 'vitest'
import { instrumentAgent, instrumentComplete } from './instrument'
import type { InstrumentableAgent } from './instrument'
import { observe } from './tracer'

// ─── Fixtures ─────────────────────────────────────────────────────

function makeCompletionRequest(overrides?: Partial<CompletionRequest>): CompletionRequest {
	return {
		model: 'claude-3-haiku',
		messages: [{ role: 'user', content: 'Hello' }],
		...overrides,
	}
}

function makeLLMResponse(overrides?: Partial<LLMResponse>): LLMResponse {
	return {
		id: 'resp-1',
		model: 'claude-3-haiku',
		provider: 'anthropic',
		message: { role: 'assistant', content: 'Hello back' },
		usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
		cost: { inputCost: 0.001, outputCost: 0.002, totalCost: 0.003, currency: 'USD' },
		latencyMs: 150,
		stopReason: 'end_turn',
		traceId: 'trc_resp',
		...overrides,
	}
}

// ─── instrumentComplete ───────────────────────────────────────────

describe('instrumentComplete', () => {
	it('calls the underlying complete function and returns its response', async () => {
		const tracer = observe({ output: [] })
		const response = makeLLMResponse()
		const completeFn = vi.fn().mockResolvedValue(response)

		const instrumented = instrumentComplete(completeFn, tracer)
		const request = makeCompletionRequest()
		const result = await instrumented(request)

		expect(completeFn).toHaveBeenCalledOnce()
		expect(completeFn).toHaveBeenCalledWith(request)
		expect(result).toBe(response)
	})

	it('creates a span named "llm.complete" with kind "llm"', async () => {
		const tracer = observe({ output: [] })
		const completeFn = vi.fn().mockResolvedValue(makeLLMResponse())

		const instrumented = instrumentComplete(completeFn, tracer)
		await instrumented(makeCompletionRequest())

		const spans = tracer.getSpans()
		expect(spans).toHaveLength(1)
		expect(spans[0].name).toBe('llm.complete')
		expect(spans[0].kind).toBe('llm')
	})

	it('ends the span with status "ok" on success', async () => {
		const tracer = observe({ output: [] })
		const completeFn = vi.fn().mockResolvedValue(makeLLMResponse())

		const instrumented = instrumentComplete(completeFn, tracer)
		await instrumented(makeCompletionRequest())

		const spans = tracer.getSpans()
		expect(spans[0].status).toBe('ok')
	})

	it('records model and message count metadata on the span', async () => {
		const tracer = observe({ output: [] })
		const completeFn = vi.fn().mockResolvedValue(makeLLMResponse())
		const request = makeCompletionRequest({
			model: 'gpt-4',
			messages: [
				{ role: 'user', content: 'msg1' },
				{ role: 'user', content: 'msg2' },
			],
		})

		const instrumented = instrumentComplete(completeFn, tracer)
		await instrumented(request)

		const { metadata } = tracer.getSpans()[0]
		expect(metadata.model).toBe('gpt-4')
		expect(metadata.messageCount).toBe(2)
	})

	it('records token usage, cost, provider and latency metadata on the span', async () => {
		const tracer = observe({ output: [] })
		const response = makeLLMResponse({
			usage: { inputTokens: 5, outputTokens: 15, totalTokens: 20 },
			cost: { inputCost: 0.0005, outputCost: 0.0015, totalCost: 0.002, currency: 'USD' },
			latencyMs: 200,
			provider: 'openai',
		})
		const completeFn = vi.fn().mockResolvedValue(response)

		const instrumented = instrumentComplete(completeFn, tracer)
		await instrumented(makeCompletionRequest())

		const { metadata } = tracer.getSpans()[0]
		expect(metadata.inputTokens).toBe(5)
		expect(metadata.outputTokens).toBe(15)
		expect(metadata.totalCost).toBe(0.002)
		expect(metadata.provider).toBe('openai')
		expect(metadata.latencyMs).toBe(200)
	})

	it('tracks the LLM call on the tracer cost report', async () => {
		const tracer = observe({ output: [], costTracking: true })
		const response = makeLLMResponse({
			model: 'claude-3-haiku',
			usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
			cost: { inputCost: 0.001, outputCost: 0.002, totalCost: 0.003, currency: 'USD' },
			latencyMs: 100,
		})
		const completeFn = vi.fn().mockResolvedValue(response)

		const instrumented = instrumentComplete(completeFn, tracer)
		await instrumented(makeCompletionRequest())

		const report = tracer.getCostReport()
		expect(report.callCount).toBe(1)
		expect(report.totalInputTokens).toBe(10)
		expect(report.totalOutputTokens).toBe(20)
		expect(report.totalCost).toBeCloseTo(0.003)
		expect(report.byModel['claude-3-haiku']).toBeDefined()
	})

	it('ends the span with status "error" and rethrows when complete throws', async () => {
		const tracer = observe({ output: [] })
		const error = new Error('Provider unavailable')
		const completeFn = vi.fn().mockRejectedValue(error)

		const instrumented = instrumentComplete(completeFn, tracer)
		await expect(instrumented(makeCompletionRequest())).rejects.toThrow('Provider unavailable')

		const spans = tracer.getSpans()
		expect(spans[0].status).toBe('error')
		expect(spans[0].metadata.error).toBe('Provider unavailable')
	})

	it('does not call trackLLMCall when complete throws', async () => {
		const tracer = observe({ output: [], costTracking: true })
		const completeFn = vi.fn().mockRejectedValue(new Error('fail'))

		const instrumented = instrumentComplete(completeFn, tracer)
		await expect(instrumented(makeCompletionRequest())).rejects.toThrow()

		expect(tracer.getCostReport().callCount).toBe(0)
	})

	it('uses "default" as model metadata when request.model is undefined', async () => {
		const tracer = observe({ output: [] })
		const completeFn = vi.fn().mockResolvedValue(makeLLMResponse())
		const request = makeCompletionRequest({ model: undefined })

		const instrumented = instrumentComplete(completeFn, tracer)
		await instrumented(request)

		expect(tracer.getSpans()[0].metadata.model).toBe('default')
	})

	it('handles non-Error throws and records string representation as metadata', async () => {
		const tracer = observe({ output: [] })
		const completeFn = vi.fn().mockRejectedValue('string error')

		const instrumented = instrumentComplete(completeFn, tracer)
		await expect(instrumented(makeCompletionRequest())).rejects.toBe('string error')

		expect(tracer.getSpans()[0].metadata.error).toBe('string error')
	})
})

// ─── instrumentAgent ─────────────────────────────────────────────

describe('instrumentAgent', () => {
	function makeAgent(name: string, runResult: unknown): InstrumentableAgent {
		return {
			name,
			run: vi.fn().mockResolvedValue(runResult),
		}
	}

	it('returns a wrapped agent that delegates run() to the original', async () => {
		const tracer = observe({ output: [] })
		const agent = makeAgent('planner', { answer: 42 })

		const instrumented = instrumentAgent(agent, tracer)
		const result = await instrumented.run('do something')

		expect(result).toEqual({ answer: 42 })
		expect(agent.run).toHaveBeenCalledOnce()
		expect(agent.run).toHaveBeenCalledWith('do something', undefined)
	})

	it('creates a span named "agent.<name>" with kind "agent"', async () => {
		const tracer = observe({ output: [] })
		const agent = makeAgent('researcher', 'done')

		const instrumented = instrumentAgent(agent, tracer)
		await instrumented.run('research topic')

		const spans = tracer.getSpans()
		expect(spans).toHaveLength(1)
		expect(spans[0].name).toBe('agent.researcher')
		expect(spans[0].kind).toBe('agent')
	})

	it('sets agentName metadata on the span', async () => {
		const tracer = observe({ output: [] })
		const agent = makeAgent('executor', 'result')

		const instrumented = instrumentAgent(agent, tracer)
		await instrumented.run('execute task')

		expect(tracer.getSpans()[0].metadata.agentName).toBe('executor')
	})

	it('ends the span with status "ok" on success', async () => {
		const tracer = observe({ output: [] })
		const agent = makeAgent('planner', 'ok')

		const instrumented = instrumentAgent(agent, tracer)
		await instrumented.run('plan')

		expect(tracer.getSpans()[0].status).toBe('ok')
	})

	it('ends the span with status "error" and rethrows when run() throws', async () => {
		const tracer = observe({ output: [] })
		const agent: InstrumentableAgent = {
			name: 'failing-agent',
			run: vi.fn().mockRejectedValue(new Error('agent blew up')),
		}

		const instrumented = instrumentAgent(agent, tracer)
		await expect(instrumented.run('cause failure')).rejects.toThrow('agent blew up')

		const spans = tracer.getSpans()
		expect(spans[0].status).toBe('error')
		expect(spans[0].metadata.error).toBe('agent blew up')
	})

	it('preserves the original agent name property', () => {
		const tracer = observe({ output: [] })
		const agent = makeAgent('my-agent', null)
		const instrumented = instrumentAgent(agent, tracer)

		expect(instrumented.name).toBe('my-agent')
	})

	it('passes options through to the original run()', async () => {
		const tracer = observe({ output: [] })
		const agent = makeAgent('planner', null)
		const options = { maxIterations: 5 }

		const instrumented = instrumentAgent(agent, tracer)
		await instrumented.run('task', options)

		expect(agent.run).toHaveBeenCalledWith('task', options)
	})

	it('handles non-Error throws and records string representation as metadata', async () => {
		const tracer = observe({ output: [] })
		const agent: InstrumentableAgent = {
			name: 'agent',
			run: vi.fn().mockRejectedValue('string err'),
		}

		const instrumented = instrumentAgent(agent, tracer)
		await expect(instrumented.run('input')).rejects.toBe('string err')

		expect(tracer.getSpans()[0].metadata.error).toBe('string err')
	})

	it('does not mutate the original agent run property', () => {
		const tracer = observe({ output: [] })
		const originalRun = vi.fn().mockResolvedValue('done')
		const agent: InstrumentableAgent = { name: 'agent', run: originalRun }

		instrumentAgent(agent, tracer)

		expect(agent.run).toBe(originalRun)
	})
})
