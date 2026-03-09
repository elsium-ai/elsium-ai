import { describe, expect, it } from 'vitest'
import type {
	AuditEvent,
	AuditIntegrityResult,
	AuditQueryFilter,
	AuditStorageAdapter,
} from './audit'
import { auditMiddleware, createAuditTrail } from './audit'

describe('AuditTrail', () => {
	it('logs events and increments count', () => {
		const trail = createAuditTrail()
		expect(trail.count).toBe(0)

		trail.log('llm_call', { model: 'gpt-4o', tokens: 100 })
		expect(trail.count).toBe(1)

		trail.log('tool_execution', { tool: 'search' })
		expect(trail.count).toBe(2)
	})

	it('queries by type', async () => {
		const trail = createAuditTrail()
		trail.log('llm_call', { model: 'gpt-4o' })
		trail.log('tool_execution', { tool: 'search' })
		trail.log('llm_call', { model: 'claude' })

		const llmCalls = await trail.query({ type: 'llm_call' })
		expect(llmCalls).toHaveLength(2)

		const toolExecs = await trail.query({ type: 'tool_execution' })
		expect(toolExecs).toHaveLength(1)
	})

	it('queries by traceId', async () => {
		const trail = createAuditTrail()
		trail.log('llm_call', { model: 'gpt-4o' }, { traceId: 'trace-1' })
		trail.log('llm_call', { model: 'claude' }, { traceId: 'trace-2' })

		const results = await trail.query({ traceId: 'trace-1' })
		expect(results).toHaveLength(1)
		expect(results[0].data.model).toBe('gpt-4o')
	})

	it('queries by actor', async () => {
		const trail = createAuditTrail()
		trail.log('auth_event', { action: 'login' }, { actor: 'user-1' })
		trail.log('auth_event', { action: 'login' }, { actor: 'user-2' })

		const results = await trail.query({ actor: 'user-1' })
		expect(results).toHaveLength(1)
	})

	it('queries with limit and offset', async () => {
		const trail = createAuditTrail()
		for (let i = 0; i < 10; i++) {
			trail.log('llm_call', { index: i })
		}

		const page1 = await trail.query({ limit: 3 })
		expect(page1).toHaveLength(3)

		const page2 = await trail.query({ limit: 3, offset: 3 })
		expect(page2).toHaveLength(3)
		expect(page2[0].data.index).toBe(3)
	})

	it('queries by timestamp range', async () => {
		const trail = createAuditTrail()
		const before = Date.now()
		trail.log('llm_call', { model: 'gpt-4o' })
		const after = Date.now()

		const results = await trail.query({ fromTimestamp: before, toTimestamp: after })
		expect(results).toHaveLength(1)
	})

	it('maintains hash chain integrity', async () => {
		const trail = createAuditTrail()
		trail.log('llm_call', { model: 'gpt-4o' })
		trail.log('tool_execution', { tool: 'search' })
		trail.log('security_violation', { detail: 'injection detected' })

		const integrity = await trail.verifyIntegrity()
		expect(integrity.valid).toBe(true)
		expect(integrity.totalEvents).toBe(3)
	})

	it('events have sequential IDs', async () => {
		const trail = createAuditTrail()
		trail.log('llm_call', { a: 1 })
		trail.log('llm_call', { a: 2 })

		const events = await trail.query({})
		expect(events[0].sequenceId).toBe(1)
		expect(events[1].sequenceId).toBe(2)
	})

	it('events have hash and previousHash', async () => {
		const trail = createAuditTrail()
		trail.log('llm_call', { model: 'gpt-4o' })

		const events = await trail.query({})
		expect(events[0].hash).toBeTruthy()
		expect(events[0].previousHash).toBe('0'.repeat(64))
	})

	it('chain links events via previousHash', async () => {
		const trail = createAuditTrail()
		trail.log('llm_call', { a: 1 })
		trail.log('llm_call', { a: 2 })

		const events = await trail.query({})
		expect(events[1].previousHash).toBe(events[0].hash)
	})

	it('queries by multiple types', async () => {
		const trail = createAuditTrail()
		trail.log('llm_call', { a: 1 })
		trail.log('tool_execution', { b: 2 })
		trail.log('security_violation', { c: 3 })

		const results = await trail.query({ type: ['llm_call', 'tool_execution'] })
		expect(results).toHaveLength(2)
	})

	it('works with hashChain disabled', async () => {
		const trail = createAuditTrail({ hashChain: false })
		trail.log('llm_call', { a: 1 })
		trail.log('llm_call', { a: 2 })

		expect(trail.count).toBe(2)
	})

	it('count is correct after eviction', () => {
		const trail = createAuditTrail({ maxEvents: 5 })

		for (let i = 0; i < 8; i++) {
			trail.log('llm_call', { index: i })
		}

		expect(trail.count).toBe(5)
	})

	it('chainComplete is true without eviction, false after eviction', async () => {
		const noEviction = createAuditTrail({ maxEvents: 10 })
		for (let i = 0; i < 3; i++) {
			noEviction.log('llm_call', { index: i })
		}
		const integrityFull = await noEviction.verifyIntegrity()
		expect(integrityFull.valid).toBe(true)
		expect(integrityFull.chainComplete).toBe(true)

		const withEviction = createAuditTrail({ maxEvents: 3 })
		for (let i = 0; i < 6; i++) {
			withEviction.log('llm_call', { index: i })
		}
		const integrityEvicted = await withEviction.verifyIntegrity()
		expect(integrityEvicted.valid).toBe(true)
		expect(integrityEvicted.chainComplete).toBe(false)
	})

	it('getLastHash is used on init to resume chain', async () => {
		const preExistingHash = 'a'.repeat(64)
		const events: AuditEvent[] = []

		const adapter: AuditStorageAdapter = {
			append(event: AuditEvent) {
				events.push(event)
			},
			query(_filter: AuditQueryFilter) {
				return events
			},
			count() {
				return events.length
			},
			verifyIntegrity(): AuditIntegrityResult {
				return { valid: true, totalEvents: events.length }
			},
			getLastHash() {
				return preExistingHash
			},
		}

		const trail = createAuditTrail({ storage: adapter, hashChain: true })
		trail.log('llm_call', { model: 'test' })

		expect(events).toHaveLength(1)
		expect(events[0].previousHash).toBe(preExistingHash)
	})

	it('getLastHash works with async storage adapter', async () => {
		const preExistingHash = 'b'.repeat(64)
		const events: AuditEvent[] = []

		const adapter: AuditStorageAdapter = {
			append(event: AuditEvent) {
				events.push(event)
			},
			query(_filter: AuditQueryFilter) {
				return events
			},
			count() {
				return events.length
			},
			verifyIntegrity(): AuditIntegrityResult {
				return { valid: true, totalEvents: events.length }
			},
			getLastHash() {
				return Promise.resolve(preExistingHash)
			},
		}

		const trail = createAuditTrail({ storage: adapter, hashChain: true })

		// Log before awaiting ready() — the entry must still use the correct hash
		trail.log('llm_call', { model: 'test' })

		// Await initialization; this also drains all queued log() calls
		await trail.ready()

		expect(events).toHaveLength(1)
		expect(events[0].previousHash).toBe(preExistingHash)
	})
})

describe('AuditTrail batched mode', () => {
	it('buffers events and flushes on demand', async () => {
		const trail = createAuditTrail({ batch: { size: 100, intervalMs: 60_000 } })

		trail.log('llm_call', { model: 'gpt-4o' })
		trail.log('tool_execution', { tool: 'search' })

		expect(trail.pending).toBe(2)

		const beforeFlush = await trail.query({})
		expect(beforeFlush).toHaveLength(2)
		expect(trail.pending).toBe(0)

		trail.dispose()
	})

	it('auto-flushes when batch size is reached', () => {
		const trail = createAuditTrail({ batch: { size: 3, intervalMs: 60_000 } })

		trail.log('llm_call', { i: 0 })
		trail.log('llm_call', { i: 1 })
		expect(trail.pending).toBe(2)

		trail.log('llm_call', { i: 2 })
		expect(trail.pending).toBe(0)

		trail.dispose()
	})

	it('maintains hash chain integrity in batched mode', async () => {
		const trail = createAuditTrail({ batch: { size: 10 } })

		for (let i = 0; i < 5; i++) {
			trail.log('llm_call', { index: i })
		}

		await trail.flush()
		const integrity = await trail.verifyIntegrity()
		expect(integrity.valid).toBe(true)
		expect(integrity.totalEvents).toBe(5)
		expect(integrity.chainComplete).toBe(true)

		trail.dispose()
	})

	it('chain links events correctly in batched mode', async () => {
		const trail = createAuditTrail({ batch: { size: 10 } })

		trail.log('llm_call', { a: 1 })
		trail.log('llm_call', { a: 2 })

		await trail.flush()
		const events = await trail.query({})
		expect(events[1].previousHash).toBe(events[0].hash)

		trail.dispose()
	})

	it('count includes pending events', () => {
		const trail = createAuditTrail({ batch: { size: 100 } })

		trail.log('llm_call', { a: 1 })
		trail.log('llm_call', { a: 2 })

		expect(trail.count).toBe(2)
		expect(trail.pending).toBe(2)

		trail.dispose()
	})

	it('dispose drains buffer and stops timer', async () => {
		const trail = createAuditTrail({ batch: { size: 100, intervalMs: 10 } })

		trail.log('llm_call', { a: 1 })
		trail.dispose()

		expect(trail.pending).toBe(0)
		const events = await trail.query({})
		expect(events).toHaveLength(1)
	})

	it('flush and dispose are safe to call on non-batched trails', async () => {
		const trail = createAuditTrail()
		trail.log('llm_call', { a: 1 })

		await trail.flush()
		trail.dispose()

		expect(trail.count).toBe(1)
		expect(trail.pending).toBe(0)
	})
})

describe('AuditTrail ring buffer eviction', () => {
	it('eviction is O(1) — count stays at max', () => {
		const trail = createAuditTrail({ maxEvents: 5 })

		for (let i = 0; i < 100; i++) {
			trail.log('llm_call', { index: i })
		}

		expect(trail.count).toBe(5)
	})

	it('preserves most recent events after eviction', async () => {
		const trail = createAuditTrail({ maxEvents: 3 })

		for (let i = 0; i < 6; i++) {
			trail.log('llm_call', { index: i })
		}

		const events = await trail.query({})
		expect(events).toHaveLength(3)
		expect(events[0].data.index).toBe(3)
		expect(events[1].data.index).toBe(4)
		expect(events[2].data.index).toBe(5)
	})
})

describe('auditMiddleware', () => {
	it('creates valid middleware', () => {
		const trail = createAuditTrail()
		const mw = auditMiddleware(trail)
		expect(typeof mw).toBe('function')
	})
})
