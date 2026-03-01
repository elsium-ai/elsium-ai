import { describe, expect, it } from 'vitest'
import { createStream } from './stream'
import type { StreamCheckpoint, StreamEvent } from './types'

describe('Resilient Streaming', () => {
	it('should emit checkpoint events at intervals', async () => {
		const checkpoints: StreamCheckpoint[] = []

		const stream = createStream(async (emit) => {
			emit({ type: 'message_start', id: 'msg_1', model: 'test' })
			for (let i = 0; i < 10; i++) {
				emit({ type: 'text_delta', text: `chunk${i} ` })
				await new Promise((r) => setTimeout(r, 10))
			}
			emit({
				type: 'message_end',
				usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
				stopReason: 'end_turn',
			})
		}).resilient({
			checkpointIntervalMs: 30,
			onCheckpoint: (cp) => checkpoints.push(cp),
		})

		const events: StreamEvent[] = []
		for await (const event of stream) {
			events.push(event)
		}

		// Should have at least some checkpoint events
		const cpEvents = events.filter((e) => e.type === 'checkpoint')
		expect(cpEvents.length).toBeGreaterThan(0)
		expect(checkpoints.length).toBeGreaterThan(0)
		expect(checkpoints[0].text.length).toBeGreaterThan(0)
	})

	it('should recover partial text on error', async () => {
		let recoveredText = ''

		const stream = createStream(async (emit) => {
			emit({ type: 'text_delta', text: 'Hello ' })
			emit({ type: 'text_delta', text: 'World' })
			throw new Error('Stream interrupted')
		}).resilient({
			onPartialRecovery: (text) => {
				recoveredText = text
			},
		})

		const events: StreamEvent[] = []
		for await (const event of stream) {
			events.push(event)
		}

		const recoveryEvents = events.filter((e) => e.type === 'recovery')
		expect(recoveryEvents.length).toBe(1)
		expect(recoveredText).toBe('Hello World')
	})

	it('should emit error on failure with no text', async () => {
		const stream = createStream(async () => {
			throw new Error('Immediate failure')
		}).resilient({})

		const events: StreamEvent[] = []
		for await (const event of stream) {
			events.push(event)
		}

		expect(events.some((e) => e.type === 'error')).toBe(true)
	})

	it('toTextWithTimeout should return partial text on timeout', async () => {
		const stream = createStream(async (emit) => {
			emit({ type: 'text_delta', text: 'Hello ' })
			await new Promise((r) => setTimeout(r, 10))
			emit({ type: 'text_delta', text: 'World' })
			await new Promise((r) => setTimeout(r, 5000))
			emit({ type: 'text_delta', text: ' Never reached' })
		})

		const text = await stream.toTextWithTimeout(100)
		expect(text).toContain('Hello')
		expect(text).not.toContain('Never reached')
	})

	it('toTextWithTimeout should return full text if completed in time', async () => {
		const stream = createStream(async (emit) => {
			emit({ type: 'text_delta', text: 'Hello World' })
		})

		const text = await stream.toTextWithTimeout(5000)
		expect(text).toBe('Hello World')
	})
})
