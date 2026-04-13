import { describe, expect, it } from 'vitest'
import { computeAgentMetrics, computeToolMetrics, formatAgentMetrics } from './agent-metrics'
import type { ConversationResult } from './multi-turn'
import type { ToolCallEntry } from './tool-assertions'

function makeCall(name: string, success = true): ToolCallEntry {
	return {
		name,
		arguments: {},
		result: {
			success,
			data: success ? 'ok' : undefined,
			error: success ? undefined : 'failed',
			toolCallId: `call-${name}`,
			durationMs: 10,
		},
	}
}

describe('computeToolMetrics', () => {
	it('returns defaults for empty calls', () => {
		const metrics = computeToolMetrics([])
		expect(metrics.totalToolCalls).toBe(0)
		expect(metrics.toolCallEfficiency).toBe(1)
		expect(metrics.errorRecoveryRate).toBe(0)
	})

	it('computes unique and repeated calls', () => {
		const calls = [makeCall('search'), makeCall('fetch'), makeCall('search')]
		const metrics = computeToolMetrics(calls)
		expect(metrics.totalToolCalls).toBe(3)
		expect(metrics.uniqueToolCalls).toBe(2)
		expect(metrics.repeatedToolCalls).toBe(1)
		expect(metrics.toolCallEfficiency).toBeCloseTo(0.667, 2)
	})

	it('counts failed calls', () => {
		const calls = [makeCall('a', true), makeCall('b', false), makeCall('c', false)]
		const metrics = computeToolMetrics(calls)
		expect(metrics.failedToolCalls).toBe(2)
	})

	it('computes error recovery rate', () => {
		const calls = [makeCall('a', false), makeCall('a', true), makeCall('b', false)]
		const metrics = computeToolMetrics(calls)
		expect(metrics.errorRecoveryRate).toBe(0.5)
	})

	it('returns 0 recovery when no failures', () => {
		const calls = [makeCall('a'), makeCall('b')]
		const metrics = computeToolMetrics(calls)
		expect(metrics.errorRecoveryRate).toBe(0)
	})

	it('returns 1.0 efficiency when no repeats', () => {
		const calls = [makeCall('a'), makeCall('b'), makeCall('c')]
		const metrics = computeToolMetrics(calls)
		expect(metrics.toolCallEfficiency).toBe(1)
	})
})

describe('computeAgentMetrics', () => {
	it('computes metrics from conversation result', () => {
		const result: ConversationResult = {
			name: 'test',
			passed: true,
			turns: [
				{
					turnIndex: 0,
					input: 'hi',
					output: 'hello',
					toolCalls: [makeCall('search'), makeCall('fetch')],
					usage: {
						totalInputTokens: 100,
						totalOutputTokens: 50,
						totalTokens: 150,
						totalCost: 0.001,
						iterations: 1,
					},
					durationMs: 200,
					assertions: [],
					passed: true,
				},
				{
					turnIndex: 1,
					input: 'bye',
					output: 'goodbye',
					toolCalls: [makeCall('search')],
					usage: {
						totalInputTokens: 80,
						totalOutputTokens: 40,
						totalTokens: 120,
						totalCost: 0.0008,
						iterations: 1,
					},
					durationMs: 150,
					assertions: [],
					passed: true,
				},
			],
			totalDurationMs: 350,
			totalTokens: 270,
			totalCost: 0.0018,
			totalToolCalls: 3,
			tags: [],
		}

		const metrics = computeAgentMetrics(result)

		expect(metrics.turnsToCompletion).toBe(2)
		expect(metrics.avgLatencyPerTurnMs).toBe(175)
		expect(metrics.totalTokens).toBe(270)
		expect(metrics.totalCost).toBeCloseTo(0.0018)
		expect(metrics.costPerTurn).toBeCloseTo(0.0009)
		expect(metrics.totalToolCalls).toBe(3)
		expect(metrics.uniqueToolCalls).toBe(2)
		expect(metrics.repeatedToolCalls).toBe(1)
	})

	it('handles zero turns', () => {
		const result: ConversationResult = {
			name: 'empty',
			passed: true,
			turns: [],
			totalDurationMs: 0,
			totalTokens: 0,
			totalCost: 0,
			totalToolCalls: 0,
			tags: [],
		}

		const metrics = computeAgentMetrics(result)
		expect(metrics.turnsToCompletion).toBe(0)
		expect(metrics.avgLatencyPerTurnMs).toBe(0)
		expect(metrics.costPerTurn).toBe(0)
	})
})

describe('formatAgentMetrics', () => {
	it('formats metrics as readable text', () => {
		const result: ConversationResult = {
			name: 'test',
			passed: true,
			turns: [
				{
					turnIndex: 0,
					input: 'hi',
					output: 'hello',
					toolCalls: [makeCall('search')],
					usage: {
						totalInputTokens: 100,
						totalOutputTokens: 50,
						totalTokens: 150,
						totalCost: 0.001,
						iterations: 1,
					},
					durationMs: 200,
					assertions: [],
					passed: true,
				},
			],
			totalDurationMs: 200,
			totalTokens: 150,
			totalCost: 0.001,
			totalToolCalls: 1,
			tags: [],
		}

		const metrics = computeAgentMetrics(result)
		const report = formatAgentMetrics(metrics)

		expect(report).toContain('Agent Metrics')
		expect(report).toContain('Turns to completion')
		expect(report).toContain('Tool call efficiency')
		expect(report).toContain('100.0%')
	})
})
