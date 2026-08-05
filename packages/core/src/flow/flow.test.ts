import { describe, expect, it, vi } from 'vitest'
import {
	createLabel,
	declassify,
	dominates,
	emptyLabel,
	formatLabel,
	joinAll,
	joinLabels,
	taint,
} from './label'
import { createFlowPolicy, lethalTrifectaRule } from './policy'
import { createFlowTracker } from './tracker'

describe('labels', () => {
	it('defaults to untrusted — safety by omission', () => {
		expect(createLabel().origin).toBe('untrusted')
	})

	it('normalizes classes and sources deterministically', () => {
		const label = createLabel({ classes: ['pii', 'secret', 'pii'], sources: ['b', 'a'] })
		expect(label.classes).toEqual(['pii', 'secret'])
		expect(label.sources).toEqual(['a', 'b'])
	})

	it('joins to the least trusted origin', () => {
		const trusted = createLabel({ origin: 'trusted' })
		const model = createLabel({ origin: 'model' })
		const untrusted = createLabel({ origin: 'untrusted' })

		expect(joinLabels(trusted, model).origin).toBe('model')
		expect(joinLabels(model, untrusted).origin).toBe('untrusted')
		expect(joinLabels(untrusted, trusted).origin).toBe('untrusted')
	})

	it('unions classes and sources on join', () => {
		const a = createLabel({ classes: ['secret'], source: 'vault' })
		const b = createLabel({ classes: ['pii'], source: 'crm' })
		const joined = joinLabels(a, b)

		expect(joined.classes).toEqual(['pii', 'secret'])
		expect(joined.sources).toEqual(['crm', 'vault'])
	})

	it('is commutative and associative', () => {
		const a = createLabel({ classes: ['secret'], origin: 'trusted', source: 'a' })
		const b = createLabel({ classes: ['pii'], origin: 'model', source: 'b' })
		const c = createLabel({ classes: ['phi'], origin: 'untrusted', source: 'c' })

		expect(joinLabels(a, b)).toEqual(joinLabels(b, a))
		expect(joinLabels(joinLabels(a, b), c)).toEqual(joinLabels(a, joinLabels(b, c)))
	})

	it('is idempotent — re-recording the same data changes nothing', () => {
		const a = createLabel({ classes: ['secret'], origin: 'model', source: 'x' })
		expect(joinLabels(a, a)).toEqual(a)
	})

	it('never weakens a label — the property the guarantee rests on', () => {
		const start = createLabel({ classes: ['secret'], origin: 'untrusted', source: 's' })
		const additions = [
			createLabel({ origin: 'trusted' }),
			createLabel({ classes: [], origin: 'model' }),
			emptyLabel(),
		]

		for (const addition of additions) {
			const joined = joinLabels(start, addition)
			expect(dominates(joined, start)).toBe(true)
		}
	})

	it('treats the empty label as the identity element', () => {
		const a = createLabel({ classes: ['secret'], origin: 'model', source: 'x' })
		expect(joinLabels(a, emptyLabel())).toEqual(a)
		expect(joinAll([])).toEqual(emptyLabel())
	})

	it('attaches provenance to a value with taint()', () => {
		const t = taint({ ssn: '123' }, { classes: ['pii'], source: 'crm' })
		expect(t.value).toEqual({ ssn: '123' })
		expect(t.label.classes).toEqual(['pii'])
	})

	it('records who declassified and why', () => {
		const secret = taint('data', { classes: ['secret'], origin: 'untrusted' })
		const cleared = declassify(secret, {
			to: { classes: [], origin: 'trusted' },
			reason: 'reviewed by compliance',
			by: 'analyst-7',
		})

		expect(cleared.label.origin).toBe('trusted')
		expect(cleared.label.classes).toEqual([])
		expect(cleared.label.sources).toContain('declassified-by:analyst-7')
	})

	it('formats readably for denial messages', () => {
		expect(formatLabel(createLabel({ classes: ['secret'], source: 'vault' }))).toBe(
			'origin=untrusted classes=[secret] from vault',
		)
	})
})

describe('flow policy', () => {
	const policy = createFlowPolicy([
		{
			name: 'no-secrets-outbound',
			sink: 'network:*',
			deny: { hasAnyClass: ['secret'] },
			reason: 'secrets must not leave the process',
		},
		{
			name: 'eu-data-stays-in-eu',
			sink: ['llm:openai', 'llm:anthropic-us'],
			deny: { hasClasses: ['pii:eu'] },
		},
	])

	it('allows a flow no rule matches', () => {
		const decision = policy.check('llm:anthropic-eu', createLabel({ classes: ['pii:eu'] }))
		expect(decision.allowed).toBe(true)
	})

	it('denies and names the rule', () => {
		const decision = policy.check('network:evil.com', createLabel({ classes: ['secret'] }))
		expect(decision.allowed).toBe(false)
		expect(decision.rule).toBe('no-secrets-outbound')
		expect(decision.reason).toMatch(/secrets must not leave/)
	})

	it('matches sink globs', () => {
		expect(policy.check('network:a.com', createLabel({ classes: ['secret'] })).allowed).toBe(false)
		expect(policy.check('network:b.org', createLabel({ classes: ['secret'] })).allowed).toBe(false)
		expect(policy.check('tool:local', createLabel({ classes: ['secret'] })).allowed).toBe(true)
	})

	it('supports multiple sinks per rule', () => {
		const label = createLabel({ classes: ['pii:eu'] })
		expect(policy.check('llm:openai', label).allowed).toBe(false)
		expect(policy.check('llm:anthropic-us', label).allowed).toBe(false)
		expect(policy.check('llm:mistral-eu', label).allowed).toBe(true)
	})

	it('requires every class for hasClasses, any for hasAnyClass', () => {
		const strict = createFlowPolicy([
			{ name: 'both', sink: 'x:*', deny: { hasClasses: ['a', 'b'] } },
			{ name: 'either', sink: 'y:*', deny: { hasAnyClass: ['a', 'b'] } },
		])

		expect(strict.check('x:1', createLabel({ classes: ['a'] })).allowed).toBe(true)
		expect(strict.check('x:1', createLabel({ classes: ['a', 'b'] })).allowed).toBe(false)
		expect(strict.check('y:1', createLabel({ classes: ['a'] })).allowed).toBe(false)
	})

	it('filters on origin', () => {
		const originPolicy = createFlowPolicy([
			{ name: 'no-untrusted-tools', sink: 'tool:*', deny: { origin: ['untrusted'] } },
		])

		expect(originPolicy.check('tool:x', createLabel({ origin: 'trusted' })).allowed).toBe(true)
		expect(originPolicy.check('tool:x', createLabel({ origin: 'model' })).allowed).toBe(true)
		expect(originPolicy.check('tool:x', createLabel({ origin: 'untrusted' })).allowed).toBe(false)
	})

	it('rejects a rule with no conditions rather than denying everything', () => {
		expect(() => createFlowPolicy([{ name: 'oops', sink: '*', deny: {} }])).toThrow(
			/no deny conditions/,
		)
	})

	it('rejects an unnamed rule', () => {
		expect(() =>
			createFlowPolicy([{ name: '', sink: 'x', deny: { origin: ['untrusted'] } }]),
		).toThrow(/requires a name/)
	})

	it('applies the first matching rule', () => {
		const ordered = createFlowPolicy([
			{ name: 'first', sink: 'net:*', deny: { hasAnyClass: ['secret'] } },
			{ name: 'second', sink: 'net:*', deny: { hasAnyClass: ['secret'] } },
		])
		expect(ordered.check('net:x', createLabel({ classes: ['secret'] })).rule).toBe('first')
	})
})

describe('flow tracker', () => {
	const policy = createFlowPolicy([
		{ name: 'no-secret-egress', sink: 'network:*', deny: { hasAnyClass: ['secret'] } },
	])

	it('accumulates labels across a run', () => {
		const tracker = createFlowTracker({ policy })
		tracker.record(createLabel({ classes: ['pii'], origin: 'trusted' }))
		tracker.record(createLabel({ classes: ['secret'], origin: 'untrusted' }))

		expect(tracker.label.classes).toEqual(['pii', 'secret'])
		expect(tracker.label.origin).toBe('untrusted')
	})

	it('unwraps a tainted value and absorbs its label', () => {
		const tracker = createFlowTracker({ policy })
		const value = tracker.unwrap(taint('sk-live-123', { classes: ['secret'] }))

		expect(value).toBe('sk-live-123')
		expect(tracker.label.classes).toContain('secret')
	})

	it('notifies on denial', () => {
		const onDeny = vi.fn()
		const tracker = createFlowTracker({ policy, onDeny })
		tracker.record(createLabel({ classes: ['secret'] }))
		tracker.check('network:evil.com')

		expect(onDeny).toHaveBeenCalledTimes(1)
		expect(onDeny.mock.calls[0][0].rule).toBe('no-secret-egress')
	})

	it('does not notify when allowed', () => {
		const onDeny = vi.fn()
		const tracker = createFlowTracker({ policy, onDeny })
		tracker.check('network:ok.com')
		expect(onDeny).not.toHaveBeenCalled()
	})

	it('resets to its initial label', () => {
		const tracker = createFlowTracker({ policy })
		tracker.record(createLabel({ classes: ['secret'] }))
		tracker.reset()

		expect(tracker.label.classes).toEqual([])
		expect(tracker.check('network:x').allowed).toBe(true)
	})

	it('taint is sticky — a later trusted read cannot clear an earlier one', () => {
		const tracker = createFlowTracker({ policy })
		tracker.record(createLabel({ classes: ['secret'], origin: 'untrusted' }))
		tracker.record(createLabel({ classes: [], origin: 'trusted' }))

		expect(tracker.check('network:x').allowed).toBe(false)
	})
})

describe('lethal trifecta', () => {
	const policy = createFlowPolicy([lethalTrifectaRule()])

	it('allows sensitive data with no untrusted content present', () => {
		const tracker = createFlowTracker({ policy })
		tracker.record(createLabel({ classes: ['secret'], origin: 'trusted', source: 'vault' }))

		expect(tracker.check('tool:send_email').allowed).toBe(true)
	})

	it('allows untrusted content when nothing sensitive is in context', () => {
		const tracker = createFlowTracker({ policy })
		tracker.record(createLabel({ origin: 'untrusted', source: 'doc:poisoned' }))

		expect(tracker.check('tool:send_email').allowed).toBe(true)
	})

	it('blocks once all three are present', () => {
		const tracker = createFlowTracker({ policy })
		tracker.record(createLabel({ classes: ['secret'], origin: 'trusted', source: 'vault' }))
		tracker.record(createLabel({ origin: 'untrusted', source: 'doc:poisoned' }))

		const decision = tracker.check('tool:send_email')
		expect(decision.allowed).toBe(false)
		expect(decision.reason).toMatch(/exfiltration path/)
		expect(decision.label.sources).toEqual(['doc:poisoned', 'vault'])
	})

	it('blocks regardless of the order the three arrive in', () => {
		const tracker = createFlowTracker({ policy })
		tracker.record(createLabel({ origin: 'untrusted', source: 'doc:poisoned' }))
		tracker.record(createLabel({ classes: ['secret'], origin: 'trusted', source: 'vault' }))

		expect(tracker.check('tool:send_email').allowed).toBe(false)
	})

	it('leaves a local sink reachable', () => {
		const tracker = createFlowTracker({ policy })
		tracker.record(createLabel({ classes: ['secret'], origin: 'trusted' }))
		tracker.record(createLabel({ origin: 'untrusted' }))

		expect(tracker.check('log:local').allowed).toBe(true)
	})

	it('accepts a custom sensitivity vocabulary', () => {
		const custom = createFlowPolicy([lethalTrifectaRule({ sensitiveClasses: ['phi'] })])
		const tracker = createFlowTracker({ policy: custom })
		tracker.record(createLabel({ classes: ['phi'], origin: 'trusted' }))
		tracker.record(createLabel({ origin: 'untrusted' }))

		expect(tracker.check('network:x').allowed).toBe(false)
	})
})
