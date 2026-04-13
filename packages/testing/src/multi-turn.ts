import type { Message } from '@elsium-ai/core'
import { extractText } from '@elsium-ai/core'
import type { ToolExecutionResult } from '@elsium-ai/tools'
import type { ToolCallEntry } from './tool-assertions'
import { assertToolCalls } from './tool-assertions'

export type TurnAssertion =
	| { type: 'response_contains'; value: string }
	| { type: 'response_not_contains'; value: string }
	| { type: 'response_matches'; pattern: string; flags?: string }
	| { type: 'tool_called'; name: string; times?: number }
	| { type: 'tool_not_called'; name: string }
	| { type: 'tool_args_match'; name: string; args: Record<string, unknown> }
	| { type: 'max_iterations'; value: number }
	| { type: 'max_latency_ms'; value: number }
	| { type: 'custom'; name: string; fn: (result: TurnResult) => boolean }

export interface TurnResult {
	turnIndex: number
	name?: string
	input: string
	output: string
	toolCalls: ToolCallEntry[]
	usage: {
		totalInputTokens: number
		totalOutputTokens: number
		totalTokens: number
		totalCost: number
		iterations: number
	}
	durationMs: number
	assertions: Array<{ type: string; passed: boolean; message: string }>
	passed: boolean
}

export interface ConversationTurn {
	role: 'user'
	content: string | ((history: TurnResult[]) => string)
	assertions?: TurnAssertion[]
	name?: string
}

interface AgentResultLike {
	message: Message
	usage: {
		totalInputTokens: number
		totalOutputTokens: number
		totalTokens: number
		totalCost: number
		iterations: number
	}
	toolCalls: Array<{
		name: string
		arguments: Record<string, unknown>
		result: ToolExecutionResult
	}>
	traceId: string
}

export interface ConversationScenarioConfig {
	name: string
	description?: string
	turns: ConversationTurn[]
	runner: (messages: Message[]) => Promise<AgentResultLike>
	tags?: string[]
}

export interface ConversationResult {
	name: string
	passed: boolean
	turns: TurnResult[]
	totalDurationMs: number
	totalTokens: number
	totalCost: number
	totalToolCalls: number
	tags: string[]
}

function evaluateTurnAssertion(
	assertion: TurnAssertion,
	result: TurnResult,
): { type: string; passed: boolean; message: string } {
	switch (assertion.type) {
		case 'response_contains': {
			const passed = result.output.toLowerCase().includes(assertion.value.toLowerCase())
			return {
				type: 'response_contains',
				passed,
				message: passed
					? `Response contains "${assertion.value}"`
					: `Response does not contain "${assertion.value}"`,
			}
		}
		case 'response_not_contains': {
			const passed = !result.output.toLowerCase().includes(assertion.value.toLowerCase())
			return {
				type: 'response_not_contains',
				passed,
				message: passed
					? `Response does not contain "${assertion.value}"`
					: `Response contains "${assertion.value}" (should not)`,
			}
		}
		case 'response_matches': {
			const regex = new RegExp(assertion.pattern, assertion.flags)
			const passed = regex.test(result.output)
			return {
				type: 'response_matches',
				passed,
				message: passed
					? `Response matches /${assertion.pattern}/`
					: `Response does not match /${assertion.pattern}/`,
			}
		}
		case 'tool_called': {
			const [toolResult] = assertToolCalls(result.toolCalls, [
				{ type: 'called', name: assertion.name, times: assertion.times },
			])
			return toolResult
		}
		case 'tool_not_called': {
			const [toolResult] = assertToolCalls(result.toolCalls, [
				{ type: 'not_called', name: assertion.name },
			])
			return toolResult
		}
		case 'tool_args_match': {
			const [toolResult] = assertToolCalls(result.toolCalls, [
				{ type: 'called_with', name: assertion.name, args: assertion.args, partial: true },
			])
			return toolResult
		}
		case 'max_iterations': {
			const passed = result.usage.iterations <= assertion.value
			return {
				type: 'max_iterations',
				passed,
				message: passed
					? `Iterations ${result.usage.iterations} <= ${assertion.value}`
					: `Iterations ${result.usage.iterations} > ${assertion.value}`,
			}
		}
		case 'max_latency_ms': {
			const passed = result.durationMs <= assertion.value
			return {
				type: 'max_latency_ms',
				passed,
				message: passed
					? `Latency ${result.durationMs}ms <= ${assertion.value}ms`
					: `Latency ${result.durationMs}ms > ${assertion.value}ms`,
			}
		}
		case 'custom': {
			const passed = assertion.fn(result)
			return {
				type: `custom:${assertion.name}`,
				passed,
				message: passed
					? `Custom check "${assertion.name}" passed`
					: `Custom check "${assertion.name}" failed`,
			}
		}
	}
}

export async function runConversation(
	config: ConversationScenarioConfig,
): Promise<ConversationResult> {
	const suiteStart = performance.now()
	const turnResults: TurnResult[] = []
	const conversationMessages: Message[] = []

	for (let i = 0; i < config.turns.length; i++) {
		const turn = config.turns[i]
		const userContent =
			typeof turn.content === 'function' ? turn.content(turnResults) : turn.content

		conversationMessages.push({ role: 'user', content: userContent })

		const turnStart = performance.now()
		const agentResult = await config.runner([...conversationMessages])
		const durationMs = Math.round(performance.now() - turnStart)

		const outputText = extractText(agentResult.message.content)

		conversationMessages.push(agentResult.message)
		if (agentResult.toolCalls.length > 0) {
			conversationMessages.push({
				role: 'tool',
				content: '',
				toolResults: agentResult.toolCalls.map((tc) => ({
					toolCallId: tc.result.toolCallId,
					content: tc.result.success ? String(tc.result.data ?? '') : `Error: ${tc.result.error}`,
					isError: !tc.result.success,
				})),
			})
		}

		const turnResult: TurnResult = {
			turnIndex: i,
			name: turn.name,
			input: userContent,
			output: outputText,
			toolCalls: agentResult.toolCalls,
			usage: agentResult.usage,
			durationMs,
			assertions: [],
			passed: true,
		}

		if (turn.assertions) {
			turnResult.assertions = turn.assertions.map((a) => evaluateTurnAssertion(a, turnResult))
			turnResult.passed = turnResult.assertions.every((a) => a.passed)
		}

		turnResults.push(turnResult)
	}

	const totalDurationMs = Math.round(performance.now() - suiteStart)

	return {
		name: config.name,
		passed: turnResults.every((t) => t.passed),
		turns: turnResults,
		totalDurationMs,
		totalTokens: turnResults.reduce((sum, t) => sum + t.usage.totalTokens, 0),
		totalCost: turnResults.reduce((sum, t) => sum + t.usage.totalCost, 0),
		totalToolCalls: turnResults.reduce((sum, t) => sum + t.toolCalls.length, 0),
		tags: config.tags ?? [],
	}
}

export function formatConversationReport(result: ConversationResult): string {
	const lines: string[] = []

	lines.push(`\n  Conversation: ${result.name}`)
	lines.push(`  ${'─'.repeat(50)}`)

	for (const turn of result.turns) {
		const icon = turn.passed ? 'PASS' : 'FAIL'
		const label = turn.name ?? `Turn ${turn.turnIndex + 1}`
		lines.push(`  [${icon}] ${label} (${turn.durationMs}ms, ${turn.toolCalls.length} tool calls)`)

		for (const a of turn.assertions) {
			if (!a.passed) {
				lines.push(`         ${a.message}`)
			}
		}
	}

	lines.push(`  ${'─'.repeat(50)}`)

	const passedTurns = result.turns.filter((t) => t.passed).length
	lines.push(
		`  ${passedTurns}/${result.turns.length} turns passed | ${result.totalTokens} tokens | $${result.totalCost.toFixed(4)} | ${result.totalDurationMs}ms`,
	)
	lines.push('')

	return lines.join('\n')
}
