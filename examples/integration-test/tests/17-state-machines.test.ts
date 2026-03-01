import { defineAgent } from '@elsium-ai/agents'
import type { StateMachineResult } from '@elsium-ai/agents'
/**
 * Test 17: State Machines (Real LLM)
 * Verifies: agent with states, stateHistory, finalState
 */
import { expect, it } from 'vitest'
import { assertNonEmptyString, createTestComplete, describeWithLLM } from '../lib/helpers'

describeWithLLM('17 — State Machines (Real LLM)', () => {
	it('agent runs through state machine transitions', async () => {
		const complete = createTestComplete()

		const agent = defineAgent(
			{
				name: 'state-agent',
				system: 'You are a stateful assistant.',
				states: {
					gather: {
						system: 'Analyze the request. Respond in under 10 words.',
						transition: () => 'respond',
					},
					respond: {
						system: 'Provide a brief answer. Under 10 words.',
						terminal: true,
						transition: () => 'respond',
					},
				},
				initialState: 'gather',
			},
			{ complete },
		)

		const result = (await agent.run('What is AI?')) as StateMachineResult

		expect(result.message).toBeDefined()
		assertNonEmptyString(result.message.content)
		expect(result.stateHistory).toBeDefined()
		expect(Array.isArray(result.stateHistory)).toBe(true)
		expect(result.stateHistory.length).toBeGreaterThanOrEqual(1)
		expect(result.finalState).toBe('respond')
	})

	it('respects terminal states', async () => {
		const complete = createTestComplete()

		const agent = defineAgent(
			{
				name: 'terminal-agent',
				system: 'Respond briefly. Under 5 words.',
				states: {
					only: {
						system: 'Single state. Under 5 words.',
						terminal: true,
						transition: () => 'only',
					},
				},
				initialState: 'only',
			},
			{ complete },
		)

		const result = (await agent.run('Hello')) as StateMachineResult

		expect(result.finalState).toBe('only')
		expect(result.stateHistory.length).toBe(1)
	})

	it('state history entries have expected shape', async () => {
		const complete = createTestComplete()

		const agent = defineAgent(
			{
				name: 'history-agent',
				system: 'Process in stages.',
				states: {
					stage1: {
						system: 'Acknowledge. Under 5 words.',
						transition: () => 'stage2',
					},
					stage2: {
						system: 'Conclude. Under 5 words.',
						terminal: true,
						transition: () => 'stage2',
					},
				},
				initialState: 'stage1',
			},
			{ complete },
		)

		const result = (await agent.run('Test')) as StateMachineResult

		for (const entry of result.stateHistory) {
			expect(entry.state).toBeDefined()
			expect(typeof entry.state).toBe('string')
		}
	})
})
