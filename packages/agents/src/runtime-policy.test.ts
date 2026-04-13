import { createPolicySet, tokenLimitPolicy } from '@elsium-ai/core'
import { describe, expect, it } from 'vitest'
import {
	createRuntimePolicyEnforcer,
	iterationLimitPolicy,
	toolAccessPolicy,
} from './runtime-policy'

describe('createRuntimePolicyEnforcer', () => {
	it('allows tool calls when no restrictions', () => {
		const policies = createPolicySet([])
		const enforcer = createRuntimePolicyEnforcer({ policies })

		expect(() => enforcer.evaluateToolCall({ toolName: 'search' })).not.toThrow()
	})

	it('blocks denied tools', () => {
		const policies = createPolicySet([])
		const enforcer = createRuntimePolicyEnforcer({
			policies,
			deniedTools: ['delete_file'],
		})

		expect(() => enforcer.evaluateToolCall({ toolName: 'search' })).not.toThrow()

		expect(() => enforcer.evaluateToolCall({ toolName: 'delete_file' })).toThrow(/not allowed/)
	})

	it('only allows specified tools when allowedTools set', () => {
		const policies = createPolicySet([])
		const enforcer = createRuntimePolicyEnforcer({
			policies,
			allowedTools: ['search', 'read_file'],
		})

		expect(() => enforcer.evaluateToolCall({ toolName: 'search' })).not.toThrow()

		expect(() => enforcer.evaluateToolCall({ toolName: 'delete_file' })).toThrow(/not allowed/)
	})

	it('evaluates policy rules on tool call', () => {
		const policies = createPolicySet([tokenLimitPolicy(1000)])
		const enforcer = createRuntimePolicyEnforcer({ policies })

		expect(() => enforcer.evaluateToolCall({ toolName: 'search', tokenCount: 500 })).not.toThrow()

		expect(() => enforcer.evaluateToolCall({ toolName: 'search', tokenCount: 2000 })).toThrow(
			/token/,
		)
	})

	it('enriches context with actor and role from config', () => {
		const policies = createPolicySet([])
		const enforcer = createRuntimePolicyEnforcer({
			policies,
			actor: 'user-123',
			role: 'operator',
		})

		expect(() => enforcer.evaluateRequest({})).not.toThrow()
	})

	it('isToolAllowed returns correct boolean', () => {
		const policies = createPolicySet([])
		const enforcer = createRuntimePolicyEnforcer({
			policies,
			allowedTools: ['a', 'b'],
			deniedTools: ['c'],
		})

		expect(enforcer.isToolAllowed('a')).toBe(true)
		expect(enforcer.isToolAllowed('b')).toBe(true)
		expect(enforcer.isToolAllowed('c')).toBe(false)
		expect(enforcer.isToolAllowed('d')).toBe(false)
	})
})

describe('toolAccessPolicy', () => {
	it('allows listed tools', () => {
		const policy = toolAccessPolicy(['search', 'read'])
		const policies = createPolicySet([policy])

		const denials = policies.evaluate({ toolName: 'search' } as never)
		expect(denials).toHaveLength(0)
	})

	it('denies unlisted tools', () => {
		const policy = toolAccessPolicy(['search', 'read'])
		const policies = createPolicySet([policy])

		const denials = policies.evaluate({ toolName: 'delete' } as never)
		expect(denials).toHaveLength(1)
		expect(denials[0].policyName).toBe('tool-access')
	})

	it('allows when no tool specified', () => {
		const policy = toolAccessPolicy(['search'])
		const policies = createPolicySet([policy])

		const denials = policies.evaluate({})
		expect(denials).toHaveLength(0)
	})
})

describe('iterationLimitPolicy', () => {
	it('allows within limit', () => {
		const policy = iterationLimitPolicy(10)
		const policies = createPolicySet([policy])

		const denials = policies.evaluate({ iteration: 5 } as never)
		expect(denials).toHaveLength(0)
	})

	it('denies over limit', () => {
		const policy = iterationLimitPolicy(10)
		const policies = createPolicySet([policy])

		const denials = policies.evaluate({ iteration: 15 } as never)
		expect(denials).toHaveLength(1)
		expect(denials[0].reason).toContain('exceeds limit')
	})
})
