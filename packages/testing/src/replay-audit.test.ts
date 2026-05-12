import type { CompletionRequest, LLMResponse, StreamEvent } from '@elsium-ai/core'
import { describe, expect, it, vi } from 'vitest'
import {
	createSignedReplayPlayer,
	createSignedReplayRecorder,
	createStreamReplayPlayer,
	createStreamReplayRecorder,
	verifyReplay,
} from './replay-audit'

const SECRET = 'test-secret-min-16-chars-long-yo'

function mkResp(content = 'ok'): LLMResponse {
	return {
		id: 'msg',
		message: { role: 'assistant', content },
		usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
		cost: { inputCost: 0, outputCost: 0, totalCost: 0, currency: 'USD' },
		model: 'gpt-5',
		provider: 'openai',
		stopReason: 'end_turn',
		latencyMs: 1,
		traceId: 'trc',
	}
}

function mkReq(content = 'hi'): CompletionRequest {
	return { messages: [{ role: 'user', content }] }
}

// ─── Signed recorder + verification ─────────────────────────────

describe('createSignedReplayRecorder', () => {
	it('records entries with a hash chain', async () => {
		const rec = createSignedReplayRecorder({ secret: SECRET })
		const wrapped = rec.wrap(vi.fn().mockResolvedValue(mkResp('a')))
		await wrapped(mkReq('1'))
		await wrapped(mkReq('2'))

		const file = rec.export()
		expect(file.entries).toHaveLength(2)
		// First entry's previousSignature is the zero sentinel
		expect(file.entries[0].previousSignature).toBe('0'.repeat(64))
		// Second entry's previousSignature equals first entry's signature
		expect(file.entries[1].previousSignature).toBe(file.entries[0].signature)
	})

	it('rejects short secrets at construction', () => {
		expect(() => createSignedReplayRecorder({ secret: 'short' })).toThrow(/16 characters/)
	})

	it('verifyReplay succeeds on an unmodified recording', async () => {
		const rec = createSignedReplayRecorder({ secret: SECRET })
		const wrapped = rec.wrap(vi.fn().mockResolvedValue(mkResp()))
		await wrapped(mkReq('a'))
		await wrapped(mkReq('b'))
		await wrapped(mkReq('c'))

		const result = verifyReplay(rec.export(), SECRET)
		expect(result.valid).toBe(true)
		expect(result.entryCount).toBe(3)
	})

	it('verifyReplay detects tampered request payloads', async () => {
		const rec = createSignedReplayRecorder({ secret: SECRET })
		const wrapped = rec.wrap(vi.fn().mockResolvedValue(mkResp()))
		await wrapped(mkReq('original'))
		await wrapped(mkReq('next'))

		const file = rec.export()
		// Mutate the first entry's request content — chain must break
		const tampered = {
			...file,
			entries: file.entries.map((e, i) =>
				i === 0
					? {
							...e,
							entry: {
								...e.entry,
								request: { messages: [{ role: 'user' as const, content: 'MUTATED' }] },
							},
						}
					: e,
			),
		}
		const result = verifyReplay(tampered, SECRET)
		expect(result.valid).toBe(false)
		expect(result.invalidAtIndex).toBe(0)
		expect(result.reason).toMatch(/signature mismatch/)
	})

	it('verifyReplay detects reordered entries', async () => {
		const rec = createSignedReplayRecorder({ secret: SECRET })
		const wrapped = rec.wrap(vi.fn().mockResolvedValue(mkResp()))
		await wrapped(mkReq('1'))
		await wrapped(mkReq('2'))

		const file = rec.export()
		const reordered = {
			...file,
			entries: [file.entries[1], file.entries[0]],
		}
		const result = verifyReplay(reordered, SECRET)
		expect(result.valid).toBe(false)
		expect(result.invalidAtIndex).toBe(0)
	})

	it('verifyReplay fails with the wrong secret (audit-grade)', async () => {
		const rec = createSignedReplayRecorder({ secret: SECRET })
		const wrapped = rec.wrap(vi.fn().mockResolvedValue(mkResp()))
		await wrapped(mkReq('x'))
		const result = verifyReplay(rec.export(), 'wrong-secret-also-long-enough-x')
		expect(result.valid).toBe(false)
	})

	it('verifyReplay rejects unsupported apiVersion / algorithm', () => {
		const result1 = verifyReplay(
			JSON.stringify({ apiVersion: 'elsium.replay/v999', algorithm: 'hmac-sha256', entries: [] }),
			SECRET,
		)
		expect(result1.valid).toBe(false)
		const result2 = verifyReplay(
			JSON.stringify({ apiVersion: 'elsium.replay/v1', algorithm: 'md5', entries: [] }),
			SECRET,
		)
		expect(result2.valid).toBe(false)
	})

	it('verifyReplay rejects malformed JSON', () => {
		const result = verifyReplay('{ not valid json', SECRET)
		expect(result.valid).toBe(false)
		expect(result.reason).toMatch(/Invalid JSON/)
	})

	it('toJSON round-trips through verifyReplay', async () => {
		const rec = createSignedReplayRecorder({ secret: SECRET })
		const wrapped = rec.wrap(vi.fn().mockResolvedValue(mkResp()))
		await wrapped(mkReq('1'))
		const json = rec.toJSON()
		expect(verifyReplay(json, SECRET).valid).toBe(true)
	})

	it('clear resets the chain and lets recording restart from zero sentinel', async () => {
		const rec = createSignedReplayRecorder({ secret: SECRET })
		const wrapped = rec.wrap(vi.fn().mockResolvedValue(mkResp()))
		await wrapped(mkReq('a'))
		rec.clear()
		await wrapped(mkReq('b'))
		const file = rec.export()
		expect(file.entries).toHaveLength(1)
		expect(file.entries[0].previousSignature).toBe('0'.repeat(64))
	})
})

// ─── Signed player ──────────────────────────────────────────────

describe('createSignedReplayPlayer', () => {
	it('strict mode throws when verification fails', async () => {
		const rec = createSignedReplayRecorder({ secret: SECRET })
		await rec.wrap(vi.fn().mockResolvedValue(mkResp()))(mkReq())
		const file = rec.export()
		// Corrupt
		const tampered = {
			...file,
			entries: [
				{
					...file.entries[0],
					entry: {
						...file.entries[0].entry,
						response: { ...file.entries[0].entry.response, model: 'CHANGED' as never },
					},
				},
			],
		}
		expect(() => createSignedReplayPlayer(tampered, { secret: SECRET })).toThrow(
			/verification failed/,
		)
	})

	it('strict mode passes on a clean recording and serves responses', async () => {
		const rec = createSignedReplayRecorder({ secret: SECRET })
		const wrapped = rec.wrap(vi.fn().mockResolvedValue(mkResp('hi')))
		await wrapped(mkReq())
		const player = createSignedReplayPlayer(rec.export(), { secret: SECRET })
		expect(player.verification.valid).toBe(true)
		const resp = await player.complete(mkReq())
		expect(resp.message.content).toBe('hi')
	})

	it('lax mode (strict=false) plays back even when verification fails', async () => {
		const rec = createSignedReplayRecorder({ secret: SECRET })
		await rec.wrap(vi.fn().mockResolvedValue(mkResp()))(mkReq())
		const file = rec.export()
		const tampered = {
			...file,
			entries: [
				{
					...file.entries[0],
					signature: 'deadbeef'.repeat(8),
				},
			],
		}
		const player = createSignedReplayPlayer(tampered, { secret: SECRET, strict: false })
		expect(player.verification.valid).toBe(false)
		await expect(player.complete(mkReq())).resolves.toBeDefined()
	})
})

// ─── Streaming replay ──────────────────────────────────────────

function mkStream(events: StreamEvent[]): (req: CompletionRequest) => AsyncIterable<StreamEvent> {
	return () => ({
		async *[Symbol.asyncIterator]() {
			for (const e of events) yield e
		},
	})
}

describe('createStreamReplayRecorder + createStreamReplayPlayer', () => {
	it('records a single stream sequence and replays it', async () => {
		const events: StreamEvent[] = [
			{ type: 'text_delta', text: 'Hello' },
			{ type: 'text_delta', text: ' world' },
		]
		const rec = createStreamReplayRecorder()
		const wrapped = rec.wrap(mkStream(events))

		// Drain the recorded stream so events are captured
		const collected: StreamEvent[] = []
		for await (const e of wrapped(mkReq())) collected.push(e)
		expect(collected).toEqual(events)

		const player = createStreamReplayPlayer(rec.getEntries())
		const replayed: StreamEvent[] = []
		for await (const e of player.stream(mkReq())) replayed.push(e)
		expect(replayed).toEqual(events)
	})

	it('replays multiple sequences in record order', async () => {
		const rec = createStreamReplayRecorder()
		const wrap1 = rec.wrap(mkStream([{ type: 'text_delta', text: 'a' }]))
		const wrap2 = rec.wrap(mkStream([{ type: 'text_delta', text: 'b' }]))
		for await (const _ of wrap1(mkReq())) {
		}
		for await (const _ of wrap2(mkReq())) {
		}

		const player = createStreamReplayPlayer(rec.toJSON())
		const seq1: StreamEvent[] = []
		for await (const e of player.stream(mkReq())) seq1.push(e)
		const seq2: StreamEvent[] = []
		for await (const e of player.stream(mkReq())) seq2.push(e)
		expect(seq1).toEqual([{ type: 'text_delta', text: 'a' }])
		expect(seq2).toEqual([{ type: 'text_delta', text: 'b' }])
	})

	it('throws on exhaustion', async () => {
		const rec = createStreamReplayRecorder()
		const wrap = rec.wrap(mkStream([{ type: 'text_delta', text: 'only' }]))
		for await (const _ of wrap(mkReq())) {
		}

		const player = createStreamReplayPlayer(rec.getEntries())
		for await (const _ of player.stream(mkReq())) {
		}

		await expect(async () => {
			for await (const _ of player.stream(mkReq())) {
			}
		}).rejects.toThrow(/exhausted/)
	})

	it('returns defensive copies of events', async () => {
		const events: StreamEvent[] = [{ type: 'text_delta', text: 'x' }]
		const rec = createStreamReplayRecorder()
		const wrap = rec.wrap(mkStream(events))
		for await (const _ of wrap(mkReq())) {
		}

		const snapshot = rec.getEntries()
		// Mutate the source array — the recorder's copy should be untouched.
		events.push({ type: 'text_delta', text: 'INJECTED' })
		expect(snapshot[0].events).toHaveLength(1)
	})
})
