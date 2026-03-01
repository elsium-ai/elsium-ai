import { describe, expect, it } from 'vitest'
import {
	contentPolicy,
	costLimitPolicy,
	createPolicySet,
	modelAccessPolicy,
	policyMiddleware,
	tokenLimitPolicy,
} from './policy'

describe('PolicySet', () => {
	it('returns empty denials for no policies', () => {
		const ps = createPolicySet([])
		const denials = ps.evaluate({})
		expect(denials).toEqual([])
	})

	it('allows when all rules pass', () => {
		const ps = createPolicySet([
			{
				name: 'test',
				rules: [() => ({ decision: 'allow', reason: 'ok', policyName: 'test' })],
			},
		])
		const denials = ps.evaluate({})
		expect(denials).toEqual([])
	})

	it('returns denials when rules fail', () => {
		const ps = createPolicySet([
			{
				name: 'blocker',
				rules: [() => ({ decision: 'deny', reason: 'blocked', policyName: 'blocker' })],
			},
		])
		const denials = ps.evaluate({})
		expect(denials).toHaveLength(1)
		expect(denials[0].reason).toBe('blocked')
	})

	it('supports any-must-pass mode', () => {
		const ps = createPolicySet([
			{
				name: 'flexible',
				mode: 'any-must-pass',
				rules: [
					() => ({ decision: 'deny', reason: 'first denies', policyName: 'flexible' }),
					() => ({ decision: 'allow', reason: 'second allows', policyName: 'flexible' }),
				],
			},
		])
		const denials = ps.evaluate({})
		expect(denials).toEqual([])
	})

	it('denies in any-must-pass when none allow', () => {
		const ps = createPolicySet([
			{
				name: 'strict',
				mode: 'any-must-pass',
				rules: [
					() => ({ decision: 'deny', reason: 'nope', policyName: 'strict' }),
					() => ({ decision: 'deny', reason: 'also nope', policyName: 'strict' }),
				],
			},
		])
		const denials = ps.evaluate({})
		expect(denials).toHaveLength(1)
	})

	it('addPolicy adds a new policy', () => {
		const ps = createPolicySet([])
		expect(ps.policies).toEqual([])

		ps.addPolicy({
			name: 'new-policy',
			rules: [() => ({ decision: 'deny', reason: 'denied', policyName: 'new-policy' })],
		})

		expect(ps.policies).toEqual(['new-policy'])
		expect(ps.evaluate({})).toHaveLength(1)
	})

	it('removePolicy removes a policy', () => {
		const ps = createPolicySet([
			{
				name: 'to-remove',
				rules: [() => ({ decision: 'deny', reason: 'denied', policyName: 'to-remove' })],
			},
		])
		expect(ps.policies).toEqual(['to-remove'])

		ps.removePolicy('to-remove')
		expect(ps.policies).toEqual([])
		expect(ps.evaluate({})).toEqual([])
	})
})

describe('modelAccessPolicy', () => {
	it('allows listed models', () => {
		const ps = createPolicySet([modelAccessPolicy(['gpt-4o', 'claude'])])
		expect(ps.evaluate({ model: 'gpt-4o' })).toEqual([])
	})

	it('denies unlisted models', () => {
		const ps = createPolicySet([modelAccessPolicy(['gpt-4o'])])
		const denials = ps.evaluate({ model: 'claude-3' })
		expect(denials).toHaveLength(1)
		expect(denials[0].reason).toContain('not in allowed list')
	})

	it('allows when no model specified', () => {
		const ps = createPolicySet([modelAccessPolicy(['gpt-4o'])])
		expect(ps.evaluate({})).toEqual([])
	})
})

describe('tokenLimitPolicy', () => {
	it('allows within limit', () => {
		const ps = createPolicySet([tokenLimitPolicy(1000)])
		expect(ps.evaluate({ tokenCount: 500 })).toEqual([])
	})

	it('denies over limit', () => {
		const ps = createPolicySet([tokenLimitPolicy(1000)])
		const denials = ps.evaluate({ tokenCount: 1500 })
		expect(denials).toHaveLength(1)
	})

	it('allows when no token count', () => {
		const ps = createPolicySet([tokenLimitPolicy(1000)])
		expect(ps.evaluate({})).toEqual([])
	})
})

describe('costLimitPolicy', () => {
	it('allows within limit', () => {
		const ps = createPolicySet([costLimitPolicy(1.0)])
		expect(ps.evaluate({ costEstimate: 0.5 })).toEqual([])
	})

	it('denies over limit', () => {
		const ps = createPolicySet([costLimitPolicy(1.0)])
		const denials = ps.evaluate({ costEstimate: 2.0 })
		expect(denials).toHaveLength(1)
	})
})

describe('contentPolicy', () => {
	it('allows clean content', () => {
		const ps = createPolicySet([contentPolicy([/badword/i])])
		expect(ps.evaluate({ requestContent: 'hello world' })).toEqual([])
	})

	it('denies blocked content', () => {
		const ps = createPolicySet([contentPolicy([/badword/i])])
		const denials = ps.evaluate({ requestContent: 'this contains badword' })
		expect(denials).toHaveLength(1)
	})
})

describe('policyMiddleware', () => {
	it('creates valid middleware', () => {
		const ps = createPolicySet([])
		const mw = policyMiddleware(ps)
		expect(typeof mw).toBe('function')
	})
})
