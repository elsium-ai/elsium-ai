import type { Message } from '@elsium-ai/core'
import type { ToolExecutionResult } from '@elsium-ai/tools'
import type { AgentMetrics } from './agent-metrics'
import { computeAgentMetrics } from './agent-metrics'
import type { EvalCriterion, EvalResult } from './eval'
import type { ConversationResult, ConversationTurn } from './multi-turn'
import { runConversation } from './multi-turn'

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

export type AgentEvalCase =
	| {
			type: 'single'
			name: string
			input: string
			expected?: string
			criteria?: EvalCriterion[]
			tags?: string[]
	  }
	| {
			type: 'conversation'
			name: string
			turns: ConversationTurn[]
			tags?: string[]
	  }

export interface AgentEvalConfig {
	name: string
	cases: AgentEvalCase[]
	singleTurnRunner: (input: string) => Promise<string>
	multiTurnRunner: (messages: Message[]) => Promise<AgentResultLike>
	concurrency?: number
}

export interface AgentEvalCaseResult {
	type: 'single' | 'conversation'
	name: string
	passed: boolean
	score: number
	durationMs: number
	tags: string[]
	detail: EvalResult | ConversationResult
}

export interface AgentEvalResult {
	name: string
	total: number
	passed: number
	failed: number
	score: number
	results: AgentEvalCaseResult[]
	metrics: AgentMetrics | null
	durationMs: number
}

function evalContains(
	output: string,
	criterion: Extract<EvalCriterion, { type: 'contains' }>,
): { passed: boolean; message: string } {
	const target = criterion.caseSensitive ? criterion.value : criterion.value.toLowerCase()
	const haystack = criterion.caseSensitive ? output : output.toLowerCase()
	const passed = haystack.includes(target)
	return {
		passed,
		message: passed ? `Contains "${criterion.value}"` : `Does not contain "${criterion.value}"`,
	}
}

function evalNotContains(
	output: string,
	criterion: Extract<EvalCriterion, { type: 'not_contains' }>,
): { passed: boolean; message: string } {
	const target = criterion.caseSensitive ? criterion.value : criterion.value.toLowerCase()
	const haystack = criterion.caseSensitive ? output : output.toLowerCase()
	const passed = !haystack.includes(target)
	return {
		passed,
		message: passed
			? `Does not contain "${criterion.value}"`
			: `Contains "${criterion.value}" (should not)`,
	}
}

function evaluateCriterionSync(
	output: string,
	criterion: EvalCriterion,
): { passed: boolean; message: string } {
	switch (criterion.type) {
		case 'contains':
			return evalContains(output, criterion)
		case 'not_contains':
			return evalNotContains(output, criterion)
		case 'matches': {
			const passed = new RegExp(criterion.pattern, criterion.flags).test(output)
			return {
				passed,
				message: passed
					? `Matches /${criterion.pattern}/`
					: `Does not match /${criterion.pattern}/`,
			}
		}
		case 'length_min': {
			const passed = output.length >= criterion.value
			return {
				passed,
				message: `Length ${output.length} ${passed ? '>=' : '<'} ${criterion.value}`,
			}
		}
		case 'length_max': {
			const passed = output.length <= criterion.value
			return {
				passed,
				message: `Length ${output.length} ${passed ? '<=' : '>'} ${criterion.value}`,
			}
		}
		case 'json_valid': {
			try {
				JSON.parse(output)
				return { passed: true, message: 'Valid JSON' }
			} catch {
				return { passed: false, message: 'Invalid JSON' }
			}
		}
		case 'custom': {
			const passed = criterion.fn(output)
			return {
				passed,
				message: passed
					? `Custom check "${criterion.name}" passed`
					: `Custom check "${criterion.name}" failed`,
			}
		}
		default:
			return { passed: true, message: 'Skipped (async criterion)' }
	}
}

async function runSingleCase(
	evalCase: Extract<AgentEvalCase, { type: 'single' }>,
	runner: (input: string) => Promise<string>,
): Promise<AgentEvalCaseResult> {
	const start = performance.now()

	let output: string
	try {
		output = await runner(evalCase.input)
	} catch (error) {
		const durationMs = Math.round(performance.now() - start)
		const evalResult: EvalResult = {
			name: evalCase.name,
			passed: false,
			score: 0,
			criteria: [
				{
					type: 'error',
					passed: false,
					message: `Runner error: ${error instanceof Error ? error.message : String(error)}`,
				},
			],
			input: evalCase.input,
			output: '',
			durationMs,
			tags: evalCase.tags ?? [],
		}
		return {
			type: 'single',
			name: evalCase.name,
			passed: false,
			score: 0,
			durationMs,
			tags: evalCase.tags ?? [],
			detail: evalResult,
		}
	}

	const criteriaResults: Array<{ type: string; passed: boolean; message: string }> = []

	if (evalCase.expected !== undefined) {
		const passed = output.includes(evalCase.expected)
		criteriaResults.push({
			type: 'expected',
			passed,
			message: passed
				? 'Output contains expected text'
				: `Output does not contain expected "${evalCase.expected}"`,
		})
	}

	for (const criterion of evalCase.criteria ?? []) {
		const result = evaluateCriterionSync(output, criterion)
		criteriaResults.push({ type: criterion.type, ...result })
	}

	const passedCount = criteriaResults.filter((c) => c.passed).length
	const totalCount = criteriaResults.length
	const allPassed = totalCount === 0 || passedCount === totalCount
	const score = totalCount === 0 ? 1 : passedCount / totalCount
	const durationMs = Math.round(performance.now() - start)

	const evalResult: EvalResult = {
		name: evalCase.name,
		passed: allPassed,
		score,
		criteria: criteriaResults,
		input: evalCase.input,
		output,
		durationMs,
		tags: evalCase.tags ?? [],
	}

	return {
		type: 'single',
		name: evalCase.name,
		passed: allPassed,
		score,
		durationMs,
		tags: evalCase.tags ?? [],
		detail: evalResult,
	}
}

async function runConversationCase(
	evalCase: Extract<AgentEvalCase, { type: 'conversation' }>,
	runner: (messages: Message[]) => Promise<AgentResultLike>,
): Promise<AgentEvalCaseResult> {
	const conversationResult = await runConversation({
		name: evalCase.name,
		turns: evalCase.turns,
		runner,
		tags: evalCase.tags,
	})

	const passedTurns = conversationResult.turns.filter((t) => t.passed).length
	const score =
		conversationResult.turns.length > 0 ? passedTurns / conversationResult.turns.length : 1

	return {
		type: 'conversation',
		name: evalCase.name,
		passed: conversationResult.passed,
		score,
		durationMs: conversationResult.totalDurationMs,
		tags: evalCase.tags ?? [],
		detail: conversationResult,
	}
}

export async function runAgentEval(config: AgentEvalConfig): Promise<AgentEvalResult> {
	const suiteStart = performance.now()
	const concurrency = config.concurrency ?? 1
	const results: AgentEvalCaseResult[] = []

	const runCase = async (evalCase: AgentEvalCase): Promise<AgentEvalCaseResult> => {
		if (evalCase.type === 'single') {
			return runSingleCase(evalCase, config.singleTurnRunner)
		}
		return runConversationCase(evalCase, config.multiTurnRunner)
	}

	if (concurrency <= 1) {
		for (const evalCase of config.cases) {
			results.push(await runCase(evalCase))
		}
	} else {
		for (let i = 0; i < config.cases.length; i += concurrency) {
			const batch = config.cases.slice(i, i + concurrency)
			const batchResults = await Promise.all(batch.map(runCase))
			results.push(...batchResults)
		}
	}

	const passed = results.filter((r) => r.passed).length
	const failed = results.length - passed

	const conversationResults = results
		.filter((r) => r.type === 'conversation')
		.map((r) => r.detail as ConversationResult)

	let metrics: AgentMetrics | null = null
	if (conversationResults.length > 0) {
		const allMetrics = conversationResults.map(computeAgentMetrics)
		metrics = {
			turnsToCompletion: Math.round(
				allMetrics.reduce((s, m) => s + m.turnsToCompletion, 0) / allMetrics.length,
			),
			avgLatencyPerTurnMs: Math.round(
				allMetrics.reduce((s, m) => s + m.avgLatencyPerTurnMs, 0) / allMetrics.length,
			),
			totalTokens: allMetrics.reduce((s, m) => s + m.totalTokens, 0),
			totalCost: allMetrics.reduce((s, m) => s + m.totalCost, 0),
			costPerTurn: allMetrics.reduce((s, m) => s + m.costPerTurn, 0) / allMetrics.length,
			totalToolCalls: allMetrics.reduce((s, m) => s + m.totalToolCalls, 0),
			uniqueToolCalls: allMetrics.reduce((s, m) => s + m.uniqueToolCalls, 0),
			repeatedToolCalls: allMetrics.reduce((s, m) => s + m.repeatedToolCalls, 0),
			failedToolCalls: allMetrics.reduce((s, m) => s + m.failedToolCalls, 0),
			toolCallEfficiency:
				allMetrics.reduce((s, m) => s + m.toolCallEfficiency, 0) / allMetrics.length,
			errorRecoveryRate:
				allMetrics.reduce((s, m) => s + m.errorRecoveryRate, 0) / allMetrics.length,
		}
	}

	return {
		name: config.name,
		total: results.length,
		passed,
		failed,
		score: results.length > 0 ? passed / results.length : 0,
		results,
		metrics,
		durationMs: Math.round(performance.now() - suiteStart),
	}
}

function formatSingleFailure(detail: EvalResult): string[] {
	return detail.criteria.filter((c) => !c.passed).map((c) => `         ${c.message}`)
}

function formatConversationFailure(detail: ConversationResult): string[] {
	const lines: string[] = []
	for (const turn of detail.turns) {
		if (!turn.passed) {
			const label = turn.name ?? `Turn ${turn.turnIndex + 1}`
			for (const a of turn.assertions) {
				if (!a.passed) lines.push(`         ${label}: ${a.message}`)
			}
		}
	}
	return lines
}

export function formatAgentEvalReport(result: AgentEvalResult): string {
	const lines: string[] = []

	lines.push(`\n  Agent Eval: ${result.name}`)
	lines.push(`  ${'─'.repeat(50)}`)

	for (const r of result.results) {
		const icon = r.passed ? 'PASS' : 'FAIL'
		const typeLabel = r.type === 'conversation' ? ' (multi-turn)' : ''
		lines.push(`  [${icon}] ${r.name}${typeLabel} (${r.durationMs}ms)`)

		if (!r.passed) {
			const failureLines =
				r.type === 'single'
					? formatSingleFailure(r.detail as EvalResult)
					: formatConversationFailure(r.detail as ConversationResult)
			lines.push(...failureLines)
		}
	}

	lines.push(`  ${'─'.repeat(50)}`)
	lines.push(
		`  Score: ${(result.score * 100).toFixed(1)}% | ${result.passed}/${result.total} passed | ${result.durationMs}ms`,
	)

	if (result.metrics) {
		const m = result.metrics
		lines.push(
			`  Efficiency: ${(m.toolCallEfficiency * 100).toFixed(1)}% | Recovery: ${(m.errorRecoveryRate * 100).toFixed(1)}% | Cost: $${m.totalCost.toFixed(4)}`,
		)
	}

	lines.push('')
	return lines.join('\n')
}
