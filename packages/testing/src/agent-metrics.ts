import type { ConversationResult } from './multi-turn'
import type { ToolCallEntry } from './tool-assertions'

export interface ToolMetrics {
	totalToolCalls: number
	uniqueToolCalls: number
	repeatedToolCalls: number
	failedToolCalls: number
	errorRecoveryRate: number
	toolCallEfficiency: number
}

export interface AgentMetrics extends ToolMetrics {
	turnsToCompletion: number
	avgLatencyPerTurnMs: number
	totalTokens: number
	totalCost: number
	costPerTurn: number
}

export function computeToolMetrics(calls: ToolCallEntry[]): ToolMetrics {
	if (calls.length === 0) {
		return {
			totalToolCalls: 0,
			uniqueToolCalls: 0,
			repeatedToolCalls: 0,
			failedToolCalls: 0,
			errorRecoveryRate: 0,
			toolCallEfficiency: 1,
		}
	}

	const nameCount = new Map<string, number>()
	for (const call of calls) {
		nameCount.set(call.name, (nameCount.get(call.name) ?? 0) + 1)
	}

	const uniqueToolCalls = nameCount.size
	const repeatedToolCalls = calls.length - uniqueToolCalls
	const failedToolCalls = calls.filter((c) => !c.result.success).length

	const failedNames = new Set<string>()
	const recoveredNames = new Set<string>()
	for (const call of calls) {
		if (!call.result.success) {
			failedNames.add(call.name)
		} else if (failedNames.has(call.name)) {
			recoveredNames.add(call.name)
		}
	}
	const errorRecoveryRate = failedNames.size > 0 ? recoveredNames.size / failedNames.size : 0

	const toolCallEfficiency = 1 - repeatedToolCalls / calls.length

	return {
		totalToolCalls: calls.length,
		uniqueToolCalls,
		repeatedToolCalls,
		failedToolCalls,
		errorRecoveryRate,
		toolCallEfficiency,
	}
}

export function computeAgentMetrics(result: ConversationResult): AgentMetrics {
	const allCalls: ToolCallEntry[] = result.turns.flatMap((t) => t.toolCalls)
	const toolMetrics = computeToolMetrics(allCalls)

	const turnsToCompletion = result.turns.length
	const avgLatencyPerTurnMs =
		turnsToCompletion > 0 ? Math.round(result.totalDurationMs / turnsToCompletion) : 0
	const costPerTurn = turnsToCompletion > 0 ? result.totalCost / turnsToCompletion : 0

	return {
		...toolMetrics,
		turnsToCompletion,
		avgLatencyPerTurnMs,
		totalTokens: result.totalTokens,
		totalCost: result.totalCost,
		costPerTurn,
	}
}

export function formatAgentMetrics(metrics: AgentMetrics): string {
	const lines: string[] = []

	lines.push('\n  Agent Metrics')
	lines.push(`  ${'─'.repeat(50)}`)
	lines.push(`  Turns to completion:    ${metrics.turnsToCompletion}`)
	lines.push(`  Avg latency per turn:   ${metrics.avgLatencyPerTurnMs}ms`)
	lines.push(`  Total tokens:           ${metrics.totalTokens}`)
	lines.push(`  Total cost:             $${metrics.totalCost.toFixed(4)}`)
	lines.push(`  Cost per turn:          $${metrics.costPerTurn.toFixed(4)}`)
	lines.push(`  ${'─'.repeat(50)}`)
	lines.push(`  Tool calls:             ${metrics.totalToolCalls}`)
	lines.push(`  Unique tools used:      ${metrics.uniqueToolCalls}`)
	lines.push(`  Repeated calls:         ${metrics.repeatedToolCalls}`)
	lines.push(`  Failed calls:           ${metrics.failedToolCalls}`)
	lines.push(`  Tool call efficiency:   ${(metrics.toolCallEfficiency * 100).toFixed(1)}%`)
	lines.push(`  Error recovery rate:    ${(metrics.errorRecoveryRate * 100).toFixed(1)}%`)
	lines.push('')

	return lines.join('\n')
}
