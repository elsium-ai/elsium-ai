import type { StreamEvent } from '@elsium-ai/core'
/**
 * Test 27: Streaming Edge Cases
 * Verifies: toTextWithTimeout, resilient(), pipe() — real LLM + framework mocks
 */
import { describe, expect, it } from 'vitest'
import { assertNonEmptyString, createTestGateway, describeWithLLM } from '../lib/helpers'

describeWithLLM('27 — Streaming Edge Cases (Real LLM)', () => {
	it('toTextWithTimeout completes within deadline', async () => {
		const gw = createTestGateway()

		const stream = gw.stream({
			messages: [{ role: 'user', content: 'Say hello.' }],
			maxTokens: 20,
			system: 'Respond in one word.',
		})

		const text = await stream.toTextWithTimeout(30_000)
		assertNonEmptyString(text)
	})

	it('toTextWithTimeout with tight timeout returns without throwing', async () => {
		const gw = createTestGateway()

		const stream = gw.stream({
			messages: [{ role: 'user', content: 'Say hello.' }],
			maxTokens: 20,
		})

		const text = await stream.toTextWithTimeout(1)
		expect(typeof text).toBe('string')
	})

	it('resilient() emits checkpoint events', async () => {
		const gw = createTestGateway()

		const checkpoints: unknown[] = []

		const stream = gw.stream({
			messages: [{ role: 'user', content: 'List 5 colors, one per line.' }],
			maxTokens: 200,
		})

		const resilientStream = stream.resilient({
			checkpointIntervalMs: 100,
			onCheckpoint: (cp) => checkpoints.push(cp),
		})

		const text = await resilientStream.toText()
		assertNonEmptyString(text)
		expect(checkpoints.length).toBeGreaterThanOrEqual(1)
	})

	it('pipe() transforms text_delta events', async () => {
		const gw = createTestGateway()

		const stream = gw.stream({
			messages: [{ role: 'user', content: 'Say hello.' }],
			maxTokens: 20,
			system: 'Respond with exactly: hello world',
		})

		const uppercased = stream.pipe(async function* (source: AsyncIterable<StreamEvent>) {
			for await (const event of source) {
				if (event.type === 'text_delta') {
					yield { ...event, text: event.text.toUpperCase() }
				} else {
					yield event
				}
			}
		})

		const text = await uppercased.toText()
		assertNonEmptyString(text)
		expect(text).toBe(text.toUpperCase())
	})
})

describe('27 — Streaming Edge Cases (Framework)', () => {
	it('resilient() handles mock stream errors gracefully', async () => {
		const { ElsiumStream } = await import('@elsium-ai/core')

		let callCount = 0
		async function* failingSource(): AsyncIterable<StreamEvent> {
			callCount++
			yield { type: 'text_delta', text: 'partial ' } as StreamEvent
			if (callCount === 1) {
				throw new Error('Connection lost')
			}
			yield { type: 'text_delta', text: 'recovered' } as StreamEvent
			yield { type: 'message_end', usage: null, stopReason: 'end_turn' } as StreamEvent
		}

		const stream = new ElsiumStream(failingSource())
		const resilientStream = stream.resilient({ checkpointIntervalMs: 10 })

		const text = await resilientStream.toText()
		expect(typeof text).toBe('string')
		expect(text.length).toBeGreaterThan(0)
	})
})
