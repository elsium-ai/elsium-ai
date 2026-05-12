import { ElsiumError } from '@elsium-ai/core'
import { describe, expect, it } from 'vitest'
import {
	type RoutingContext,
	type RoutingPolicy,
	type RoutingRule,
	createDeclarativeRouter,
} from './routing-policy'

function policy(
	rules: RoutingRule[],
	def: RoutingPolicy['default'] = { strategy: 'fallback' },
): RoutingPolicy {
	return {
		apiVersion: 'elsium.routing/v1',
		kind: 'RoutingPolicy',
		metadata: { name: 'p' },
		rules,
		default: def,
	}
}

describe('createDeclarativeRouter — basic resolution', () => {
	it('returns default when no rule matches', () => {
		const r = createDeclarativeRouter(policy([]))
		const res = r.resolve({})
		expect(res.target).toEqual({ strategy: 'fallback' })
		expect(res.matchedRule).toBeUndefined()
	})

	it('returns the first rule whose when() matches', () => {
		const r = createDeclarativeRouter(
			policy([
				{
					name: 'enterprise',
					when: { op: 'eq', field: 'tenant', value: 'acme' },
					target: { strategy: 'latency-optimized', model: 'claude-opus-4-6' },
				},
			]),
		)
		const res = r.resolve({ tenant: 'acme' })
		expect(res.matchedRule).toBe('enterprise')
		expect(res.target.model).toBe('claude-opus-4-6')
	})

	it('respects priority — higher priority wins', () => {
		const r = createDeclarativeRouter(
			policy([
				{ name: 'low', target: { model: 'cheap' }, priority: 1 },
				{ name: 'high', target: { model: 'expensive' }, priority: 10 },
			]),
		)
		expect(r.resolve({}).matchedRule).toBe('high')
	})
})

describe('SLO eligibility', () => {
	it('rule is skipped when estimatedCost exceeds maxCost', () => {
		const r = createDeclarativeRouter(
			policy(
				[
					{
						name: 'cheap-bucket',
						slo: { maxCost: 0.01 },
						target: { model: 'cheap' },
					},
				],
				{ model: 'fallback-model' },
			),
		)
		const expensive: RoutingContext = { estimatedCost: 0.5 }
		expect(r.resolve(expensive).target.model).toBe('fallback-model')

		const cheap: RoutingContext = { estimatedCost: 0.005 }
		expect(r.resolve(cheap).matchedRule).toBe('cheap-bucket')
	})

	it('rule is skipped when estimatedLatencyMs exceeds maxLatencyMs', () => {
		const r = createDeclarativeRouter(
			policy(
				[
					{
						name: 'fast-bucket',
						slo: { maxLatencyMs: 100 },
						target: { strategy: 'latency-optimized' },
					},
				],
				{ strategy: 'fallback' },
			),
		)
		expect(r.resolve({ estimatedLatencyMs: 250 }).target.strategy).toBe('fallback')
		expect(r.resolve({ estimatedLatencyMs: 50 }).matchedRule).toBe('fast-bucket')
	})

	it('requireCapabilities ALL must match', () => {
		const r = createDeclarativeRouter(
			policy(
				[
					{
						name: 'tool+vision',
						slo: { requireCapabilities: ['tools', 'vision'] },
						target: { strategy: 'capability-aware' },
					},
				],
				{ strategy: 'fallback' },
			),
		)
		expect(r.resolve({ capabilities: ['tools'] }).target.strategy).toBe('fallback')
		expect(r.resolve({ capabilities: ['tools', 'vision', 'json_mode'] }).matchedRule).toBe(
			'tool+vision',
		)
	})
})

describe('Conditions interplay with metadata', () => {
	it('arbitrary metadata fields are usable in when()', () => {
		const r = createDeclarativeRouter(
			policy(
				[
					{
						name: 'eu',
						when: { op: 'eq', field: 'region', value: 'eu' },
						target: { provider: 'azure' },
					},
				],
				{ provider: 'openai' },
			),
		)
		expect(r.resolve({ metadata: { region: 'eu' } }).target.provider).toBe('azure')
		expect(r.resolve({ metadata: { region: 'us' } }).target.provider).toBe('openai')
	})

	it('combines when() AND slo() — both must hold', () => {
		const r = createDeclarativeRouter(
			policy([
				{
					name: 'tight',
					when: { op: 'eq', field: 'tier', value: 'paid' },
					slo: { maxCost: 0.01 },
					target: { model: 'premium' },
				},
			]),
		)
		// Tier matches but cost too high → not eligible
		expect(r.resolve({ metadata: { tier: 'paid' }, estimatedCost: 1 }).matchedRule).toBeUndefined()
		// Both hold → match
		expect(r.resolve({ metadata: { tier: 'paid' }, estimatedCost: 0.005 }).matchedRule).toBe(
			'tight',
		)
	})
})

describe('verify + loadPolicy', () => {
	it('throws on duplicate rule name at construction', () => {
		expect(() =>
			createDeclarativeRouter(
				policy([
					{ name: 'dup', target: { model: 'a' } },
					{ name: 'dup', target: { model: 'b' } },
				]),
			),
		).toThrow(ElsiumError)
	})

	it('throws on empty target', () => {
		expect(() => createDeclarativeRouter(policy([{ name: 'empty', target: {} }]))).toThrow(/empty/)
	})

	it('throws on invalid regex inside when.matches', () => {
		expect(() =>
			createDeclarativeRouter(
				policy([
					{
						name: 'bad',
						when: { op: 'matches', field: 'model', regex: '^[invalid' },
						target: { model: 'x' },
					},
				]),
			),
		).toThrow(/Invalid regex/)
	})

	it('loadPolicy replaces and re-validates', () => {
		const r = createDeclarativeRouter(policy([{ name: 'a', target: { model: 'x' } }]))
		expect(() => r.loadPolicy(policy([{ name: 'a', target: {} }]))).toThrow(ElsiumError)
	})

	it('verify(other) checks an external policy without loading', () => {
		const r = createDeclarativeRouter(policy([]))
		const issues = r.verify(policy([{ name: 'bad', target: {} }]))
		expect(issues.length).toBeGreaterThan(0)
	})
})

describe('Real-world routing patterns', () => {
	it('cost-aware enterprise routing — cheap for trial tenants, premium for paid', () => {
		const r = createDeclarativeRouter(
			policy(
				[
					{
						name: 'paid-tenants',
						when: { op: 'in', field: 'tier', values: ['gold', 'enterprise'] },
						target: { strategy: 'latency-optimized', model: 'claude-opus-4-6' },
						priority: 10,
					},
					{
						name: 'trial-cap',
						when: { op: 'eq', field: 'tier', value: 'trial' },
						slo: { maxCost: 0.01 },
						target: { model: 'claude-haiku-4-5-20251001' },
						priority: 5,
					},
				],
				{ strategy: 'fallback' },
			),
		)

		expect(r.resolve({ metadata: { tier: 'enterprise' } }).target.model).toBe('claude-opus-4-6')
		expect(r.resolve({ metadata: { tier: 'trial' }, estimatedCost: 0.005 }).target.model).toBe(
			'claude-haiku-4-5-20251001',
		)
		// Trial with too-expensive estimate → fallback default
		expect(
			r.resolve({ metadata: { tier: 'trial' }, estimatedCost: 0.5 }).matchedRule,
		).toBeUndefined()
	})

	it('jurisdiction-aware routing — EU traffic goes to EU-region provider', () => {
		const r = createDeclarativeRouter(
			policy(
				[
					{
						name: 'eu-region',
						when: { op: 'eq', field: 'jurisdiction', value: 'eu' },
						target: { provider: 'azure-eu', model: 'gpt-5' },
					},
				],
				{ provider: 'openai', model: 'gpt-5' },
			),
		)
		expect(r.resolve({ metadata: { jurisdiction: 'eu' } }).target.provider).toBe('azure-eu')
		expect(r.resolve({ metadata: { jurisdiction: 'us' } }).target.provider).toBe('openai')
	})
})
