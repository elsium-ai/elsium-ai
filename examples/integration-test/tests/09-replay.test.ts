import { createReplayPlayer, createReplayRecorder } from '@elsium-ai/testing'
import { mockProvider } from '@elsium-ai/testing'
/**
 * Test 09: Replay Recording & Playback
 * Verifies: createReplayRecorder, createReplayPlayer
 */
import { describe, expect, it } from 'vitest'
import { assertNonEmptyString, createTestGateway, describeWithLLM } from '../lib/helpers'

describe('09 — Replay', () => {
	it('recorder wraps a complete function and captures entries', async () => {
		const mock = mockProvider({
			responses: [{ content: 'response-1' }, { content: 'response-2' }],
		})

		const recorder = createReplayRecorder()
		const wrappedComplete = recorder.wrap((req) => mock.complete(req))

		await wrappedComplete({ messages: [{ role: 'user', content: 'q1' }] })
		await wrappedComplete({ messages: [{ role: 'user', content: 'q2' }] })

		const entries = recorder.getEntries()
		expect(entries).toHaveLength(2)
		expect(entries[0].response.message.content).toBe('response-1')
		expect(entries[1].response.message.content).toBe('response-2')
	})

	it('recorder.toJSON() serializes entries', async () => {
		const mock = mockProvider({ defaultResponse: { content: 'test' } })
		const recorder = createReplayRecorder()
		const wrapped = recorder.wrap((req) => mock.complete(req))

		await wrapped({ messages: [{ role: 'user', content: 'hi' }] })

		const json = recorder.toJSON()
		expect(typeof json).toBe('string')

		const parsed = JSON.parse(json)
		expect(Array.isArray(parsed)).toBe(true)
		expect(parsed).toHaveLength(1)
	})

	it('player replays recorded responses', async () => {
		const mock = mockProvider({
			responses: [{ content: 'answer-A' }, { content: 'answer-B' }],
		})

		const recorder = createReplayRecorder()
		const wrapped = recorder.wrap((req) => mock.complete(req))

		await wrapped({ messages: [{ role: 'user', content: 'q1' }] })
		await wrapped({ messages: [{ role: 'user', content: 'q2' }] })

		const json = recorder.toJSON()

		// Create player from JSON
		const player = createReplayPlayer(json)
		expect(player.remaining).toBe(2)

		const r1 = await player.complete({ messages: [{ role: 'user', content: 'q1' }] })
		expect(r1.message.content).toBe('answer-A')
		expect(player.remaining).toBe(1)

		const r2 = await player.complete({ messages: [{ role: 'user', content: 'q2' }] })
		expect(r2.message.content).toBe('answer-B')
		expect(player.remaining).toBe(0)
	})

	it('player accepts entries array directly', async () => {
		const mock = mockProvider({ defaultResponse: { content: 'direct' } })
		const recorder = createReplayRecorder()
		const wrapped = recorder.wrap((req) => mock.complete(req))

		await wrapped({ messages: [{ role: 'user', content: 'test' }] })

		const entries = recorder.getEntries()
		const player = createReplayPlayer(entries)

		const r = await player.complete({ messages: [{ role: 'user', content: 'test' }] })
		expect(r.message.content).toBe('direct')
	})

	it('recorder.clear() resets entries', async () => {
		const mock = mockProvider({ defaultResponse: { content: 'x' } })
		const recorder = createReplayRecorder()
		const wrapped = recorder.wrap((req) => mock.complete(req))

		await wrapped({ messages: [{ role: 'user', content: 'hi' }] })
		expect(recorder.getEntries()).toHaveLength(1)

		recorder.clear()
		expect(recorder.getEntries()).toHaveLength(0)
	})
})

describeWithLLM('09 — Replay (Real LLM)', () => {
	it('records a real LLM call and replays it identically', async () => {
		const gw = createTestGateway()
		const recorder = createReplayRecorder()
		const wrappedComplete = recorder.wrap((req) => gw.complete(req))

		const response = await wrappedComplete({
			messages: [{ role: 'user', content: 'What is 2+2?' }],
			maxTokens: 10,
			system: 'Respond with just the number.',
		})

		assertNonEmptyString(response.message.content)

		const entries = recorder.getEntries()
		expect(entries).toHaveLength(1)

		// Replay
		const json = recorder.toJSON()
		const player = createReplayPlayer(json)

		const replayed = await player.complete({
			messages: [{ role: 'user', content: 'What is 2+2?' }],
		})

		expect(replayed.message.content).toBe(response.message.content)
		expect(player.remaining).toBe(0)
	})
})
