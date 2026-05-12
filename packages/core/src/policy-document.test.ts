import { describe, expect, it } from 'vitest'
import { ElsiumError } from './errors'
import {
	type AuthorizationRequest,
	type ConditionExpression,
	type PolicyBundle,
	type PolicyDocument,
	type SubjectSelector,
	createBuiltinEvaluator,
	createDeclarativePolicySet,
	declarativePolicyMiddleware,
	verifyBundle,
} from './policy-document'

function doc(name: string, spec: PolicyDocument['spec']): PolicyDocument {
	return {
		apiVersion: 'elsium.policy/v1',
		kind: 'Policy',
		metadata: { name },
		spec,
	}
}

function bundle(
	documents: PolicyDocument[],
	defaultEffect: 'allow' | 'deny' = 'deny',
): PolicyBundle {
	return { apiVersion: 'elsium.policy/v1', documents, defaultEffect }
}

const tenantPrincipal: AuthorizationRequest['principal'] = { type: 'tenant', id: 'acme' }
const userPrincipal: AuthorizationRequest['principal'] = { type: 'user', id: 'alice' }

const modelUseAction: AuthorizationRequest['action'] = {
	type: 'model:use',
	target: 'claude-sonnet-4-6',
}

// ─── Built-in evaluator ─────────────────────────────────────────

describe('createBuiltinEvaluator — decision rules', () => {
	const ev = createBuiltinEvaluator()

	it('returns defaultEffect when no policy matches', () => {
		const result = ev.evaluate(bundle([], 'deny'), {
			principal: tenantPrincipal,
			action: modelUseAction,
		})
		expect(result.decision).toBe('deny')
		expect(result.reason).toMatch(/defaultEffect=deny/)

		const resultAllow = ev.evaluate(bundle([], 'allow'), {
			principal: tenantPrincipal,
			action: modelUseAction,
		})
		expect(resultAllow.decision).toBe('allow')
	})

	it('allow policy grants access when matched', () => {
		const b = bundle([
			doc('allow-acme', {
				effect: 'allow',
				subjects: [{ type: 'tenant', match: 'acme' }],
				actions: [{ type: 'model:use' }],
			}),
		])
		const r = ev.evaluate(b, { principal: tenantPrincipal, action: modelUseAction })
		expect(r.decision).toBe('allow')
		expect(r.matchedPolicy).toBe('allow-acme')
	})

	it('deny policy overrides allow regardless of priority', () => {
		const b = bundle(
			[
				doc('allow-everything', {
					effect: 'allow',
					actions: [{ type: 'model:use' }],
					priority: 100,
				}),
				doc('deny-acme', {
					effect: 'deny',
					subjects: [{ type: 'tenant', match: 'acme' }],
					actions: [{ type: 'model:use' }],
					priority: 1,
				}),
			],
			'allow',
		)
		const r = ev.evaluate(b, { principal: tenantPrincipal, action: modelUseAction })
		expect(r.decision).toBe('deny')
		expect(r.matchedPolicy).toBe('deny-acme')
	})

	it('higher priority allow wins between two matching allow policies', () => {
		const b = bundle(
			[
				doc('allow-low', {
					effect: 'allow',
					actions: [{ type: 'model:use' }],
					priority: 1,
				}),
				doc('allow-high', {
					effect: 'allow',
					actions: [{ type: 'model:use' }],
					priority: 10,
				}),
			],
			'deny',
		)
		const r = ev.evaluate(b, { principal: tenantPrincipal, action: modelUseAction })
		expect(r.matchedPolicy).toBe('allow-high')
	})

	it('subject matching: missing selectors = match-all', () => {
		const b = bundle([
			doc('allow-all-subjects', {
				effect: 'allow',
				actions: [{ type: 'model:use' }],
			}),
		])
		const r = ev.evaluate(b, { principal: userPrincipal, action: modelUseAction })
		expect(r.decision).toBe('allow')
	})

	it('subject matching: principal.type must equal selector.type', () => {
		const b = bundle([
			doc('only-tenants', {
				effect: 'allow',
				subjects: [{ type: 'tenant', match: 'alice' }],
				actions: [{ type: 'model:use' }],
			}),
		])
		const r = ev.evaluate(b, { principal: { type: 'user', id: 'alice' }, action: modelUseAction })
		expect(r.decision).toBe('deny') // default
	})

	it('subject in-list match', () => {
		const subj: SubjectSelector = { type: 'tenant', match: { in: ['acme', 'globex'] } }
		const b = bundle([
			doc('allow-listed', { effect: 'allow', subjects: [subj], actions: [{ type: 'model:use' }] }),
		])
		expect(ev.evaluate(b, { principal: tenantPrincipal, action: modelUseAction }).decision).toBe(
			'allow',
		)
		expect(
			ev.evaluate(b, { principal: { type: 'tenant', id: 'other' }, action: modelUseAction })
				.decision,
		).toBe('deny')
	})

	it('subject regex match', () => {
		const subj: SubjectSelector = { type: 'tenant', match: { regex: '^acme-.*$' } }
		const b = bundle([
			doc('acme-anything', {
				effect: 'allow',
				subjects: [subj],
				actions: [{ type: 'model:use' }],
			}),
		])
		expect(
			ev.evaluate(b, { principal: { type: 'tenant', id: 'acme-eu' }, action: modelUseAction })
				.decision,
		).toBe('allow')
		expect(
			ev.evaluate(b, { principal: { type: 'tenant', id: 'globex' }, action: modelUseAction })
				.decision,
		).toBe('deny')
	})

	it('action target match — exact', () => {
		const b = bundle([
			doc('only-haiku', {
				effect: 'allow',
				actions: [{ type: 'model:use', target: 'claude-haiku-4-5-20251001' }],
			}),
		])
		expect(
			ev.evaluate(b, {
				principal: tenantPrincipal,
				action: { type: 'model:use', target: 'claude-haiku-4-5-20251001' },
			}).decision,
		).toBe('allow')
		expect(ev.evaluate(b, { principal: tenantPrincipal, action: modelUseAction }).decision).toBe(
			'deny',
		)
	})

	it('resource id required when selectors are non-empty', () => {
		const b = bundle([
			doc('only-paid-models', {
				effect: 'allow',
				actions: [{ type: 'model:use' }],
				resources: [{ kind: 'model', id: { in: ['gpt-5', 'claude-opus-4-6'] } }],
			}),
		])
		expect(
			ev.evaluate(b, {
				principal: tenantPrincipal,
				action: modelUseAction,
				resource: { kind: 'model', id: 'gpt-5' },
			}).decision,
		).toBe('allow')

		expect(
			ev.evaluate(b, {
				principal: tenantPrincipal,
				action: modelUseAction,
				resource: { kind: 'model', id: 'gpt-4o-mini' },
			}).decision,
		).toBe('deny')

		// No resource provided — selectors are non-empty → no match → deny default
		expect(ev.evaluate(b, { principal: tenantPrincipal, action: modelUseAction }).decision).toBe(
			'deny',
		)
	})
})

// ─── The 8 condition operators ──────────────────────────────────

describe('condition operators (the 8)', () => {
	const ev = createBuiltinEvaluator()

	function evalWhen(when: ConditionExpression, ctx: Record<string, string | number | boolean>) {
		const b = bundle([
			doc('conditional', {
				effect: 'allow',
				actions: [{ type: 'model:use' }],
				when,
			}),
		])
		return ev.evaluate(b, { principal: tenantPrincipal, action: modelUseAction, context: ctx })
			.decision
	}

	it('eq', () => {
		expect(evalWhen({ op: 'eq', field: 'tier', value: 'paid' }, { tier: 'paid' })).toBe('allow')
		expect(evalWhen({ op: 'eq', field: 'tier', value: 'paid' }, { tier: 'free' })).toBe('deny')
	})

	it('ne', () => {
		expect(evalWhen({ op: 'ne', field: 'tier', value: 'free' }, { tier: 'paid' })).toBe('allow')
		expect(evalWhen({ op: 'ne', field: 'tier', value: 'free' }, { tier: 'free' })).toBe('deny')
	})

	it('gt / lt / gte / lte', () => {
		expect(evalWhen({ op: 'gt', field: 'cost', value: 0.1 }, { cost: 0.5 })).toBe('allow')
		expect(evalWhen({ op: 'gt', field: 'cost', value: 0.1 }, { cost: 0.05 })).toBe('deny')
		expect(evalWhen({ op: 'lt', field: 'cost', value: 0.1 }, { cost: 0.05 })).toBe('allow')
		expect(evalWhen({ op: 'gte', field: 'cost', value: 0.1 }, { cost: 0.1 })).toBe('allow')
		expect(evalWhen({ op: 'lte', field: 'cost', value: 0.1 }, { cost: 0.1 })).toBe('allow')
	})

	it('in (numeric or string)', () => {
		expect(evalWhen({ op: 'in', field: 'region', values: ['eu', 'us'] }, { region: 'eu' })).toBe(
			'allow',
		)
		expect(evalWhen({ op: 'in', field: 'region', values: ['eu', 'us'] }, { region: 'asia' })).toBe(
			'deny',
		)
	})

	it('matches (regex on string fields only)', () => {
		expect(
			evalWhen({ op: 'matches', field: 'model', regex: '^claude-' }, { model: 'claude-opus' }),
		).toBe('allow')
		expect(evalWhen({ op: 'matches', field: 'model', regex: '^claude-' }, { model: 'gpt-5' })).toBe(
			'deny',
		)
	})

	it('numeric op on non-numeric field returns false (defensive)', () => {
		expect(evalWhen({ op: 'gt', field: 'tier', value: 1 }, { tier: 'paid' })).toBe('deny')
	})

	it('missing field in context returns false (defensive)', () => {
		expect(evalWhen({ op: 'eq', field: 'missing', value: 1 }, { other: 1 })).toBe('deny')
	})

	it('matches op on non-string returns false', () => {
		expect(evalWhen({ op: 'matches', field: 'cost', regex: '\\d+' }, { cost: 0.5 })).toBe('deny')
	})

	it('invalid regex in matches returns false (no throw)', () => {
		expect(evalWhen({ op: 'matches', field: 'model', regex: '[invalid' }, { model: 'x' })).toBe(
			'deny',
		)
	})
})

// ─── Bundle verification ────────────────────────────────────────

describe('verifyBundle', () => {
	it('flags duplicate policy names as error', () => {
		const b = bundle([
			doc('dup', { effect: 'allow', actions: [{ type: 'model:use' }] }),
			doc('dup', { effect: 'deny', actions: [{ type: 'tool:call' }] }),
		])
		const issues = verifyBundle(b)
		expect(issues.some((i) => i.severity === 'error' && i.issue.includes('Duplicate'))).toBe(true)
	})

	it('flags empty actions array as error', () => {
		const b = bundle([doc('no-actions', { effect: 'allow', actions: [] })])
		const issues = verifyBundle(b)
		expect(
			issues.some((i) => i.document === 'no-actions' && i.issue.includes('at least one')),
		).toBe(true)
	})

	it('warns on non-anchored regex', () => {
		const b = bundle([
			doc('regex-loose', {
				effect: 'allow',
				subjects: [{ type: 'tenant', match: { regex: 'foo' } }],
				actions: [{ type: 'model:use' }],
			}),
		])
		const issues = verifyBundle(b)
		expect(issues.some((i) => i.severity === 'warning' && i.issue.includes('not anchored'))).toBe(
			true,
		)
	})

	it('errors on invalid regex syntax', () => {
		const b = bundle([
			doc('regex-broken', {
				effect: 'allow',
				subjects: [{ type: 'tenant', match: { regex: '^[invalid' } }],
				actions: [{ type: 'model:use' }],
			}),
		])
		const issues = verifyBundle(b)
		expect(issues.some((i) => i.severity === 'error' && i.issue.includes('invalid regex'))).toBe(
			true,
		)
	})

	it('passes a clean bundle silently', () => {
		const b = bundle([
			doc('clean', {
				effect: 'allow',
				subjects: [{ type: 'tenant', match: { regex: '^acme$' } }],
				actions: [{ type: 'model:use' }],
			}),
		])
		const issues = verifyBundle(b)
		expect(issues).toHaveLength(0)
	})
})

// ─── DeclarativePolicySet façade ────────────────────────────────

describe('createDeclarativePolicySet', () => {
	it('strict mode throws on error-level issues at construction', () => {
		const b = bundle([doc('bad', { effect: 'allow', actions: [] })])
		expect(() => createDeclarativePolicySet({ bundle: b })).toThrow(ElsiumError)
	})

	it('non-strict mode accepts bundle with warnings only', () => {
		const b = bundle([
			doc('lax', {
				effect: 'allow',
				subjects: [{ type: 'tenant', match: { regex: 'unanchored' } }],
				actions: [{ type: 'model:use' }],
			}),
		])
		expect(() => createDeclarativePolicySet({ bundle: b, strict: false })).not.toThrow()
	})

	it('load() replaces the bundle and re-validates', () => {
		const okBundle = bundle([doc('ok', { effect: 'allow', actions: [{ type: 'model:use' }] })])
		const set = createDeclarativePolicySet({ bundle: okBundle })

		const badBundle = bundle([doc('bad', { effect: 'allow', actions: [] })])
		expect(() => set.load(badBundle)).toThrow(ElsiumError)
	})

	it('exportBundle returns a defensive copy', () => {
		const b = bundle([doc('only', { effect: 'allow', actions: [{ type: 'model:use' }] })])
		const set = createDeclarativePolicySet({ bundle: b })
		const exported = set.exportBundle()
		expect(exported.documents).toHaveLength(1)
		expect(exported.documents).not.toBe(b.documents) // copy
	})

	it('verify(otherBundle) checks an external bundle without loading it', () => {
		const set = createDeclarativePolicySet({
			bundle: bundle([doc('ok', { effect: 'allow', actions: [{ type: 'model:use' }] })]),
		})
		const issues = set.verify(bundle([doc('bad', { effect: 'allow', actions: [] })]))
		expect(issues.some((i) => i.severity === 'error')).toBe(true)
	})

	it('evaluatorName surfaces the strategy name', () => {
		const set = createDeclarativePolicySet({
			bundle: bundle([doc('a', { effect: 'allow', actions: [{ type: 'model:use' }] })]),
		})
		expect(set.evaluatorName).toBe('builtin')
	})
})

// ─── Custom evaluator (Strategy port works) ─────────────────────

describe('PolicyEvaluator is swappable (Strategy pattern)', () => {
	it('custom evaluator replaces builtin without breaking the set', () => {
		const customEv = {
			name: 'always-allow' as const,
			evaluate: () => ({ decision: 'allow' as const, reason: 'custom evaluator' }),
		}
		const set = createDeclarativePolicySet({
			bundle: bundle([doc('would-deny', { effect: 'deny', actions: [{ type: 'model:use' }] })]),
			evaluator: customEv,
		})
		const r = set.evaluate({ principal: tenantPrincipal, action: modelUseAction })
		expect(r.decision).toBe('allow')
	})
})

// ─── Middleware adapter ─────────────────────────────────────────

describe('declarativePolicyMiddleware', () => {
	function makeCtx(overrides: Partial<import('./types').MiddlewareContext> = {}) {
		return {
			request: { messages: [{ role: 'user' as const, content: 'hi' }] },
			provider: 'anthropic',
			model: 'claude-sonnet-4-6',
			traceId: 'trc',
			startTime: performance.now(),
			metadata: {},
			...overrides,
		}
	}

	it('throws when policy denies', async () => {
		const set = createDeclarativePolicySet({
			bundle: bundle(
				[
					doc('deny-acme', {
						effect: 'deny',
						subjects: [{ type: 'tenant', match: 'acme' }],
						actions: [{ type: 'model:use' }],
					}),
				],
				'allow',
			),
		})
		const mw = declarativePolicyMiddleware({
			policySet: set,
			deriveAction: (ctx) => ({ type: 'model:use', target: ctx.model }),
		})

		await expect(
			mw(makeCtx({ tenant: { tenantId: 'acme' } }), async () => {
				throw new Error('should not reach')
			}),
		).rejects.toThrow(/Policy denied/)
	})

	it('passes through when policy allows', async () => {
		const set = createDeclarativePolicySet({
			bundle: bundle([doc('allow-all', { effect: 'allow', actions: [{ type: 'model:use' }] })]),
		})
		const mw = declarativePolicyMiddleware({
			policySet: set,
			deriveAction: () => ({ type: 'model:use' }),
		})

		const resp = { sentinel: true }
		const ran = await mw(makeCtx(), async () => resp as never)
		expect(ran).toBe(resp)
	})

	it('default principal derivation: tenant > user > agent > anonymous', async () => {
		const set = createDeclarativePolicySet({
			bundle: bundle(
				[
					doc('deny-anonymous', {
						effect: 'deny',
						subjects: [{ type: 'role', match: 'anonymous' }],
						actions: [{ type: 'model:use' }],
					}),
				],
				'allow',
			),
		})
		const mw = declarativePolicyMiddleware({
			policySet: set,
			deriveAction: () => ({ type: 'model:use' }),
		})

		// No tenant, no user, no agent → anonymous → denied
		await expect(mw(makeCtx(), async () => 'x' as never)).rejects.toThrow(/denied/)

		// With tenant → not anonymous → allowed
		await expect(
			mw(makeCtx({ tenant: { tenantId: 'acme' } }), async () => 'ok' as never),
		).resolves.toBe('ok')
	})
})
