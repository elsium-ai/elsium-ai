import type { ToolExecutionResult } from '@elsium-ai/tools'
import type { EvalCriterion } from './eval'

export type ToolCallEntry = {
	name: string
	arguments: Record<string, unknown>
	result: ToolExecutionResult
}

export type ToolAssertion =
	| { type: 'called'; name: string; times?: number }
	| { type: 'not_called'; name: string }
	| { type: 'called_with'; name: string; args: Record<string, unknown>; partial?: boolean }
	| { type: 'called_in_order'; names: string[] }
	| { type: 'all_succeeded' }
	| { type: 'none_failed' }
	| { type: 'call_count'; min?: number; max?: number }
	| { type: 'no_repeated_calls'; name?: string }
	| { type: 'custom'; name: string; fn: (calls: ToolCallEntry[]) => boolean }

export interface ToolAssertionResult {
	type: string
	passed: boolean
	message: string
}

function assertCalled(
	calls: ToolCallEntry[],
	assertion: Extract<ToolAssertion, { type: 'called' }>,
): ToolAssertionResult {
	const matching = calls.filter((c) => c.name === assertion.name)
	if (assertion.times !== undefined) {
		const passed = matching.length === assertion.times
		return {
			type: 'called',
			passed,
			message: passed
				? `"${assertion.name}" called ${assertion.times} time(s)`
				: `"${assertion.name}" called ${matching.length} time(s), expected ${assertion.times}`,
		}
	}
	const passed = matching.length > 0
	return {
		type: 'called',
		passed,
		message: passed ? `"${assertion.name}" was called` : `"${assertion.name}" was never called`,
	}
}

function assertNotCalled(
	calls: ToolCallEntry[],
	assertion: Extract<ToolAssertion, { type: 'not_called' }>,
): ToolAssertionResult {
	const matching = calls.filter((c) => c.name === assertion.name)
	const passed = matching.length === 0
	return {
		type: 'not_called',
		passed,
		message: passed
			? `"${assertion.name}" was not called`
			: `"${assertion.name}" was called ${matching.length} time(s) (expected none)`,
	}
}

function matchArgs(
	actual: Record<string, unknown>,
	expected: Record<string, unknown>,
	partial: boolean,
): boolean {
	const expectedKeys = Object.keys(expected)
	if (!partial && Object.keys(actual).length !== expectedKeys.length) return false
	for (const key of expectedKeys) {
		if (JSON.stringify(actual[key]) !== JSON.stringify(expected[key])) return false
	}
	return true
}

function assertCalledWith(
	calls: ToolCallEntry[],
	assertion: Extract<ToolAssertion, { type: 'called_with' }>,
): ToolAssertionResult {
	const partial = assertion.partial ?? true
	const matching = calls.filter(
		(c) => c.name === assertion.name && matchArgs(c.arguments, assertion.args, partial),
	)
	const passed = matching.length > 0
	return {
		type: 'called_with',
		passed,
		message: passed
			? `"${assertion.name}" called with matching args`
			: `"${assertion.name}" never called with expected args ${JSON.stringify(assertion.args)}`,
	}
}

function assertCalledInOrder(
	calls: ToolCallEntry[],
	assertion: Extract<ToolAssertion, { type: 'called_in_order' }>,
): ToolAssertionResult {
	const names = calls.map((c) => c.name)
	let searchFrom = 0
	for (const expected of assertion.names) {
		const idx = names.indexOf(expected, searchFrom)
		if (idx === -1) {
			return {
				type: 'called_in_order',
				passed: false,
				message: `Expected "${expected}" after position ${searchFrom}, not found in [${names.join(', ')}]`,
			}
		}
		searchFrom = idx + 1
	}
	return {
		type: 'called_in_order',
		passed: true,
		message: `Tools called in order: [${assertion.names.join(', ')}]`,
	}
}

function assertAllSucceeded(calls: ToolCallEntry[]): ToolAssertionResult {
	const failed = calls.filter((c) => !c.result.success)
	const passed = failed.length === 0
	return {
		type: 'all_succeeded',
		passed,
		message: passed
			? `All ${calls.length} tool call(s) succeeded`
			: `${failed.length} tool call(s) failed: ${failed.map((c) => c.name).join(', ')}`,
	}
}

function assertNoneFailed(calls: ToolCallEntry[]): ToolAssertionResult {
	return assertAllSucceeded(calls)
}

function assertCallCount(
	calls: ToolCallEntry[],
	assertion: Extract<ToolAssertion, { type: 'call_count' }>,
): ToolAssertionResult {
	const count = calls.length
	const minOk = assertion.min === undefined || count >= assertion.min
	const maxOk = assertion.max === undefined || count <= assertion.max
	const passed = minOk && maxOk
	const range =
		assertion.min !== undefined && assertion.max !== undefined
			? `${assertion.min}-${assertion.max}`
			: assertion.min !== undefined
				? `>= ${assertion.min}`
				: `<= ${assertion.max}`
	return {
		type: 'call_count',
		passed,
		message: passed
			? `Tool call count ${count} within range (${range})`
			: `Tool call count ${count} outside range (${range})`,
	}
}

function assertNoRepeatedCalls(
	calls: ToolCallEntry[],
	assertion: Extract<ToolAssertion, { type: 'no_repeated_calls' }>,
): ToolAssertionResult {
	const relevantNames: string[] = assertion.name
		? calls.filter((c) => c.name === assertion.name).map(() => assertion.name as string)
		: calls.map((c) => c.name)

	const seen = new Set<string>()
	const duplicates = new Set<string>()
	for (const name of relevantNames) {
		if (seen.has(name)) duplicates.add(name)
		seen.add(name)
	}

	const passed = duplicates.size === 0
	return {
		type: 'no_repeated_calls',
		passed,
		message: passed
			? assertion.name
				? `"${assertion.name}" was not called repeatedly`
				: 'No repeated tool calls'
			: `Repeated tool calls: ${Array.from(duplicates).join(', ')}`,
	}
}

function assertCustom(
	calls: ToolCallEntry[],
	assertion: Extract<ToolAssertion, { type: 'custom' }>,
): ToolAssertionResult {
	const passed = assertion.fn(calls)
	return {
		type: `custom:${assertion.name}`,
		passed,
		message: passed
			? `Custom check "${assertion.name}" passed`
			: `Custom check "${assertion.name}" failed`,
	}
}

export function assertToolCalls(
	calls: ToolCallEntry[],
	assertions: ToolAssertion[],
): ToolAssertionResult[] {
	return assertions.map((assertion) => {
		switch (assertion.type) {
			case 'called':
				return assertCalled(calls, assertion)
			case 'not_called':
				return assertNotCalled(calls, assertion)
			case 'called_with':
				return assertCalledWith(calls, assertion)
			case 'called_in_order':
				return assertCalledInOrder(calls, assertion)
			case 'all_succeeded':
				return assertAllSucceeded(calls)
			case 'none_failed':
				return assertNoneFailed(calls)
			case 'call_count':
				return assertCallCount(calls, assertion)
			case 'no_repeated_calls':
				return assertNoRepeatedCalls(calls, assertion)
			case 'custom':
				return assertCustom(calls, assertion)
		}
	})
}

export function toolCallsToEvalCriteria(
	assertions: ToolAssertion[],
	calls: ToolCallEntry[],
): EvalCriterion[] {
	return assertions.map((assertion) => ({
		type: 'custom' as const,
		name: `tool:${assertion.type}`,
		fn: () => {
			const results = assertToolCalls(calls, [assertion])
			return results[0].passed
		},
	}))
}
