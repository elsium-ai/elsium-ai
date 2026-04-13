import { describe, expect, it } from 'vitest'
import type { AgentEvalConfig } from './agent-eval'
import { formatAgentEvalReport, runAgentEval } from './agent-eval'

function makeAgentResult(
	content: string,
	toolCalls: Array<{ name: string; arguments: Record<string, unknown>; success?: boolean }> = [],
) {
	return {
		message: { role: 'assistant' as const, content },
		usage: {
			totalInputTokens: 100,
			totalOutputTokens: 50,
			totalTokens: 150,
			totalCost: 0.001,
			iterations: 1,
		},
		toolCalls: toolCalls.map((tc) => ({
			name: tc.name,
			arguments: tc.arguments,
			result: {
				success: tc.success ?? true,
				data: 'ok',
				toolCallId: `call-${tc.name}`,
				durationMs: 5,
			},
		})),
		traceId: 'trace-test',
	}
}

describe('runAgentEval', () => {
	it('runs single-turn cases', async () => {
		const config: AgentEvalConfig = {
			name: 'mixed-eval',
			cases: [
				{
					type: 'single',
					name: 'greeting-test',
					input: 'Hello',
					criteria: [{ type: 'contains', value: 'world' }],
				},
			],
			singleTurnRunner: async () => 'Hello world!',
			multiTurnRunner: async () => makeAgentResult('ok'),
		}

		const result = await runAgentEval(config)

		expect(result.total).toBe(1)
		expect(result.passed).toBe(1)
		expect(result.score).toBe(1)
		expect(result.results[0].type).toBe('single')
	})

	it('runs conversation cases', async () => {
		const config: AgentEvalConfig = {
			name: 'conv-eval',
			cases: [
				{
					type: 'conversation',
					name: 'chat-test',
					turns: [
						{
							role: 'user',
							content: 'Hello',
							assertions: [{ type: 'response_contains', value: 'Hi' }],
						},
					],
				},
			],
			singleTurnRunner: async () => 'ok',
			multiTurnRunner: async () => makeAgentResult('Hi there!'),
		}

		const result = await runAgentEval(config)

		expect(result.total).toBe(1)
		expect(result.passed).toBe(1)
		expect(result.results[0].type).toBe('conversation')
	})

	it('mixes single-turn and multi-turn cases', async () => {
		const config: AgentEvalConfig = {
			name: 'mixed-eval',
			cases: [
				{
					type: 'single',
					name: 'single-pass',
					input: 'test',
					criteria: [{ type: 'contains', value: 'ok' }],
				},
				{
					type: 'conversation',
					name: 'conv-pass',
					turns: [
						{
							role: 'user',
							content: 'Hello',
							assertions: [{ type: 'response_contains', value: 'Hi' }],
						},
					],
				},
				{
					type: 'single',
					name: 'single-fail',
					input: 'test',
					criteria: [{ type: 'contains', value: 'MISSING' }],
				},
			],
			singleTurnRunner: async () => 'ok response',
			multiTurnRunner: async () => makeAgentResult('Hi there!'),
		}

		const result = await runAgentEval(config)

		expect(result.total).toBe(3)
		expect(result.passed).toBe(2)
		expect(result.failed).toBe(1)
		expect(result.results[0].type).toBe('single')
		expect(result.results[0].passed).toBe(true)
		expect(result.results[1].type).toBe('conversation')
		expect(result.results[1].passed).toBe(true)
		expect(result.results[2].type).toBe('single')
		expect(result.results[2].passed).toBe(false)
	})

	it('computes aggregated metrics from conversations', async () => {
		const config: AgentEvalConfig = {
			name: 'metrics-eval',
			cases: [
				{
					type: 'conversation',
					name: 'conv-1',
					turns: [
						{ role: 'user', content: 'Hi' },
						{ role: 'user', content: 'Bye' },
					],
				},
			],
			singleTurnRunner: async () => 'ok',
			multiTurnRunner: async () => makeAgentResult('response', [{ name: 'search', arguments: {} }]),
		}

		const result = await runAgentEval(config)

		expect(result.metrics).not.toBeNull()
		expect(result.metrics?.turnsToCompletion).toBe(2)
		expect(result.metrics?.totalToolCalls).toBe(2)
		expect(result.metrics?.toolCallEfficiency).toBe(0.5)
	})

	it('returns null metrics when no conversations', async () => {
		const config: AgentEvalConfig = {
			name: 'single-only',
			cases: [{ type: 'single', name: 'test', input: 'hi', criteria: [] }],
			singleTurnRunner: async () => 'ok',
			multiTurnRunner: async () => makeAgentResult('ok'),
		}

		const result = await runAgentEval(config)
		expect(result.metrics).toBeNull()
	})

	it('handles runner errors gracefully', async () => {
		const config: AgentEvalConfig = {
			name: 'error-eval',
			cases: [{ type: 'single', name: 'crashing', input: 'hi' }],
			singleTurnRunner: async () => {
				throw new Error('Runner crashed')
			},
			multiTurnRunner: async () => makeAgentResult('ok'),
		}

		const result = await runAgentEval(config)

		expect(result.passed).toBe(0)
		expect(result.failed).toBe(1)
		expect(result.results[0].passed).toBe(false)
	})

	it('supports expected field in single cases', async () => {
		const config: AgentEvalConfig = {
			name: 'expected-test',
			cases: [{ type: 'single', name: 'has-expected', input: 'What is 2+2?', expected: '4' }],
			singleTurnRunner: async () => 'The answer is 4.',
			multiTurnRunner: async () => makeAgentResult('ok'),
		}

		const result = await runAgentEval(config)
		expect(result.passed).toBe(1)
	})

	it('supports concurrency', async () => {
		let maxConcurrent = 0
		let current = 0

		const config: AgentEvalConfig = {
			name: 'concurrent-eval',
			cases: Array.from({ length: 4 }, (_, i) => ({
				type: 'single' as const,
				name: `case-${i}`,
				input: `test-${i}`,
				criteria: [],
			})),
			singleTurnRunner: async () => {
				current++
				maxConcurrent = Math.max(maxConcurrent, current)
				await new Promise((r) => setTimeout(r, 10))
				current--
				return 'ok'
			},
			multiTurnRunner: async () => makeAgentResult('ok'),
			concurrency: 2,
		}

		const result = await runAgentEval(config)
		expect(result.total).toBe(4)
		expect(maxConcurrent).toBeLessThanOrEqual(2)
	})
})

describe('formatAgentEvalReport', () => {
	it('formats a mixed report', async () => {
		const config: AgentEvalConfig = {
			name: 'report-test',
			cases: [
				{
					type: 'single',
					name: 'pass-case',
					input: 'hi',
					criteria: [{ type: 'contains', value: 'ok' }],
				},
				{
					type: 'conversation',
					name: 'conv-case',
					turns: [
						{
							role: 'user',
							content: 'Hello',
							assertions: [{ type: 'response_contains', value: 'MISSING' }],
						},
					],
				},
			],
			singleTurnRunner: async () => 'ok',
			multiTurnRunner: async () => makeAgentResult('Hi'),
		}

		const result = await runAgentEval(config)
		const report = formatAgentEvalReport(result)

		expect(report).toContain('Agent Eval: report-test')
		expect(report).toContain('[PASS] pass-case')
		expect(report).toContain('[FAIL] conv-case (multi-turn)')
		expect(report).toContain('MISSING')
		expect(report).toContain('Score:')
	})
})
