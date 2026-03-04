import { describe, expect, it } from 'vitest'
import { createSpan } from './span'

describe('createSpan', () => {
	it('creates a span with id, traceId, name, and kind', () => {
		const span = createSpan('test-span', { kind: 'llm' })

		expect(span.id).toMatch(/^spn_/)
		expect(span.traceId).toMatch(/^trc_/)
		expect(span.name).toBe('test-span')
		expect(span.kind).toBe('llm')
	})

	it('defaults kind to custom when not provided', () => {
		const span = createSpan('my-span')
		expect(span.kind).toBe('custom')
	})

	it('uses provided traceId', () => {
		const span = createSpan('span', { traceId: 'trc_abc123' })
		expect(span.traceId).toBe('trc_abc123')
	})

	it('generates unique ids for each span', () => {
		const a = createSpan('a')
		const b = createSpan('b')
		expect(a.id).not.toBe(b.id)
		expect(a.traceId).not.toBe(b.traceId)
	})

	describe('addEvent', () => {
		it('adds events with timestamps', () => {
			const before = Date.now()
			const span = createSpan('span')
			span.addEvent('my-event', { key: 'value' })
			const after = Date.now()

			const data = span.toJSON()
			expect(data.events).toHaveLength(1)
			expect(data.events[0].name).toBe('my-event')
			expect(data.events[0].data).toEqual({ key: 'value' })
			expect(data.events[0].timestamp).toBeGreaterThanOrEqual(before)
			expect(data.events[0].timestamp).toBeLessThanOrEqual(after)
		})

		it('adds multiple events in order', () => {
			const span = createSpan('span')
			span.addEvent('first')
			span.addEvent('second')
			span.addEvent('third')

			const { events } = span.toJSON()
			expect(events).toHaveLength(3)
			expect(events[0].name).toBe('first')
			expect(events[1].name).toBe('second')
			expect(events[2].name).toBe('third')
		})

		it('adds events without data', () => {
			const span = createSpan('span')
			span.addEvent('no-data-event')

			const { events } = span.toJSON()
			expect(events[0].data).toBeUndefined()
		})
	})

	describe('setMetadata', () => {
		it('sets metadata key-value pairs', () => {
			const span = createSpan('span')
			span.setMetadata('model', 'gpt-4')
			span.setMetadata('tokens', 100)

			const { metadata } = span.toJSON()
			expect(metadata.model).toBe('gpt-4')
			expect(metadata.tokens).toBe(100)
		})

		it('rejects __proto__ key', () => {
			const span = createSpan('span')
			span.setMetadata('__proto__', { polluted: true })

			const { metadata } = span.toJSON()
			// __proto__ must not be stored as an own property — use hasOwn to avoid
			// triggering the special prototype accessor on all objects
			expect(Object.hasOwn(metadata, '__proto__')).toBe(false)
			expect(Object.prototype.polluted).toBeUndefined()
		})

		it('rejects constructor key', () => {
			const span = createSpan('span')
			span.setMetadata('constructor', 'evil')

			const { metadata } = span.toJSON()
			expect(Object.keys(metadata)).not.toContain('constructor')
		})

		it('rejects prototype key', () => {
			const span = createSpan('span')
			span.setMetadata('prototype', 'evil')

			const { metadata } = span.toJSON()
			expect(Object.keys(metadata)).not.toContain('prototype')
		})

		it('allows other keys normally', () => {
			const span = createSpan('span')
			span.setMetadata('provider', 'anthropic')

			expect(span.toJSON().metadata.provider).toBe('anthropic')
		})
	})

	describe('end', () => {
		it('sets status and endTime when ended', () => {
			const before = Date.now()
			const span = createSpan('span')
			span.end({ status: 'ok' })
			const after = Date.now()

			const data = span.toJSON()
			expect(data.status).toBe('ok')
			expect(data.endTime).toBeGreaterThanOrEqual(before)
			expect(data.endTime).toBeLessThanOrEqual(after)
			expect(data.durationMs).toBeGreaterThanOrEqual(0)
		})

		it('defaults status to ok when no result provided', () => {
			const span = createSpan('span')
			span.end()

			expect(span.toJSON().status).toBe('ok')
		})

		it('sets error status', () => {
			const span = createSpan('span')
			span.end({ status: 'error' })

			expect(span.toJSON().status).toBe('error')
		})

		it('merges metadata from result', () => {
			const span = createSpan('span')
			span.setMetadata('existing', 'yes')
			span.end({ status: 'ok', metadata: { extra: 'data' } })

			const { metadata } = span.toJSON()
			expect(metadata.existing).toBe('yes')
			expect(metadata.extra).toBe('data')
		})

		it('is idempotent — second call is a no-op', () => {
			const span = createSpan('span')
			span.end({ status: 'ok' })
			const firstEndTime = span.toJSON().endTime

			span.end({ status: 'error' })
			const data = span.toJSON()

			expect(data.status).toBe('ok')
			expect(data.endTime).toBe(firstEndTime)
		})

		it('calls onEnd callback when ended', () => {
			let called = false
			const span = createSpan('span', {
				onEnd: (data) => {
					called = true
					expect(data.name).toBe('span')
					expect(data.status).toBe('ok')
				},
			})

			span.end({ status: 'ok' })
			expect(called).toBe(true)
		})

		it('does not call onEnd on second end call', () => {
			let callCount = 0
			const span = createSpan('span', {
				onEnd: () => {
					callCount++
				},
			})

			span.end()
			span.end()
			expect(callCount).toBe(1)
		})
	})

	describe('child', () => {
		it('creates a child span with the same traceId', () => {
			const parent = createSpan('parent', { kind: 'agent' })
			const child = parent.child('child-op')

			expect(child.traceId).toBe(parent.traceId)
		})

		it('sets parentId to parent span id', () => {
			const parent = createSpan('parent')
			const child = parent.child('child-op')

			expect(child.toJSON().parentId).toBe(parent.id)
		})

		it('has a different id than parent', () => {
			const parent = createSpan('parent')
			const child = parent.child('child-op')

			expect(child.id).not.toBe(parent.id)
		})

		it('inherits parent kind when no kind provided', () => {
			const parent = createSpan('parent', { kind: 'llm' })
			const child = parent.child('child-op')

			expect(child.kind).toBe('llm')
		})

		it('uses provided kind on child', () => {
			const parent = createSpan('parent', { kind: 'agent' })
			const child = parent.child('child-op', 'tool')

			expect(child.kind).toBe('tool')
		})
	})

	describe('toJSON', () => {
		it('includes all span fields', () => {
			const span = createSpan('my-span', { kind: 'workflow', traceId: 'trc_test' })
			span.setMetadata('foo', 'bar')
			span.addEvent('my-event')

			const data = span.toJSON()
			expect(data.id).toBe(span.id)
			expect(data.traceId).toBe('trc_test')
			expect(data.name).toBe('my-span')
			expect(data.kind).toBe('workflow')
			expect(data.status).toBe('running')
			expect(data.metadata).toEqual({ foo: 'bar' })
			expect(data.events).toHaveLength(1)
		})

		it('durationMs is undefined while running', () => {
			const span = createSpan('span')
			expect(span.toJSON().durationMs).toBeUndefined()
			expect(span.toJSON().endTime).toBeUndefined()
		})

		it('durationMs is set after end', () => {
			const span = createSpan('span')
			span.end()

			expect(span.toJSON().durationMs).toBeGreaterThanOrEqual(0)
		})
	})
})
