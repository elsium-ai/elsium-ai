import { describe, expect, it } from 'vitest'
import type { ConversationScenarioConfig } from './multi-turn'
import { formatConversationReport, runConversation } from './multi-turn'

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

describe('runConversation', () => {
	it('runs a basic multi-turn conversation', async () => {
		let callCount = 0
		const config: ConversationScenarioConfig = {
			name: 'basic-chat',
			turns: [
				{ role: 'user', content: 'Hello' },
				{ role: 'user', content: 'How are you?' },
			],
			runner: async () => {
				callCount++
				return makeAgentResult(`Response ${callCount}`)
			},
		}

		const result = await runConversation(config)

		expect(result.name).toBe('basic-chat')
		expect(result.passed).toBe(true)
		expect(result.turns).toHaveLength(2)
		expect(result.turns[0].output).toBe('Response 1')
		expect(result.turns[1].output).toBe('Response 2')
		expect(result.totalTokens).toBe(300)
		expect(result.totalCost).toBeCloseTo(0.002)
	})

	it('accumulates messages across turns', async () => {
		const receivedMessages: Array<Array<{ role: string; content: string }>> = []

		const config: ConversationScenarioConfig = {
			name: 'accumulation-test',
			turns: [
				{ role: 'user', content: 'First message' },
				{ role: 'user', content: 'Second message' },
			],
			runner: async (messages) => {
				receivedMessages.push(messages.map((m) => ({ role: m.role, content: String(m.content) })))
				return makeAgentResult('Ok')
			},
		}

		await runConversation(config)

		expect(receivedMessages[0]).toHaveLength(1)
		expect(receivedMessages[1].length).toBeGreaterThan(1)
		expect(receivedMessages[1][0].content).toBe('First message')
	})

	it('supports dynamic turn content', async () => {
		const config: ConversationScenarioConfig = {
			name: 'dynamic-turns',
			turns: [
				{ role: 'user', content: 'What is 2+2?' },
				{
					role: 'user',
					content: (history) => `You said: ${history[0].output}. Is that correct?`,
				},
			],
			runner: async () => makeAgentResult('The answer is 4'),
		}

		const result = await runConversation(config)

		expect(result.turns[1].input).toBe('You said: The answer is 4. Is that correct?')
	})

	describe('assertions', () => {
		it('evaluates response_contains assertion', async () => {
			const config: ConversationScenarioConfig = {
				name: 'contains-test',
				turns: [
					{
						role: 'user',
						content: 'Hello',
						assertions: [{ type: 'response_contains', value: 'world' }],
					},
				],
				runner: async () => makeAgentResult('Hello world!'),
			}

			const result = await runConversation(config)
			expect(result.passed).toBe(true)
			expect(result.turns[0].assertions[0].passed).toBe(true)
		})

		it('evaluates response_not_contains assertion', async () => {
			const config: ConversationScenarioConfig = {
				name: 'not-contains-test',
				turns: [
					{
						role: 'user',
						content: 'Hello',
						assertions: [{ type: 'response_not_contains', value: 'error' }],
					},
				],
				runner: async () => makeAgentResult('All good'),
			}

			const result = await runConversation(config)
			expect(result.passed).toBe(true)
		})

		it('evaluates response_matches assertion', async () => {
			const config: ConversationScenarioConfig = {
				name: 'matches-test',
				turns: [
					{
						role: 'user',
						content: 'Give me a number',
						assertions: [{ type: 'response_matches', pattern: '\\d+' }],
					},
				],
				runner: async () => makeAgentResult('The answer is 42'),
			}

			const result = await runConversation(config)
			expect(result.passed).toBe(true)
		})

		it('evaluates tool_called assertion', async () => {
			const config: ConversationScenarioConfig = {
				name: 'tool-called-test',
				turns: [
					{
						role: 'user',
						content: 'Search for weather',
						assertions: [{ type: 'tool_called', name: 'search' }],
					},
				],
				runner: async () =>
					makeAgentResult('Found results', [{ name: 'search', arguments: { query: 'weather' } }]),
			}

			const result = await runConversation(config)
			expect(result.passed).toBe(true)
		})

		it('evaluates tool_not_called assertion', async () => {
			const config: ConversationScenarioConfig = {
				name: 'tool-not-called-test',
				turns: [
					{
						role: 'user',
						content: 'Hello',
						assertions: [{ type: 'tool_not_called', name: 'delete' }],
					},
				],
				runner: async () => makeAgentResult('Hi there'),
			}

			const result = await runConversation(config)
			expect(result.passed).toBe(true)
		})

		it('evaluates tool_args_match assertion', async () => {
			const config: ConversationScenarioConfig = {
				name: 'tool-args-test',
				turns: [
					{
						role: 'user',
						content: 'Search',
						assertions: [
							{
								type: 'tool_args_match',
								name: 'search',
								args: { query: 'weather' },
							},
						],
					},
				],
				runner: async () =>
					makeAgentResult('Results', [
						{ name: 'search', arguments: { query: 'weather', limit: 10 } },
					]),
			}

			const result = await runConversation(config)
			expect(result.passed).toBe(true)
		})

		it('evaluates max_iterations assertion', async () => {
			const config: ConversationScenarioConfig = {
				name: 'iterations-test',
				turns: [
					{
						role: 'user',
						content: 'Hello',
						assertions: [{ type: 'max_iterations', value: 5 }],
					},
				],
				runner: async () => makeAgentResult('Hi'),
			}

			const result = await runConversation(config)
			expect(result.passed).toBe(true)
		})

		it('evaluates max_latency_ms assertion', async () => {
			const config: ConversationScenarioConfig = {
				name: 'latency-test',
				turns: [
					{
						role: 'user',
						content: 'Hello',
						assertions: [{ type: 'max_latency_ms', value: 5000 }],
					},
				],
				runner: async () => makeAgentResult('Hi'),
			}

			const result = await runConversation(config)
			expect(result.passed).toBe(true)
		})

		it('evaluates custom assertion', async () => {
			const config: ConversationScenarioConfig = {
				name: 'custom-test',
				turns: [
					{
						role: 'user',
						content: 'Hello',
						assertions: [
							{
								type: 'custom',
								name: 'short-response',
								fn: (r) => r.output.length < 100,
							},
						],
					},
				],
				runner: async () => makeAgentResult('Hi'),
			}

			const result = await runConversation(config)
			expect(result.passed).toBe(true)
		})

		it('marks turn as failed when assertion fails', async () => {
			const config: ConversationScenarioConfig = {
				name: 'failing-test',
				turns: [
					{
						role: 'user',
						content: 'Hello',
						assertions: [{ type: 'response_contains', value: 'MISSING' }],
					},
				],
				runner: async () => makeAgentResult('Hi there'),
			}

			const result = await runConversation(config)
			expect(result.passed).toBe(false)
			expect(result.turns[0].passed).toBe(false)
			expect(result.turns[0].assertions[0].passed).toBe(false)
		})
	})

	it('tracks total tool calls', async () => {
		const config: ConversationScenarioConfig = {
			name: 'tool-count-test',
			turns: [
				{ role: 'user', content: 'Do things' },
				{ role: 'user', content: 'More things' },
			],
			runner: async () =>
				makeAgentResult('Done', [
					{ name: 'tool1', arguments: {} },
					{ name: 'tool2', arguments: {} },
				]),
		}

		const result = await runConversation(config)
		expect(result.totalToolCalls).toBe(4)
	})

	it('preserves turn names', async () => {
		const config: ConversationScenarioConfig = {
			name: 'named-turns',
			turns: [
				{ role: 'user', content: 'Hello', name: 'greeting' },
				{ role: 'user', content: 'Bye', name: 'farewell' },
			],
			runner: async () => makeAgentResult('Ok'),
		}

		const result = await runConversation(config)
		expect(result.turns[0].name).toBe('greeting')
		expect(result.turns[1].name).toBe('farewell')
	})
})

describe('formatConversationReport', () => {
	it('formats a passing report', async () => {
		const config: ConversationScenarioConfig = {
			name: 'format-test',
			turns: [
				{
					role: 'user',
					content: 'Hello',
					name: 'greeting',
					assertions: [{ type: 'response_contains', value: 'Hi' }],
				},
			],
			runner: async () => makeAgentResult('Hi there'),
		}

		const result = await runConversation(config)
		const report = formatConversationReport(result)

		expect(report).toContain('Conversation: format-test')
		expect(report).toContain('[PASS]')
		expect(report).toContain('greeting')
		expect(report).toContain('1/1 turns passed')
	})

	it('formats a failing report with details', async () => {
		const config: ConversationScenarioConfig = {
			name: 'fail-report',
			turns: [
				{
					role: 'user',
					content: 'Hello',
					assertions: [{ type: 'response_contains', value: 'MISSING' }],
				},
			],
			runner: async () => makeAgentResult('Hi'),
		}

		const result = await runConversation(config)
		const report = formatConversationReport(result)

		expect(report).toContain('[FAIL]')
		expect(report).toContain('MISSING')
	})
})
