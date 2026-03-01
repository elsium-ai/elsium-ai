import { createRBAC } from '@elsium-ai/app'
import { createPolicySet, modelAccessPolicy, policyMiddleware } from '@elsium-ai/core'
import { gateway } from '@elsium-ai/gateway'
import { registerProviderFactory } from '@elsium-ai/gateway'
import { auditMiddleware, createAuditTrail } from '@elsium-ai/observe'
import { mockProvider } from '@elsium-ai/testing'
/**
 * Test 35: Governance Pipeline
 * Verifies: policyMiddleware + auditMiddleware + RBAC together
 */
import { describe, expect, it } from 'vitest'
import { describeWithLLM } from '../lib/helpers'

describe('35 — Governance Pipeline (Framework)', () => {
	it('allowed model passes through policy + audit pipeline', async () => {
		registerProviderFactory('mock-gov', () =>
			mockProvider({ defaultResponse: { content: 'Mock response' } }),
		)

		const policies = createPolicySet([modelAccessPolicy(['gpt-4o-mini', 'gpt-4o'])])
		const audit = createAuditTrail({ hashChain: true })

		const gw = gateway({
			provider: 'mock-gov',
			apiKey: 'test',
			model: 'gpt-4o-mini',
			middleware: [policyMiddleware(policies), auditMiddleware(audit)],
		})

		const response = await gw.complete({
			messages: [{ role: 'user', content: 'Hello' }],
		})

		expect(response.message.content).toBeDefined()
		expect(audit.count).toBeGreaterThan(0)
	})

	it('disallowed model is rejected by policy', async () => {
		registerProviderFactory('mock-gov2', () =>
			mockProvider({ defaultResponse: { content: 'Mock response' } }),
		)

		const policies = createPolicySet([modelAccessPolicy(['gpt-4o-mini'])])
		const audit = createAuditTrail({ hashChain: true })

		const gw = gateway({
			provider: 'mock-gov2',
			apiKey: 'test',
			model: 'claude-sonnet-4-6',
			middleware: [policyMiddleware(policies), auditMiddleware(audit)],
		})

		await expect(gw.complete({ messages: [{ role: 'user', content: 'Hello' }] })).rejects.toThrow(
			'Policy denied',
		)
	})

	it('RBAC hasPermission works with wildcard model access', () => {
		const rbac = createRBAC({
			roles: [{ name: 'analyst', permissions: ['model:use:gpt-4o-mini'], inherits: ['viewer'] }],
		})

		expect(rbac.hasPermission('admin', 'model:use:gpt-4o')).toBe(true)
		expect(rbac.hasPermission('analyst', 'model:use:gpt-4o-mini')).toBe(true)
	})
})

describeWithLLM('35 — Governance Pipeline (Real LLM)', () => {
	it('policy allows gpt-4o-mini + audit logs with valid integrity', async () => {
		const policies = createPolicySet([modelAccessPolicy(['gpt-4o-mini', 'gpt-4o*'])])
		const audit = createAuditTrail({ hashChain: true })
		const apiKey = process.env.OPENAI_API_KEY as string

		const gw = gateway({
			provider: 'openai',
			apiKey,
			model: 'gpt-4o-mini',
			middleware: [policyMiddleware(policies), auditMiddleware(audit)],
		})

		const response = await gw.complete({
			messages: [{ role: 'user', content: 'Say hello' }],
			maxTokens: 10,
		})

		expect(response.message.content.length).toBeGreaterThan(0)

		const events = await audit.query({})
		expect(events.length).toBeGreaterThan(0)

		const integrity = await audit.verifyIntegrity()
		expect(integrity.valid).toBe(true)
	})

	it('policy blocks disallowed model before LLM call', async () => {
		const policies = createPolicySet([modelAccessPolicy(['claude-sonnet-4-6'])])
		const apiKey = process.env.OPENAI_API_KEY as string

		const gw = gateway({
			provider: 'openai',
			apiKey,
			model: 'gpt-4o-mini',
			middleware: [policyMiddleware(policies)],
		})

		await expect(
			gw.complete({
				messages: [{ role: 'user', content: 'Hello' }],
				maxTokens: 5,
			}),
		).rejects.toThrow('Policy denied')
	})
})
