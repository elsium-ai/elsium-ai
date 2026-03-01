import { gateway } from '@elsium-ai/gateway'
import { auditMiddleware, createAuditTrail } from '@elsium-ai/observe'
/**
 * Test 34: Audit Trail E2E
 * Verifies: eventCount after eviction, chainComplete flag, real LLM audit logging
 */
import { describe, expect, it } from 'vitest'
import { describeWithLLM } from '../lib/helpers'

describe('34 — Audit Trail (Framework)', () => {
	it('eventCount is correct after eviction', () => {
		const audit = createAuditTrail({ maxEvents: 5 })

		for (let i = 0; i < 8; i++) {
			audit.log('llm_call', { index: i })
		}

		expect(audit.count).toBe(5)
	})

	it('chainComplete: true without eviction, false after eviction', async () => {
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

	it('verifyIntegrity is valid in both cases', async () => {
		const noEviction = createAuditTrail({ maxEvents: 100 })
		for (let i = 0; i < 10; i++) {
			noEviction.log('llm_call', { index: i })
		}
		expect((await noEviction.verifyIntegrity()).valid).toBe(true)

		const withEviction = createAuditTrail({ maxEvents: 5 })
		for (let i = 0; i < 10; i++) {
			withEviction.log('llm_call', { index: i })
		}
		expect((await withEviction.verifyIntegrity()).valid).toBe(true)
	})
})

describeWithLLM('34 — Audit Trail (Real LLM)', () => {
	it('logs real LLM call with tokens, cost, and latency', async () => {
		const audit = createAuditTrail({ hashChain: true })
		const apiKey = process.env.OPENAI_API_KEY as string

		const gw = gateway({
			provider: 'openai',
			apiKey,
			model: 'gpt-4o-mini',
			middleware: [auditMiddleware(audit)],
		})

		await gw.complete({
			messages: [{ role: 'user', content: 'Say hi' }],
			maxTokens: 10,
		})

		const events = await audit.query({})
		expect(events).toHaveLength(1)
		expect(events[0].data.inputTokens).toBeGreaterThan(0)
		expect(events[0].data.cost).toBeGreaterThan(0)
		expect(events[0].data.latencyMs).toBeGreaterThan(0)
	})

	it('two calls produce valid hash chain', async () => {
		const audit = createAuditTrail({ hashChain: true })
		const apiKey = process.env.OPENAI_API_KEY as string

		const gw = gateway({
			provider: 'openai',
			apiKey,
			model: 'gpt-4o-mini',
			middleware: [auditMiddleware(audit)],
		})

		await gw.complete({
			messages: [{ role: 'user', content: 'Say one' }],
			maxTokens: 5,
		})
		await gw.complete({
			messages: [{ role: 'user', content: 'Say two' }],
			maxTokens: 5,
		})

		const events = await audit.query({})
		expect(events).toHaveLength(2)
		expect(events[1].previousHash).toBe(events[0].hash)

		const integrity = await audit.verifyIntegrity()
		expect(integrity.valid).toBe(true)
	})

	it('logs error on invalid API key', async () => {
		const audit = createAuditTrail({ hashChain: true })

		const gw = gateway({
			provider: 'openai',
			apiKey: 'sk-invalid-key-for-audit-test-0000',
			model: 'gpt-4o-mini',
			maxRetries: 0,
			middleware: [auditMiddleware(audit)],
		})

		try {
			await gw.complete({
				messages: [{ role: 'user', content: 'Hello' }],
				maxTokens: 5,
			})
		} catch {
			// Expected to throw
		}

		const events = await audit.query({})
		expect(events).toHaveLength(1)
		expect(events[0].data.success).toBe(false)
	})
})
