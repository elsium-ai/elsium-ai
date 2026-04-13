import { describe, expect, it } from 'vitest'
import type { ToolCallEntry } from './tool-assertions'
import { assertToolCalls, toolCallsToEvalCriteria } from './tool-assertions'

function makeCall(name: string, args: Record<string, unknown> = {}, success = true): ToolCallEntry {
	return {
		name,
		arguments: args,
		result: {
			success,
			data: success ? 'ok' : undefined,
			error: success ? undefined : 'failed',
			toolCallId: `call-${name}`,
			durationMs: 10,
		},
	}
}

describe('assertToolCalls', () => {
	const calls: ToolCallEntry[] = [
		makeCall('search', { query: 'weather' }),
		makeCall('fetch', { url: 'https://api.example.com' }),
		makeCall('search', { query: 'news' }),
	]

	describe('called', () => {
		it('passes when tool was called', () => {
			const [result] = assertToolCalls(calls, [{ type: 'called', name: 'search' }])
			expect(result.passed).toBe(true)
		})

		it('fails when tool was not called', () => {
			const [result] = assertToolCalls(calls, [{ type: 'called', name: 'delete' }])
			expect(result.passed).toBe(false)
		})

		it('checks exact call count when times specified', () => {
			const [result] = assertToolCalls(calls, [{ type: 'called', name: 'search', times: 2 }])
			expect(result.passed).toBe(true)

			const [result2] = assertToolCalls(calls, [{ type: 'called', name: 'search', times: 1 }])
			expect(result2.passed).toBe(false)
		})
	})

	describe('not_called', () => {
		it('passes when tool was not called', () => {
			const [result] = assertToolCalls(calls, [{ type: 'not_called', name: 'delete' }])
			expect(result.passed).toBe(true)
		})

		it('fails when tool was called', () => {
			const [result] = assertToolCalls(calls, [{ type: 'not_called', name: 'search' }])
			expect(result.passed).toBe(false)
		})
	})

	describe('called_with', () => {
		it('passes with partial arg match (default)', () => {
			const [result] = assertToolCalls(calls, [
				{ type: 'called_with', name: 'search', args: { query: 'weather' } },
			])
			expect(result.passed).toBe(true)
		})

		it('fails when args dont match', () => {
			const [result] = assertToolCalls(calls, [
				{ type: 'called_with', name: 'search', args: { query: 'sports' } },
			])
			expect(result.passed).toBe(false)
		})

		it('fails with exact match when extra keys exist', () => {
			const callsWithExtra = [makeCall('search', { query: 'weather', limit: 10 })]
			const [result] = assertToolCalls(callsWithExtra, [
				{
					type: 'called_with',
					name: 'search',
					args: { query: 'weather' },
					partial: false,
				},
			])
			expect(result.passed).toBe(false)
		})
	})

	describe('called_in_order', () => {
		it('passes when tools called in specified order', () => {
			const [result] = assertToolCalls(calls, [
				{ type: 'called_in_order', names: ['search', 'fetch'] },
			])
			expect(result.passed).toBe(true)
		})

		it('passes with subsequence matching', () => {
			const [result] = assertToolCalls(calls, [
				{ type: 'called_in_order', names: ['search', 'search'] },
			])
			expect(result.passed).toBe(true)
		})

		it('fails when order is wrong', () => {
			const [result] = assertToolCalls(calls, [
				{ type: 'called_in_order', names: ['fetch', 'search', 'fetch'] },
			])
			expect(result.passed).toBe(false)
		})
	})

	describe('all_succeeded', () => {
		it('passes when all calls succeed', () => {
			const [result] = assertToolCalls(calls, [{ type: 'all_succeeded' }])
			expect(result.passed).toBe(true)
		})

		it('fails when any call fails', () => {
			const failCalls = [...calls, makeCall('broken', {}, false)]
			const [result] = assertToolCalls(failCalls, [{ type: 'all_succeeded' }])
			expect(result.passed).toBe(false)
			expect(result.message).toContain('broken')
		})
	})

	describe('none_failed', () => {
		it('passes when all calls succeed', () => {
			const [result] = assertToolCalls(calls, [{ type: 'none_failed' }])
			expect(result.passed).toBe(true)
		})
	})

	describe('call_count', () => {
		it('passes within min/max range', () => {
			const [result] = assertToolCalls(calls, [{ type: 'call_count', min: 1, max: 5 }])
			expect(result.passed).toBe(true)
		})

		it('fails when below min', () => {
			const [result] = assertToolCalls(calls, [{ type: 'call_count', min: 10 }])
			expect(result.passed).toBe(false)
		})

		it('fails when above max', () => {
			const [result] = assertToolCalls(calls, [{ type: 'call_count', max: 1 }])
			expect(result.passed).toBe(false)
		})
	})

	describe('no_repeated_calls', () => {
		it('detects repeated calls', () => {
			const [result] = assertToolCalls(calls, [{ type: 'no_repeated_calls' }])
			expect(result.passed).toBe(false)
			expect(result.message).toContain('search')
		})

		it('passes when no repeats', () => {
			const uniqueCalls = [makeCall('a'), makeCall('b'), makeCall('c')]
			const [result] = assertToolCalls(uniqueCalls, [{ type: 'no_repeated_calls' }])
			expect(result.passed).toBe(true)
		})

		it('checks specific tool when name provided', () => {
			const [result] = assertToolCalls(calls, [{ type: 'no_repeated_calls', name: 'fetch' }])
			expect(result.passed).toBe(true)
		})
	})

	describe('custom', () => {
		it('runs custom assertion function', () => {
			const [result] = assertToolCalls(calls, [
				{
					type: 'custom',
					name: 'has-search',
					fn: (c) => c.some((call) => call.name === 'search'),
				},
			])
			expect(result.passed).toBe(true)
		})
	})

	it('evaluates multiple assertions', () => {
		const results = assertToolCalls(calls, [
			{ type: 'called', name: 'search' },
			{ type: 'not_called', name: 'delete' },
			{ type: 'call_count', min: 2, max: 5 },
		])
		expect(results).toHaveLength(3)
		expect(results.every((r) => r.passed)).toBe(true)
	})
})

describe('toolCallsToEvalCriteria', () => {
	it('converts tool assertions to eval criteria', () => {
		const calls = [makeCall('search', { query: 'test' })]
		const criteria = toolCallsToEvalCriteria([{ type: 'called', name: 'search' }], calls)
		expect(criteria).toHaveLength(1)
		expect(criteria[0].type).toBe('custom')
		if (criteria[0].type === 'custom') {
			expect(criteria[0].fn('ignored')).toBe(true)
		}
	})
})
