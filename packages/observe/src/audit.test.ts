import { describe, expect, it } from 'vitest'
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
})

describe('auditMiddleware', () => {
	it('creates valid middleware', () => {
		const trail = createAuditTrail()
		const mw = auditMiddleware(trail)
		expect(typeof mw).toBe('function')
	})
})
