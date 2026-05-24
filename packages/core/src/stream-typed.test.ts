import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { type TypedStreamEvent, withToolTypes } from './stream-typed'
import type { StreamEvent } from './types'

async function* toAsync(events: StreamEvent[]): AsyncIterable<StreamEvent> {
	for (const e of events) yield e
}

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
	const out: T[] = []
	for await (const e of stream) out.push(e)
	return out
}

const schemas = {
	get_weather: z.object({ city: z.string(), unit: z.enum(['C', 'F']).optional() }),
	search: z.object({ query: z.string(), limit: z.number().int().positive() }),
}

describe('withToolTypes', () => {
	it('re-emits original events untouched and adds tool_call_complete after tool_call_end', async () => {
		const events: StreamEvent[] = [
			{ type: 'message_start', id: 'm1', model: 'mock' },
			{ type: 'tool_call_start', toolCall: { id: 't1', name: 'get_weather' } },
			{ type: 'tool_call_delta', toolCallId: 't1', arguments: '{"city":"' },
			{ type: 'tool_call_delta', toolCallId: 't1', arguments: 'Lisbon"}' },
			{ type: 'tool_call_end', toolCallId: 't1' },
			{
				type: 'message_end',
				usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
				stopReason: 'tool_use',
			},
		]

		const collected = await collect(withToolTypes(toAsync(events), schemas))

		const types = collected.map((e) => e.type)
		expect(types).toEqual([
			'message_start',
			'tool_call_start',
			'tool_call_delta',
			'tool_call_delta',
			'tool_call_end',
			'tool_call_complete',
			'message_end',
		])

		const complete = collected.find((e) => e.type === 'tool_call_complete') as TypedStreamEvent<
			typeof schemas
		>
		if (complete.type !== 'tool_call_complete') throw new Error('unreachable')
		expect(complete.toolCall.id).toBe('t1')
		expect(complete.toolCall.name).toBe('get_weather')
		if (complete.toolCall.name === 'get_weather') {
			expect(complete.toolCall.arguments.city).toBe('Lisbon')
		}
	})

	it('narrows arguments to the correct shape per tool name', async () => {
		const events: StreamEvent[] = [
			{ type: 'tool_call_start', toolCall: { id: 't2', name: 'search' } },
			{ type: 'tool_call_delta', toolCallId: 't2', arguments: '{"query":"elsium","limit":5}' },
			{ type: 'tool_call_end', toolCallId: 't2' },
		]

		const collected = await collect(withToolTypes(toAsync(events), schemas))
		const complete = collected.find((e) => e.type === 'tool_call_complete')
		if (!complete || complete.type !== 'tool_call_complete')
			throw new Error('expected tool_call_complete')

		if (complete.toolCall.name === 'search') {
			expect(complete.toolCall.arguments.query).toBe('elsium')
			expect(complete.toolCall.arguments.limit).toBe(5)
		} else {
			throw new Error('wrong narrowing')
		}
	})

	it('emits a parseError when schema validation fails (UnknownToolCallComplete branch)', async () => {
		const events: StreamEvent[] = [
			{ type: 'tool_call_start', toolCall: { id: 't3', name: 'search' } },
			{ type: 'tool_call_delta', toolCallId: 't3', arguments: '{"query":"x","limit":-1}' },
			{ type: 'tool_call_end', toolCallId: 't3' },
		]

		const collected = await collect(withToolTypes(toAsync(events), schemas))
		const complete = collected.find((e) => e.type === 'tool_call_complete')
		if (!complete || complete.type !== 'tool_call_complete') throw new Error('expected event')
		expect('parseError' in complete).toBe(true)
		if ('parseError' in complete) {
			expect(complete.parseError.reason.length).toBeGreaterThan(0)
			expect(complete.parseError.raw).toBe('{"query":"x","limit":-1}')
		}
	})

	it('emits parseError on malformed JSON', async () => {
		const events: StreamEvent[] = [
			{ type: 'tool_call_start', toolCall: { id: 't4', name: 'get_weather' } },
			{ type: 'tool_call_delta', toolCallId: 't4', arguments: '{not json' },
			{ type: 'tool_call_end', toolCallId: 't4' },
		]
		const collected = await collect(withToolTypes(toAsync(events), schemas))
		const complete = collected.find((e) => e.type === 'tool_call_complete')
		if (!complete || complete.type !== 'tool_call_complete') throw new Error('expected event')
		expect('parseError' in complete).toBe(true)
	})

	it('passes through arguments as raw JSON when the tool has no schema in the map', async () => {
		const events: StreamEvent[] = [
			{ type: 'tool_call_start', toolCall: { id: 't5', name: 'unknown_tool' } },
			{ type: 'tool_call_delta', toolCallId: 't5', arguments: '{"a":1}' },
			{ type: 'tool_call_end', toolCallId: 't5' },
		]
		const collected = await collect(withToolTypes(toAsync(events), schemas))
		const complete = collected.find((e) => e.type === 'tool_call_complete')
		if (!complete || complete.type !== 'tool_call_complete') throw new Error('expected event')
		expect(complete.toolCall.arguments).toEqual({ a: 1 })
	})

	it('handles multiple concurrent tool calls interleaved', async () => {
		const events: StreamEvent[] = [
			{ type: 'tool_call_start', toolCall: { id: 'A', name: 'get_weather' } },
			{ type: 'tool_call_start', toolCall: { id: 'B', name: 'search' } },
			{ type: 'tool_call_delta', toolCallId: 'A', arguments: '{"city":' },
			{ type: 'tool_call_delta', toolCallId: 'B', arguments: '{"query":"q",' },
			{ type: 'tool_call_delta', toolCallId: 'A', arguments: '"NYC"}' },
			{ type: 'tool_call_delta', toolCallId: 'B', arguments: '"limit":1}' },
			{ type: 'tool_call_end', toolCallId: 'B' },
			{ type: 'tool_call_end', toolCallId: 'A' },
		]
		const collected = await collect(withToolTypes(toAsync(events), schemas))
		const completes = collected.filter((e) => e.type === 'tool_call_complete')
		expect(completes).toHaveLength(2)
		const a = completes.find((e) => e.type === 'tool_call_complete' && e.toolCallId === 'A')
		const b = completes.find((e) => e.type === 'tool_call_complete' && e.toolCallId === 'B')
		if (!a || a.type !== 'tool_call_complete') throw new Error('A')
		if (!b || b.type !== 'tool_call_complete') throw new Error('B')
		expect((a.toolCall.arguments as { city: string }).city).toBe('NYC')
		expect((b.toolCall.arguments as { query: string; limit: number }).query).toBe('q')
	})

	it('flushes pending tool calls if tool_call_end is missing (provider-shortcut fallback)', async () => {
		const events: StreamEvent[] = [
			{ type: 'tool_call_start', toolCall: { id: 't6', name: 'get_weather' } },
			{ type: 'tool_call_delta', toolCallId: 't6', arguments: '{"city":"Tokyo"}' },
			{
				type: 'message_end',
				usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
				stopReason: 'end_turn',
			},
		]
		const collected = await collect(withToolTypes(toAsync(events), schemas))
		const complete = collected.find((e) => e.type === 'tool_call_complete')
		expect(complete).toBeDefined()
		if (complete?.type === 'tool_call_complete') {
			expect(complete.toolCall.arguments).toEqual({ city: 'Tokyo' })
		}
	})

	it('uses last-started toolCallId when tool_call_delta omits the id (Anthropic shape)', async () => {
		const events: StreamEvent[] = [
			{ type: 'tool_call_start', toolCall: { id: 't7', name: 'get_weather' } },
			{ type: 'tool_call_delta', toolCallId: '', arguments: '{"city":"Lima"}' },
			{ type: 'tool_call_end', toolCallId: '' },
		]
		const collected = await collect(withToolTypes(toAsync(events), schemas))
		const complete = collected.find((e) => e.type === 'tool_call_complete')
		if (!complete || complete.type !== 'tool_call_complete') throw new Error('expected event')
		expect(complete.toolCall.arguments).toEqual({ city: 'Lima' })
	})
})
