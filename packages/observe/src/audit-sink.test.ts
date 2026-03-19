import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuditEvent } from './audit'
import type { AuditSink } from './audit-sink'
import { createSinkManager } from './audit-sink'

function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
	return {
		id: `audit_${Math.random().toString(36).slice(2)}`,
		sequenceId: 1,
		type: 'llm_call',
		timestamp: Date.now(),
		data: { model: 'test' },
		hash: 'abc123',
		previousHash: '0'.repeat(64),
		...overrides,
	}
}

function mockSink(
	name = 'mock',
): AuditSink & { send: ReturnType<typeof vi.fn>; shutdown: ReturnType<typeof vi.fn> } {
	return {
		name,
		send: vi.fn<[AuditEvent[]], Promise<void>>().mockResolvedValue(undefined),
		shutdown: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
	}
}

describe('SinkManager', () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('dispatches events to a single sink on flush', async () => {
		const sink = mockSink()
		const manager = createSinkManager({ sinks: [sink], batch: { size: 10 } })

		manager.dispatch(makeEvent())
		manager.dispatch(makeEvent())
		await manager.flush()

		expect(sink.send).toHaveBeenCalledOnce()
		expect(sink.send.mock.calls[0][0]).toHaveLength(2)
	})

	it('dispatches to multiple sinks concurrently', async () => {
		const sink1 = mockSink('s1')
		const sink2 = mockSink('s2')
		const manager = createSinkManager({ sinks: [sink1, sink2], batch: { size: 10 } })

		manager.dispatch(makeEvent())
		await manager.flush()

		expect(sink1.send).toHaveBeenCalledOnce()
		expect(sink2.send).toHaveBeenCalledOnce()
	})

	it('batches events by size', async () => {
		const sink = mockSink()
		const manager = createSinkManager({ sinks: [sink], batch: { size: 3, intervalMs: 60_000 } })

		manager.dispatch(makeEvent())
		manager.dispatch(makeEvent())
		manager.dispatch(makeEvent())

		await vi.advanceTimersByTimeAsync(0)
		await manager.flush()

		expect(sink.send).toHaveBeenCalled()
		expect(sink.send.mock.calls[0][0]).toHaveLength(3)
	})

	it('flushes on interval', async () => {
		const sink = mockSink()
		const manager = createSinkManager({
			sinks: [sink],
			batch: { size: 100, intervalMs: 1000 },
		})

		manager.dispatch(makeEvent())
		expect(sink.send).not.toHaveBeenCalled()

		await vi.advanceTimersByTimeAsync(1000)
		await manager.flush()

		expect(sink.send).toHaveBeenCalledOnce()
	})

	it('retries failed sends with exponential backoff', async () => {
		const sink = mockSink()
		sink.send
			.mockRejectedValueOnce(new Error('fail 1'))
			.mockRejectedValueOnce(new Error('fail 2'))
			.mockResolvedValueOnce(undefined)

		const manager = createSinkManager({
			sinks: [sink],
			batch: { size: 10 },
			retry: { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 1000 },
		})

		manager.dispatch(makeEvent())

		vi.useRealTimers()
		await manager.flush()

		expect(sink.send).toHaveBeenCalledTimes(3)
	})

	it('calls onError after retries exhausted', async () => {
		const sink = mockSink()
		sink.send.mockRejectedValue(new Error('persistent failure'))

		const onError = vi.fn()
		const manager = createSinkManager({
			sinks: [sink],
			batch: { size: 10 },
			retry: { maxRetries: 1, baseDelayMs: 10, maxDelayMs: 50 },
			onError,
		})

		manager.dispatch(makeEvent())

		vi.useRealTimers()
		await manager.flush()

		expect(onError).toHaveBeenCalledWith('mock', expect.any(Error))
	})

	it('one failing sink does not block other sinks', async () => {
		const failingSink = mockSink('failing')
		failingSink.send.mockRejectedValue(new Error('fail'))
		const healthySink = mockSink('healthy')

		const manager = createSinkManager({
			sinks: [failingSink, healthySink],
			batch: { size: 10 },
			retry: { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 10 },
		})

		manager.dispatch(makeEvent())

		vi.useRealTimers()
		await manager.flush()

		expect(healthySink.send).toHaveBeenCalledOnce()
	})

	it('shutdown clears timer, flushes, and calls sink shutdown', async () => {
		const sink = mockSink()
		const manager = createSinkManager({ sinks: [sink], batch: { size: 100 } })

		manager.dispatch(makeEvent())

		vi.useRealTimers()
		await manager.shutdown()

		expect(sink.send).toHaveBeenCalledOnce()
		expect(sink.shutdown).toHaveBeenCalledOnce()
	})

	it('handles sinks without shutdown method', async () => {
		const sink: AuditSink = {
			name: 'no-shutdown',
			send: vi.fn<[AuditEvent[]], Promise<void>>().mockResolvedValue(undefined),
		}
		const manager = createSinkManager({ sinks: [sink], batch: { size: 10 } })

		manager.dispatch(makeEvent())

		vi.useRealTimers()
		await expect(manager.shutdown()).resolves.toBeUndefined()
	})

	it('drops oldest event when buffer exceeds maxBufferSize', async () => {
		const sink = mockSink()
		const manager = createSinkManager({
			sinks: [sink],
			batch: { size: 100, intervalMs: 60_000 },
			maxBufferSize: 3,
		})

		manager.dispatch(makeEvent({ sequenceId: 1 }))
		manager.dispatch(makeEvent({ sequenceId: 2 }))
		manager.dispatch(makeEvent({ sequenceId: 3 }))
		manager.dispatch(makeEvent({ sequenceId: 4 }))

		vi.useRealTimers()
		await manager.flush()

		const sentEvents = sink.send.mock.calls[0][0]
		expect(sentEvents).toHaveLength(3)
		expect(sentEvents[0].sequenceId).toBe(2)
	})

	it('no-ops when no events are dispatched', async () => {
		const sink = mockSink()
		const manager = createSinkManager({ sinks: [sink], batch: { size: 10 } })

		await manager.flush()

		expect(sink.send).not.toHaveBeenCalled()
	})

	it('applies per-sink filter to events', async () => {
		const securitySink = mockSink('security')
		securitySink.filter = (event) => event.type === 'security_violation'

		const allEventsSink = mockSink('all')

		const manager = createSinkManager({
			sinks: [securitySink, allEventsSink],
			batch: { size: 10 },
		})

		manager.dispatch(makeEvent({ type: 'llm_call' }))
		manager.dispatch(makeEvent({ type: 'security_violation' }))
		manager.dispatch(makeEvent({ type: 'tool_execution' }))

		vi.useRealTimers()
		await manager.flush()

		expect(securitySink.send).toHaveBeenCalledOnce()
		expect(securitySink.send.mock.calls[0][0]).toHaveLength(1)
		expect(securitySink.send.mock.calls[0][0][0].type).toBe('security_violation')

		expect(allEventsSink.send).toHaveBeenCalledOnce()
		expect(allEventsSink.send.mock.calls[0][0]).toHaveLength(3)
	})

	it('skips sink entirely when filter matches no events', async () => {
		const sink = mockSink()
		sink.filter = () => false

		const manager = createSinkManager({ sinks: [sink], batch: { size: 10 } })

		manager.dispatch(makeEvent())

		vi.useRealTimers()
		await manager.flush()

		expect(sink.send).not.toHaveBeenCalled()
	})

	it('sends failed events to dead letter sink after retry exhaustion', async () => {
		const failingSink = mockSink('failing')
		failingSink.send.mockRejectedValue(new Error('permanent failure'))

		const dlqSink = mockSink('dlq')

		const manager = createSinkManager({
			sinks: [failingSink],
			batch: { size: 10 },
			retry: { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 10 },
			deadLetterSink: dlqSink,
		})

		const event = makeEvent({ type: 'security_violation' })
		manager.dispatch(event)

		vi.useRealTimers()
		await manager.flush()

		expect(dlqSink.send).toHaveBeenCalledOnce()
		expect(dlqSink.send.mock.calls[0][0]).toHaveLength(1)
		expect(dlqSink.send.mock.calls[0][0][0].type).toBe('security_violation')
	})

	it('reports dead letter sink failure via onError', async () => {
		const failingSink = mockSink('failing')
		failingSink.send.mockRejectedValue(new Error('fail'))

		const dlqSink = mockSink('dlq')
		dlqSink.send.mockRejectedValue(new Error('dlq also failed'))

		const onError = vi.fn()
		const manager = createSinkManager({
			sinks: [failingSink],
			batch: { size: 10 },
			retry: { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 10 },
			deadLetterSink: dlqSink,
			onError,
		})

		manager.dispatch(makeEvent())

		vi.useRealTimers()
		await manager.flush()

		expect(onError).toHaveBeenCalledWith('failing', expect.any(Error))
		expect(onError).toHaveBeenCalledWith('dlq', expect.any(Error))
	})

	it('does not send to dead letter sink on success', async () => {
		const sink = mockSink()
		const dlqSink = mockSink('dlq')

		const manager = createSinkManager({
			sinks: [sink],
			batch: { size: 10 },
			deadLetterSink: dlqSink,
		})

		manager.dispatch(makeEvent())

		vi.useRealTimers()
		await manager.flush()

		expect(sink.send).toHaveBeenCalledOnce()
		expect(dlqSink.send).not.toHaveBeenCalled()
	})
})
