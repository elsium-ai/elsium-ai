import { createRBAC } from '@elsium-ai/app'
import { createPolicySet } from '@elsium-ai/core'
import { createAuditTrail } from '@elsium-ai/observe'
/**
 * Test 18: Governance
 * Verifies: createPolicySet, createAuditTrail, createRBAC
 */
import { describe, expect, it } from 'vitest'

describe('18 — Governance', () => {
	// ── Policy Engine ──────────────────────────────────────
	describe('createPolicySet', () => {
		it('evaluates policies against a context', () => {
			const policies = createPolicySet([
				{
					name: 'model-restriction',
					rules: [
						(ctx) => ({
							decision: ctx.model === 'gpt-4o' ? 'allow' : 'deny',
							reason: ctx.model === 'gpt-4o' ? 'Approved model' : 'Model not allowed',
							policyName: 'model-restriction',
						}),
					],
				},
			])

			const allowed = policies.evaluate({ model: 'gpt-4o' })
			expect(allowed.every((r) => r.decision === 'allow')).toBe(true)

			const denied = policies.evaluate({ model: 'some-unknown-model' })
			expect(denied.some((r) => r.decision === 'deny')).toBe(true)
		})

		it('supports multiple policies', () => {
			const policies = createPolicySet([
				{
					name: 'cost-limit',
					rules: [
						(ctx) => ({
							decision: (ctx.costEstimate ?? 0) < 1.0 ? 'allow' : 'deny',
							reason: 'Cost check',
							policyName: 'cost-limit',
						}),
					],
				},
				{
					name: 'token-limit',
					rules: [
						(ctx) => ({
							decision: (ctx.tokenCount ?? 0) < 10000 ? 'allow' : 'deny',
							reason: 'Token check',
							policyName: 'token-limit',
						}),
					],
				},
			])

			expect(policies.policies).toContain('cost-limit')
			expect(policies.policies).toContain('token-limit')
		})

		it('addPolicy and removePolicy', () => {
			const policies = createPolicySet([])

			policies.addPolicy({
				name: 'new-policy',
				rules: [() => ({ decision: 'allow', reason: 'ok', policyName: 'new-policy' })],
			})

			expect(policies.policies).toContain('new-policy')

			policies.removePolicy('new-policy')
			expect(policies.policies).not.toContain('new-policy')
		})
	})

	// ── Audit Trail ────────────────────────────────────────
	describe('createAuditTrail', () => {
		it('logs events and queries them', async () => {
			const audit = createAuditTrail({ storage: 'memory', hashChain: true })

			audit.log('llm_call', { model: 'gpt-4o', tokens: 500 }, { actor: 'user-1' })
			audit.log('tool_execution', { tool: 'search', success: true })
			audit.log('security_violation', { type: 'injection', input: 'bad input' })

			expect(audit.count).toBe(3)

			const all = await audit.query({})
			expect(all).toHaveLength(3)

			const llmOnly = await audit.query({ type: 'llm_call' })
			expect(llmOnly).toHaveLength(1)
			expect(llmOnly[0].type).toBe('llm_call')
		})

		it('verifies integrity of hash chain', async () => {
			const audit = createAuditTrail({ hashChain: true })

			audit.log('llm_call', { model: 'test' })
			audit.log('tool_execution', { tool: 'calc' })

			const integrity = await audit.verifyIntegrity()
			expect(integrity.valid).toBe(true)
		})

		it('count reflects number of events', () => {
			const audit = createAuditTrail()

			expect(audit.count).toBe(0)
			audit.log('config_change', { key: 'model', value: 'new' })
			expect(audit.count).toBe(1)
		})
	})

	// ── RBAC ───────────────────────────────────────────────
	describe('createRBAC', () => {
		it('checks permissions for roles', () => {
			const rbac = createRBAC({
				roles: [
					{ name: 'admin', permissions: ['model:use', 'config:write', 'audit:read'] },
					{ name: 'user', permissions: ['model:use'] },
				],
			})

			expect(rbac.hasPermission('admin', 'config:write')).toBe(true)
			expect(rbac.hasPermission('user', 'config:write')).toBe(false)
			expect(rbac.hasPermission('user', 'model:use')).toBe(true)
		})

		it('getRolePermissions returns all permissions', () => {
			const rbac = createRBAC({
				roles: [{ name: 'viewer', permissions: ['audit:read', 'config:read'] }],
			})

			const perms = rbac.getRolePermissions('viewer')
			expect(perms).toContain('audit:read')
			expect(perms).toContain('config:read')
		})

		it('middleware returns a function', () => {
			const rbac = createRBAC({
				roles: [{ name: 'admin', permissions: ['model:use'] }],
			})

			const mw = rbac.middleware('model:use')
			expect(typeof mw).toBe('function')
		})

		it('role inheritance', () => {
			const rbac = createRBAC({
				roles: [
					{ name: 'base', permissions: ['model:use'] },
					{ name: 'admin', permissions: ['config:write'], inherits: ['base'] },
				],
			})

			expect(rbac.hasPermission('admin', 'model:use')).toBe(true)
			expect(rbac.hasPermission('admin', 'config:write')).toBe(true)
		})
	})
})
