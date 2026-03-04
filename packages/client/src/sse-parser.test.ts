import { describe, expect, it } from 'vitest'
import { parseSSEStream } from './sse-parser'

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Creates a mock Response with a ReadableStream body from an array of SSE
 * text chunks. Each string in `chunks` represents a chunk of bytes that
 * arrives from the wire.
 */
function makeSSEResponse(chunks: string[]): Response {
	const encoder = new TextEncoder()
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(encoder.encode(chunk))
			}
			controller.close()
		},
	})
	return new Response(stream, {
		headers: { 'Content-Type': 'text/event-stream' },
	})
}

/** Collects all events from the async generator into an array. */
async function collectEvents(response: Response) {
	const events = []
	for await (const event of parseSSEStream(response)) {
		events.push(event)
	}
	return events
}

// ─── Basic parsing ────────────────────────────────────────────────

describe('parseSSEStream — basic parsing', () => {
	it('parses a single text_delta event', async () => {
		const payload = JSON.stringify({ type: 'text_delta', text: 'Hello' })
		const res = makeSSEResponse([`data: ${payload}\n\n`])

		const events = await collectEvents(res)

		expect(events).toHaveLength(1)
		expect(events[0]).toEqual({ type: 'text_delta', text: 'Hello' })
	})

	it('parses multiple events from a single chunk', async () => {
		const e1 = JSON.stringify({ type: 'text_delta', text: 'foo' })
		const e2 = JSON.stringify({ type: 'text_delta', text: 'bar' })
		const res = makeSSEResponse([`data: ${e1}\n\ndata: ${e2}\n\n`])

		const events = await collectEvents(res)

		expect(events).toHaveLength(2)
		expect((events[0] as { text: string }).text).toBe('foo')
		expect((events[1] as { text: string }).text).toBe('bar')
	})

	it('parses events split across multiple chunks', async () => {
		const payload = JSON.stringify({ type: 'message_start', id: 'msg_1', model: 'gpt-4o' })
		// Split arbitrarily mid-line
		const half = Math.floor(`data: ${payload}\n\n`.length / 2)
		const raw = `data: ${payload}\n\n`
		const chunks = [raw.slice(0, half), raw.slice(half)]
		const res = makeSSEResponse(chunks)

		const events = await collectEvents(res)

		expect(events).toHaveLength(1)
		expect(events[0]).toMatchObject({ type: 'message_start', id: 'msg_1' })
	})

	it('returns an empty async iterable when stream has no data lines', async () => {
		const res = makeSSEResponse(['# comment\n\n', 'event: ping\n\n'])

		const events = await collectEvents(res)

		expect(events).toHaveLength(0)
	})

	it('skips [DONE] sentinel', async () => {
		const res = makeSSEResponse(['data: [DONE]\n\n'])

		const events = await collectEvents(res)

		expect(events).toHaveLength(0)
	})

	it('skips empty data lines', async () => {
		const payload = JSON.stringify({ type: 'text_delta', text: 'ok' })
		const res = makeSSEResponse([`data: \n\ndata: ${payload}\n\n`])

		const events = await collectEvents(res)

		expect(events).toHaveLength(1)
	})
})

// ─── Event types ──────────────────────────────────────────────────

describe('parseSSEStream — event types', () => {
	it('parses message_start event', async () => {
		const payload = { type: 'message_start', id: 'msg_abc', model: 'claude-3' }
		const res = makeSSEResponse([`data: ${JSON.stringify(payload)}\n\n`])

		const events = await collectEvents(res)

		expect(events[0]).toEqual(payload)
	})

	it('parses message_end event with usage', async () => {
		const payload = {
			type: 'message_end',
			usage: { inputTokens: 50, outputTokens: 100, totalTokens: 150 },
			stopReason: 'end_turn',
		}
		const res = makeSSEResponse([`data: ${JSON.stringify(payload)}\n\n`])

		const events = await collectEvents(res)

		expect(events[0]).toMatchObject({ type: 'message_end', stopReason: 'end_turn' })
	})

	it('parses tool_call_start event', async () => {
		const payload = { type: 'tool_call_start', toolCall: { id: 'tc_1', name: 'web_search' } }
		const res = makeSSEResponse([`data: ${JSON.stringify(payload)}\n\n`])

		const events = await collectEvents(res)

		expect(events[0]).toMatchObject({ type: 'tool_call_start' })
	})

	it('parses tool_call_delta event', async () => {
		const payload = { type: 'tool_call_delta', toolCallId: 'tc_1', arguments: '{"q":' }
		const res = makeSSEResponse([`data: ${JSON.stringify(payload)}\n\n`])

		const events = await collectEvents(res)

		expect(events[0]).toMatchObject({ type: 'tool_call_delta', toolCallId: 'tc_1' })
	})

	it('collects a full conversation — start, deltas, end', async () => {
		const start = { type: 'message_start', id: 'msg_1', model: 'gpt-4o' }
		const delta1 = { type: 'text_delta', text: 'Hello' }
		const delta2 = { type: 'text_delta', text: ' world' }
		const end = {
			type: 'message_end',
			usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
			stopReason: 'end_turn',
		}

		const body = [start, delta1, delta2, end].map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')
		const res = makeSSEResponse([body])

		const events = await collectEvents(res)

		expect(events).toHaveLength(4)
		expect(events[0]).toMatchObject({ type: 'message_start' })
		expect(events[3]).toMatchObject({ type: 'message_end' })
	})
})

// ─── Error handling ───────────────────────────────────────────────

describe('parseSSEStream — error handling', () => {
	it('throws when response body is null', async () => {
		const res = new Response(null)

		await expect(async () => {
			for await (const _ of parseSSEStream(res)) {
				// consume
			}
		}).rejects.toThrow('Response body is null')
	})

	it('silently skips malformed JSON', async () => {
		const good = JSON.stringify({ type: 'text_delta', text: 'ok' })
		const res = makeSSEResponse([`data: {not valid json}\n\ndata: ${good}\n\n`])

		const events = await collectEvents(res)

		// Malformed line is skipped, valid line is parsed
		expect(events).toHaveLength(1)
		expect((events[0] as { text: string }).text).toBe('ok')
	})

	it('skips event: error lines without treating the next data line as an error body', async () => {
		// The parser continues: after "event: error" it skips that line, then the
		// subsequent "data:" line is parsed normally
		const payload = JSON.stringify({ type: 'text_delta', text: 'after error' })
		const res = makeSSEResponse([`event: error\ndata: ${payload}\n\n`])

		const events = await collectEvents(res)

		// The data line itself is valid JSON and should be yielded
		expect(events).toHaveLength(1)
	})

	it('releases the reader lock after exhausting the stream', async () => {
		const payload = JSON.stringify({ type: 'text_delta', text: 'hi' })
		const res = makeSSEResponse([`data: ${payload}\n\n`])

		await collectEvents(res)

		// If the lock was released, we should be able to get another reader
		// (ReadableStream allows this after the first reader releases the lock)
		// The stream is already consumed, so getReader() will succeed but be empty.
		expect(() => res.body?.getReader()).not.toThrow()
	})
})

// ─── Edge cases ───────────────────────────────────────────────────

describe('parseSSEStream — edge cases', () => {
	it('handles data lines with leading/trailing whitespace', async () => {
		const payload = JSON.stringify({ type: 'text_delta', text: 'trimmed' })
		const res = makeSSEResponse([`data:   ${payload}  \n\n`])

		const events = await collectEvents(res)

		expect(events).toHaveLength(1)
	})

	it('handles empty stream (no chunks)', async () => {
		const res = makeSSEResponse([])

		const events = await collectEvents(res)

		expect(events).toHaveLength(0)
	})

	it('handles many events in a single large chunk', async () => {
		const count = 20
		const lines = Array.from(
			{ length: count },
			(_, i) => `data: ${JSON.stringify({ type: 'text_delta', text: `chunk${i}` })}\n\n`,
		).join('')
		const res = makeSSEResponse([lines])

		const events = await collectEvents(res)

		expect(events).toHaveLength(count)
	})

	it('handles events split one byte at a time', async () => {
		const payload = JSON.stringify({ type: 'text_delta', text: 'abc' })
		const line = `data: ${payload}\n\n`
		const chunks = line.split('').map((ch) => ch)
		const res = makeSSEResponse(chunks)

		const events = await collectEvents(res)

		expect(events).toHaveLength(1)
		expect((events[0] as { text: string }).text).toBe('abc')
	})
})
