import { describe, expect, it } from 'vitest'
import { AgentPauseSignal, isAgentPauseSignal, pauseAgent } from './pause'

describe('AgentPauseSignal', () => {
	it('carries reason + context', () => {
		const signal = new AgentPauseSignal({ reason: 'waiting for human', context: { trade: 42 } })
		expect(signal.reason).toBe('waiting for human')
		expect(signal.context).toEqual({ trade: 42 })
		expect(signal.name).toBe('AgentPauseSignal')
	})

	it('isAgentPauseSignal narrows correctly', () => {
		expect(isAgentPauseSignal(new AgentPauseSignal())).toBe(true)
		expect(isAgentPauseSignal(new Error('plain'))).toBe(false)
		expect(isAgentPauseSignal({ isAgentPauseSignal: true })).toBe(true)
		expect(isAgentPauseSignal(null)).toBe(false)
		expect(isAgentPauseSignal('string')).toBe(false)
	})

	it('pauseAgent throws an AgentPauseSignal', () => {
		expect(() => pauseAgent('test', { foo: 1 })).toThrow(AgentPauseSignal)
		try {
			pauseAgent('test', { foo: 1 })
		} catch (e) {
			expect(isAgentPauseSignal(e)).toBe(true)
			expect((e as AgentPauseSignal).reason).toBe('test')
		}
	})
})
