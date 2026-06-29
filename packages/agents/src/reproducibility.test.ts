import type { CompletionRequest, LLMResponse } from '@elsium-ai/core'
import { describe, expect, it } from 'vitest'
import type { AgentDependencies } from './agent'
import { defineAgent } from './index'

function mockResponse(): LLMResponse {
	return {
		id: 'msg_1',
		message: { role: 'assistant', content: 'ok' },
		usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
		cost: { inputCost: 0, outputCost: 0, totalCost: 0, currency: 'USD' },
		model: 'test-model',
		provider: 'test',
		stopReason: 'end_turn',
		latencyMs: 0,
		traceId: 'trc',
	}
}

function capturingDeps(): { deps: AgentDependencies; requests: CompletionRequest[] } {
	const requests: CompletionRequest[] = []
	return {
		requests,
		deps: {
			async complete(request: CompletionRequest): Promise<LLMResponse> {
				requests.push(request)
				return mockResponse()
			},
		},
	}
}

describe('seed propagation for reproducibility', () => {
	it('forwards the agent-level seed to every LLM request', async () => {
		const { deps, requests } = capturingDeps()
		const agent = defineAgent({ name: 'a', system: 's', seed: 42 }, deps)

		await agent.run('hello')

		expect(requests[0].seed).toBe(42)
	})

	it('lets a per-run seed override the agent-level seed', async () => {
		const { deps, requests } = capturingDeps()
		const agent = defineAgent({ name: 'a', system: 's', seed: 42 }, deps)

		await agent.run('hello', { seed: 7 })

		expect(requests[0].seed).toBe(7)
	})

	it('leaves seed undefined when none is configured', async () => {
		const { deps, requests } = capturingDeps()
		const agent = defineAgent({ name: 'a', system: 's' }, deps)

		await agent.run('hello')

		expect(requests[0].seed).toBeUndefined()
	})

	it('propagates the seed across multi-turn chat requests', async () => {
		const { deps, requests } = capturingDeps()
		const agent = defineAgent({ name: 'a', system: 's', seed: 99 }, deps)

		await agent.chat([{ role: 'user', content: 'hi' }])

		expect(requests[0].seed).toBe(99)
	})
})
