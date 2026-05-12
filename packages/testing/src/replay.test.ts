import type { CompletionRequest, LLMResponse } from '@elsium-ai/core'
import { describe, expect, it, vi } from 'vitest'
import { createReplayPlayer, createReplayRecorder } from './replay'
import type { ReplayEntry } from './replay'

// ─── Helpers ─────────────────────────────────────────────────────

function makeRequest(content = 'Hello'): CompletionRequest {
	return {
		messages: [{ role: 'user', content }],
		model: 'gpt-4o',
	}
}

function makeResponse(content = 'Hi there!'): LLMResponse {
	return {
		id: 'msg_1',
		message: { role: 'assistant', content },
		usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
		cost: { inputCost: 0.001, outputCost: 0.002, totalCost: 0.003, currency: 'USD' },
		model: 'gpt-4o',
		provider: 'openai',
		stopReason: 'end_turn',
		latencyMs: 50,
		traceId: 'trc_test',
	}
}

// ─── createReplayRecorder — wrap ──────────────────────────────────

describe('createReplayRecorder — wrap', () => {
	it('calls the underlying function and returns its result', async () => {
		const recorder = createReplayRecorder()
		const response = makeResponse()
		const completeFn = vi.fn().mockResolvedValue(response)

		const wrapped = recorder.wrap(completeFn)
		const result = await wrapped(makeRequest())

		expect(result).toEqual(response)
		expect(completeFn).toHaveBeenCalledOnce()
	})

	it('records request and response into entries', async () => {
		const recorder = createReplayRecorder()
		const req = makeRequest('What is 2+2?')
		const res = makeResponse('4')
		const completeFn = vi.fn().mockResolvedValue(res)

		const wrapped = recorder.wrap(completeFn)
		await wrapped(req)

		const entries = recorder.getEntries()
		expect(entries).toHaveLength(1)
		expect(entries[0].request).toEqual(req)
		expect(entries[0].response).toEqual(res)
	})

	it('records a timestamp for each entry', async () => {
		const recorder = createReplayRecorder()
		const before = Date.now()

		await recorder.wrap(vi.fn().mockResolvedValue(makeResponse()))(makeRequest())

		const after = Date.now()
		const entry = recorder.getEntries()[0]
		expect(entry.timestamp).toBeGreaterThanOrEqual(before)
		expect(entry.timestamp).toBeLessThanOrEqual(after)
	})

	it('accumulates multiple calls in order', async () => {
		const recorder = createReplayRecorder()
		const fn = vi
			.fn()
			.mockResolvedValueOnce(makeResponse('first'))
			.mockResolvedValueOnce(makeResponse('second'))

		const wrapped = recorder.wrap(fn)
		await wrapped(makeRequest('q1'))
		await wrapped(makeRequest('q2'))

		const entries = recorder.getEntries()
		expect(entries).toHaveLength(2)
		expect(entries[0].response.message.content).toBe('first')
		expect(entries[1].response.message.content).toBe('second')
	})

	it('passes the original request to the underlying function', async () => {
		const recorder = createReplayRecorder()
		const request = makeRequest('specific question')
		const fn = vi.fn().mockResolvedValue(makeResponse())

		await recorder.wrap(fn)(request)

		expect(fn).toHaveBeenCalledWith(request)
	})

	it('propagates errors from the underlying function', async () => {
		const recorder = createReplayRecorder()
		const fn = vi.fn().mockRejectedValue(new Error('network failure'))

		await expect(recorder.wrap(fn)(makeRequest())).rejects.toThrow('network failure')
	})

	it('does not record an entry when the underlying function throws', async () => {
		const recorder = createReplayRecorder()
		const fn = vi.fn().mockRejectedValue(new Error('boom'))

		try {
			await recorder.wrap(fn)(makeRequest())
		} catch {
			// expected
		}

		expect(recorder.getEntries()).toHaveLength(0)
	})
})

// ─── createReplayRecorder — getEntries ────────────────────────────

describe('createReplayRecorder — getEntries', () => {
	it('returns a copy — mutating result does not affect recorder state', async () => {
		const recorder = createReplayRecorder()
		await recorder.wrap(vi.fn().mockResolvedValue(makeResponse()))(makeRequest())

		const entries1 = recorder.getEntries()
		entries1.push({} as ReplayEntry)

		const entries2 = recorder.getEntries()
		expect(entries2).toHaveLength(1)
	})

	it('returns empty array when no calls have been made', () => {
		const recorder = createReplayRecorder()
		expect(recorder.getEntries()).toHaveLength(0)
	})
})

// ─── createReplayRecorder — toJSON ────────────────────────────────

describe('createReplayRecorder — toJSON', () => {
	it('serialises entries as a pretty-printed JSON array', async () => {
		const recorder = createReplayRecorder()
		await recorder.wrap(vi.fn().mockResolvedValue(makeResponse('ok')))(makeRequest())

		const json = recorder.toJSON()
		const parsed = JSON.parse(json)

		expect(Array.isArray(parsed)).toBe(true)
		expect(parsed).toHaveLength(1)
		expect(parsed[0].response.message.content).toBe('ok')
	})

	it('returns "[]" when there are no entries', () => {
		const recorder = createReplayRecorder()
		expect(JSON.parse(recorder.toJSON())).toEqual([])
	})

	it('includes request, response, and timestamp fields', async () => {
		const recorder = createReplayRecorder()
		const req = makeRequest('test')
		const res = makeResponse('result')
		await recorder.wrap(vi.fn().mockResolvedValue(res))(req)

		const parsed = JSON.parse(recorder.toJSON())
		const entry = parsed[0]
		expect(entry).toHaveProperty('request')
		expect(entry).toHaveProperty('response')
		expect(entry).toHaveProperty('timestamp')
	})
})

// ─── createReplayRecorder — clear ─────────────────────────────────

describe('createReplayRecorder — clear', () => {
	it('removes all recorded entries', async () => {
		const recorder = createReplayRecorder()
		const fn = vi.fn().mockResolvedValue(makeResponse())
		const wrapped = recorder.wrap(fn)

		await wrapped(makeRequest())
		await wrapped(makeRequest())
		expect(recorder.getEntries()).toHaveLength(2)

		recorder.clear()
		expect(recorder.getEntries()).toHaveLength(0)
	})

	it('allows recording to continue after clear', async () => {
		const recorder = createReplayRecorder()
		const fn = vi.fn().mockResolvedValue(makeResponse('after clear'))
		const wrapped = recorder.wrap(fn)

		await wrapped(makeRequest())
		recorder.clear()
		await wrapped(makeRequest())

		const entries = recorder.getEntries()
		expect(entries).toHaveLength(1)
		expect(entries[0].response.message.content).toBe('after clear')
	})
})

// ─── createReplayPlayer — basic playback ──────────────────────────

describe('createReplayPlayer — basic playback', () => {
	it('returns response from first entry on first call', async () => {
		const entries: ReplayEntry[] = [
			{ request: makeRequest(), response: makeResponse('first'), timestamp: Date.now() },
		]
		const player = createReplayPlayer(entries)

		const result = await player.complete(makeRequest())
		expect(result.message.content).toBe('first')
	})

	it('returns entries in order across multiple calls', async () => {
		const entries: ReplayEntry[] = [
			{ request: makeRequest(), response: makeResponse('one'), timestamp: Date.now() },
			{ request: makeRequest(), response: makeResponse('two'), timestamp: Date.now() },
			{ request: makeRequest(), response: makeResponse('three'), timestamp: Date.now() },
		]
		const player = createReplayPlayer(entries)

		const r1 = await player.complete(makeRequest())
		const r2 = await player.complete(makeRequest())
		const r3 = await player.complete(makeRequest())

		expect(r1.message.content).toBe('one')
		expect(r2.message.content).toBe('two')
		expect(r3.message.content).toBe('three')
	})

	it('ignores the actual request content and plays back in order', async () => {
		const entries: ReplayEntry[] = [
			{
				request: makeRequest('original'),
				response: makeResponse('recorded'),
				timestamp: Date.now(),
			},
		]
		const player = createReplayPlayer(entries)

		// Pass a completely different request — should still return the recorded response
		const result = await player.complete(makeRequest('completely different'))
		expect(result.message.content).toBe('recorded')
	})

	it('throws when all entries are exhausted', async () => {
		const entries: ReplayEntry[] = [
			{ request: makeRequest(), response: makeResponse(), timestamp: Date.now() },
		]
		const player = createReplayPlayer(entries)

		await player.complete(makeRequest())

		await expect(player.complete(makeRequest())).rejects.toThrow('Replay exhausted')
	})
})

// ─── createReplayPlayer — remaining ──────────────────────────────

describe('createReplayPlayer — remaining', () => {
	it('starts at the total entry count', () => {
		const entries: ReplayEntry[] = [
			{ request: makeRequest(), response: makeResponse(), timestamp: Date.now() },
			{ request: makeRequest(), response: makeResponse(), timestamp: Date.now() },
			{ request: makeRequest(), response: makeResponse(), timestamp: Date.now() },
		]
		const player = createReplayPlayer(entries)
		expect(player.remaining).toBe(3)
	})

	it('decrements by 1 per complete() call', async () => {
		const entries: ReplayEntry[] = [
			{ request: makeRequest(), response: makeResponse(), timestamp: Date.now() },
			{ request: makeRequest(), response: makeResponse(), timestamp: Date.now() },
		]
		const player = createReplayPlayer(entries)

		await player.complete(makeRequest())
		expect(player.remaining).toBe(1)

		await player.complete(makeRequest())
		expect(player.remaining).toBe(0)
	})

	it('is 0 when all entries are consumed', async () => {
		const entries: ReplayEntry[] = [
			{ request: makeRequest(), response: makeResponse(), timestamp: Date.now() },
		]
		const player = createReplayPlayer(entries)

		await player.complete(makeRequest())
		expect(player.remaining).toBe(0)
	})

	it('is 0 for an empty entry list', () => {
		const player = createReplayPlayer([])
		expect(player.remaining).toBe(0)
	})
})

// ─── createReplayPlayer — JSON input ─────────────────────────────

describe('createReplayPlayer — JSON string input', () => {
	it('parses JSON string and plays back entries', async () => {
		const recorder = createReplayRecorder()
		const fn = vi.fn().mockResolvedValue(makeResponse('from json'))
		await recorder.wrap(fn)(makeRequest())

		const json = recorder.toJSON()
		const player = createReplayPlayer(json)

		const result = await player.complete(makeRequest())
		expect(result.message.content).toBe('from json')
	})

	it('remaining is correct when loaded from JSON', () => {
		const entries: ReplayEntry[] = [
			{ request: makeRequest(), response: makeResponse('a'), timestamp: Date.now() },
			{ request: makeRequest(), response: makeResponse('b'), timestamp: Date.now() },
		]
		const json = JSON.stringify(entries)
		const player = createReplayPlayer(json)

		expect(player.remaining).toBe(2)
	})
})

// ─── Round-trip: recorder → player ───────────────────────────────

describe('recorder → player round-trip', () => {
	it('player replays exactly what recorder captured', async () => {
		const recorder = createReplayRecorder()
		const responses = ['Hello', 'World', 'Done']
		const fn = vi
			.fn()
			.mockResolvedValueOnce(makeResponse(responses[0]))
			.mockResolvedValueOnce(makeResponse(responses[1]))
			.mockResolvedValueOnce(makeResponse(responses[2]))

		const wrapped = recorder.wrap(fn)
		await wrapped(makeRequest('q1'))
		await wrapped(makeRequest('q2'))
		await wrapped(makeRequest('q3'))

		const player = createReplayPlayer(recorder.getEntries())

		for (const expected of responses) {
			const result = await player.complete(makeRequest())
			expect(result.message.content).toBe(expected)
		}
	})

	it('mutating original entries array does not affect player', async () => {
		const recorder = createReplayRecorder()
		await recorder.wrap(vi.fn().mockResolvedValue(makeResponse('safe')))(makeRequest())

		const entries = recorder.getEntries()
		const player = createReplayPlayer(entries)

		// Mutate the entries array after creating the player
		entries.length = 0

		const result = await player.complete(makeRequest())
		expect(result.message.content).toBe('safe')
	})
})

// ─── X3a: hash matching strategy ──────────────────────────────────

describe('createReplayPlayer — hash strategy', () => {
	function entryFor(content: string, response = makeResponse(`${content}-resp`)): ReplayEntry {
		return { request: makeRequest(content), response, timestamp: Date.now() }
	}

	it('default strategy is sequential (backwards compatible)', async () => {
		const entries = [entryFor('a'), entryFor('b')]
		const player = createReplayPlayer(entries) // no options
		const r1 = await player.complete(makeRequest('z')) // request ignored in sequential
		const r2 = await player.complete(makeRequest('z'))
		expect(r1.message.content).toBe('a-resp')
		expect(r2.message.content).toBe('b-resp')
	})

	it('hash strategy matches by request hash, ignoring order of replay', async () => {
		const entries = [entryFor('first'), entryFor('second')]
		const player = createReplayPlayer(entries, { strategy: 'hash' })

		// Replay in reverse order — sequential would be wrong, hash must be right.
		const r1 = await player.complete(makeRequest('second'))
		const r2 = await player.complete(makeRequest('first'))
		expect(r1.message.content).toBe('second-resp')
		expect(r2.message.content).toBe('first-resp')
	})

	it('hash strategy throws a helpful error on miss', async () => {
		const entries = [entryFor('known')]
		const player = createReplayPlayer(entries, { strategy: 'hash' })
		await expect(player.complete(makeRequest('unknown'))).rejects.toThrow(/Replay miss/)
	})

	it('hash strategy advances per-hash cursor for repeat requests', async () => {
		const entries: ReplayEntry[] = [
			{ request: makeRequest('q'), response: makeResponse('r1'), timestamp: 1 },
			{ request: makeRequest('q'), response: makeResponse('r2'), timestamp: 2 },
		]
		const player = createReplayPlayer(entries, { strategy: 'hash' })

		const a = await player.complete(makeRequest('q'))
		const b = await player.complete(makeRequest('q'))
		expect(a.message.content).toBe('r1')
		expect(b.message.content).toBe('r2')

		await expect(player.complete(makeRequest('q'))).rejects.toThrow(/Replay miss/)
	})

	it('hash strategy ignores cosmetic differences (signal, stream flag)', async () => {
		const entries = [entryFor('hello')]
		const player = createReplayPlayer(entries, { strategy: 'hash' })

		const controller = new AbortController()
		const reqWithSignal: CompletionRequest = {
			...makeRequest('hello'),
			signal: controller.signal,
			stream: true,
		}

		const r = await player.complete(reqWithSignal)
		expect(r.message.content).toBe('hello-resp')
	})

	it('hash strategy distinguishes by model', async () => {
		const reqA: CompletionRequest = { messages: [{ role: 'user', content: 'x' }], model: 'gpt-5' }
		const reqB: CompletionRequest = {
			messages: [{ role: 'user', content: 'x' }],
			model: 'claude-sonnet-4-6',
		}
		const entries: ReplayEntry[] = [
			{ request: reqA, response: makeResponse('A'), timestamp: 1 },
			{ request: reqB, response: makeResponse('B'), timestamp: 2 },
		]
		const player = createReplayPlayer(entries, { strategy: 'hash' })

		expect((await player.complete(reqB)).message.content).toBe('B')
		expect((await player.complete(reqA)).message.content).toBe('A')
	})

	it('remaining count is correct under hash strategy', async () => {
		const entries = [entryFor('a'), entryFor('b'), entryFor('c')]
		const player = createReplayPlayer(entries, { strategy: 'hash' })
		expect(player.remaining).toBe(3)
		await player.complete(makeRequest('b'))
		expect(player.remaining).toBe(2)
		await player.complete(makeRequest('a'))
		expect(player.remaining).toBe(1)
	})
})
