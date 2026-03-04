import { describe, expect, it } from 'vitest'
import { formatSSE, sseHeaders } from './sse'

// ─── sseHeaders ───────────────────────────────────────────────────

describe('sseHeaders', () => {
	it('returns Content-Type as text/event-stream', () => {
		const headers = sseHeaders()
		expect(headers['Content-Type']).toBe('text/event-stream')
	})

	it('returns Cache-Control as no-cache', () => {
		const headers = sseHeaders()
		expect(headers['Cache-Control']).toBe('no-cache')
	})

	it('returns Connection as keep-alive', () => {
		const headers = sseHeaders()
		expect(headers.Connection).toBe('keep-alive')
	})

	it('returns X-Accel-Buffering as no', () => {
		const headers = sseHeaders()
		expect(headers['X-Accel-Buffering']).toBe('no')
	})

	it('returns a plain object with exactly four entries', () => {
		const headers = sseHeaders()
		expect(Object.keys(headers)).toHaveLength(4)
	})

	it('returns a fresh object on each call', () => {
		const h1 = sseHeaders()
		const h2 = sseHeaders()
		expect(h1).not.toBe(h2)
	})
})

// ─── formatSSE ────────────────────────────────────────────────────

describe('formatSSE', () => {
	it('formats a named event with event and data lines', () => {
		const result = formatSSE('text_delta', { text: 'hello' })
		expect(result).toBe('event: text_delta\ndata: {"text":"hello"}\n\n')
	})

	it('formats the "message" event type without the event: prefix', () => {
		const result = formatSSE('message', { type: 'text_delta', text: 'hi' })
		expect(result).toBe('data: {"type":"text_delta","text":"hi"}\n\n')
	})

	it('ends every SSE frame with a double newline', () => {
		const result1 = formatSSE('ping', {})
		const result2 = formatSSE('message', 'hello')
		expect(result1.endsWith('\n\n')).toBe(true)
		expect(result2.endsWith('\n\n')).toBe(true)
	})

	it('serialises data as JSON', () => {
		const data = { type: 'message_end', usage: { inputTokens: 10, outputTokens: 20 } }
		const result = formatSSE('message_end', data)
		expect(result).toContain(JSON.stringify(data))
	})

	it('handles null data', () => {
		const result = formatSSE('ping', null)
		expect(result).toContain('null')
	})

	it('handles array data', () => {
		const result = formatSSE('batch', [1, 2, 3])
		expect(result).toContain('[1,2,3]')
	})

	it('handles string data', () => {
		const result = formatSSE('message', 'plain string')
		expect(result).toBe('data: "plain string"\n\n')
	})

	it('handles number data', () => {
		const result = formatSSE('count', 42)
		expect(result).toContain('42')
	})

	it('handles boolean data', () => {
		const result = formatSSE('done', true)
		expect(result).toContain('true')
	})

	it('includes event name in non-message events', () => {
		const result = formatSSE('tool_call_start', { id: 'tc_1', name: 'search' })
		expect(result.startsWith('event: tool_call_start\n')).toBe(true)
	})

	it('does not include event: line for "message" type', () => {
		const result = formatSSE('message', { ok: true })
		expect(result.startsWith('data:')).toBe(true)
		expect(result).not.toContain('event:')
	})

	it('handles empty object', () => {
		const result = formatSSE('ping', {})
		expect(result).toContain('{}')
	})

	it('handles unicode content', () => {
		const result = formatSSE('message', { text: 'Héllo wörld 🌍' })
		expect(result).toContain('Héllo wörld')
	})
})
