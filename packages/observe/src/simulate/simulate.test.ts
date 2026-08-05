import { createFlowPolicy, createLabel, lethalTrifectaRule } from '@elsium-ai/core'
import { describe, expect, it } from 'vitest'
import type { ExecutionProof, ProofEvent, ProofEventType } from '../proof/types'
import { flowPolicyProbe } from './flow-probe'
import { comparePolicies, formatComparison, formatSimulation, simulatePolicy } from './simulate'
import type { PolicyProbe } from './types'

let sequence = 0

function event(type: ProofEventType, data: Record<string, unknown>): ProofEvent {
	sequence += 1
	return { sequence, type, timestamp: 0, data, hashPrev: '0', hashSelf: `h${sequence}` }
}

function trace(proofId: string, events: ProofEvent[]): ExecutionProof {
	sequence = 0
	return {
		version: 'elsium-proof/v1',
		proofId,
		agentId: 'assistant',
		startedAt: '2026-01-01T00:00:00.000Z',
		endedAt: '2026-01-01T00:00:01.000Z',
		events,
		chainHead: 'head',
		signature: { algorithm: 'Ed25519', keyId: 'k1', value: 'sig' },
	}
}

/**
 * A benign run: retrieval and a model call, no egress tool.
 *
 * Deliberately toolless. `lethalTrifectaRule()` covers `tool:*`, so once a
 * secret and untrusted content are both in context it blocks *every* tool,
 * read-only ones included — see the scope test below.
 */
function benignTrace(id: string): ExecutionProof {
	sequence = 0
	return trace(id, [
		event('rag.retrieve', { docs: [{ id: 'kb-1' }] }),
		event('llm.call', { provider: 'anthropic', model: 'claude-sonnet-4-6' }),
	])
}

/** The dangerous shape: a poisoned document followed by an outbound tool. */
function exfilTrace(id: string): ExecutionProof {
	sequence = 0
	return trace(id, [
		event('rag.retrieve', { docs: [{ id: 'invoice-882' }] }),
		event('llm.call', { provider: 'anthropic', model: 'claude-sonnet-4-6' }),
		event('tool.call', { tool: 'send_email' }),
	])
}

describe('simulatePolicy', () => {
	const probe = flowPolicyProbe({
		policy: createFlowPolicy([lethalTrifectaRule()]),
		// The agent holds a credential before it reads anything.
		initial: createLabel({ classes: ['secret'], origin: 'trusted', source: 'vault' }),
	})

	it('reports what a policy would have decided over recorded runs', () => {
		const result = simulatePolicy([benignTrace('t1'), exfilTrace('t2')], probe)

		expect(result.traces).toBe(2)
		expect(result.evaluated).toBeGreaterThan(0)
		expect(result.denied).toBeGreaterThan(0)
		expect(result.allowed + result.denied).toBe(result.evaluated)
	})

	it('names the offending run and rule', () => {
		const result = simulatePolicy([benignTrace('clean'), exfilTrace('poisoned')], probe)
		const denial = result.denials.find((d) => d.subject === 'tool:send_email')

		expect(denial).toBeDefined()
		expect(denial?.traceId).toBe('poisoned')
		expect(denial?.rule).toBe('lethal-trifecta')
	})

	it('counts affected runs, not just decisions', () => {
		const result = simulatePolicy(
			[benignTrace('a'), exfilTrace('b'), exfilTrace('c'), benignTrace('d')],
			probe,
		)

		expect(result.affectedTraces).toEqual(['b', 'c'])
		expect(result.affectedTraceRatio).toBe(0.5)
	})

	it('groups denials by rule', () => {
		const result = simulatePolicy([exfilTrace('x'), exfilTrace('y')], probe)
		expect(result.byRule['lethal-trifecta']).toBeGreaterThanOrEqual(2)
	})

	it('reports a clean plan when nothing is affected', () => {
		const result = simulatePolicy([benignTrace('a'), benignTrace('b')], probe)
		expect(result.denied).toBe(0)
		expect(result.affectedTraces).toEqual([])
		expect(result.affectedTraceRatio).toBe(0)
	})

	it('handles an empty corpus without dividing by zero', () => {
		const result = simulatePolicy([], probe)
		expect(result).toMatchObject({ traces: 0, evaluated: 0, denied: 0, affectedTraceRatio: 0 })
	})

	it('surfaces an over-broad rule — the reason this tool exists', () => {
		// `lethalTrifectaRule()` covers `tool:*`, so once the trifecta completes
		// it blocks read-only tools too. That is defensible (any tool can be an
		// egress channel) but rarely what an operator intends, and shipping it
		// blind would break every run. Simulation says so before that happens.
		sequence = 0
		const readOnlyRun = trace('read-only', [
			event('rag.retrieve', { docs: [{ id: 'kb-1' }] }),
			event('tool.call', { tool: 'lookup_order' }),
		])

		const broad = simulatePolicy([readOnlyRun], probe)
		expect(broad.affectedTraceRatio).toBe(1)
		expect(broad.denials[0].subject).toBe('tool:lookup_order')

		// Narrowing the sinks to genuine egress leaves the run untouched.
		const narrowed = simulatePolicy(
			[readOnlyRun],
			flowPolicyProbe({
				policy: createFlowPolicy([lethalTrifectaRule({ sinks: ['network:*', 'tool:send_*'] })]),
				initial: createLabel({ classes: ['secret'], origin: 'trusted', source: 'vault' }),
			}),
		)
		expect(narrowed.denied).toBe(0)
	})
})

describe('flowPolicyProbe', () => {
	it('checks a tool before its own output taints the context', () => {
		// Without a pre-existing secret the trifecta cannot complete, so a tool
		// that merely returns untrusted data must not deny itself.
		const probe = flowPolicyProbe({ policy: createFlowPolicy([lethalTrifectaRule()]) })
		const result = simulatePolicy([exfilTrace('t')], probe)

		expect(result.denied).toBe(0)
	})

	it('accumulates provenance across the run', () => {
		const probe = flowPolicyProbe({
			policy: createFlowPolicy([
				{ name: 'no-untrusted-egress', sink: 'tool:*', deny: { origin: ['untrusted'] } },
			]),
		})

		sequence = 0
		const t = trace('t', [
			event('tool.call', { tool: 'first' }), // clean context — allowed
			event('rag.retrieve', { docs: [{ id: 'd1' }] }), // context becomes untrusted
			event('tool.call', { tool: 'second' }), // now denied
		])

		const result = simulatePolicy([t], probe)
		expect(result.denials.map((d) => d.subject)).toEqual(['tool:second'])
	})

	it('lets a classifier assign sensitivity the proof cannot carry', () => {
		const probe = flowPolicyProbe({
			policy: createFlowPolicy([
				{ name: 'no-pii-to-openai', sink: 'llm:openai', deny: { hasClasses: ['pii'] } },
			]),
			classify: (e) =>
				e.type === 'rag.retrieve' ? { classes: ['pii'], origin: 'untrusted' } : undefined,
		})

		sequence = 0
		const t = trace('t', [
			event('rag.retrieve', { docs: [{ id: 'customers' }] }),
			event('llm.call', { provider: 'openai' }),
		])

		const result = simulatePolicy([t], probe)
		expect(result.denials[0]?.subject).toBe('llm:openai')
	})

	it('records document ids as provenance for audit', () => {
		const probe = flowPolicyProbe({
			policy: createFlowPolicy([
				{ name: 'block-all-tools', sink: 'tool:*', deny: { origin: ['untrusted'] } },
			]),
		})

		sequence = 0
		const t = trace('t', [
			event('rag.retrieve', { docs: [{ id: 'invoice-882' }, { id: 'kb-3' }] }),
			event('tool.call', { tool: 'send_email' }),
		])

		expect(simulatePolicy([t], probe).denied).toBe(1)
	})

	it('ignores events that are not egress points', () => {
		const probe = flowPolicyProbe({
			policy: createFlowPolicy([{ name: 'all', sink: '*', deny: { origin: ['untrusted'] } }]),
		})

		sequence = 0
		const t = trace('t', [
			event('policy.evaluated', { rule: 'x', result: 'allow' }),
			event('custom', { note: 'checkpoint' }),
		])

		expect(simulatePolicy([t], probe).evaluated).toBe(0)
	})
})

describe('comparePolicies', () => {
	const permissive: PolicyProbe = flowPolicyProbe({
		policy: createFlowPolicy([
			{ name: 'nothing-matches', sink: 'never:*', deny: { origin: ['untrusted'] } },
		]),
	})

	const strict: PolicyProbe = flowPolicyProbe({
		policy: createFlowPolicy([lethalTrifectaRule()]),
		initial: createLabel({ classes: ['secret'], origin: 'trusted', source: 'vault' }),
	})

	it('reports what tightening a policy would newly block', () => {
		const result = comparePolicies([benignTrace('a'), exfilTrace('b')], {
			baseline: permissive,
			candidate: strict,
		})

		expect(result.newlyDenied.length).toBeGreaterThan(0)
		expect(result.newlyAllowed).toEqual([])
		expect(result.newlyDenied.some((d) => d.traceId === 'b')).toBe(true)
	})

	it('reports relaxations too — a control quietly disappearing', () => {
		const result = comparePolicies([exfilTrace('b')], {
			baseline: strict,
			candidate: permissive,
		})

		expect(result.newlyAllowed.length).toBeGreaterThan(0)
		expect(result.newlyDenied).toEqual([])
	})

	it('reports no change for identical policies', () => {
		const result = comparePolicies([benignTrace('a'), exfilTrace('b')], {
			baseline: strict,
			candidate: strict,
		})

		expect(result.newlyDenied).toEqual([])
		expect(result.newlyAllowed).toEqual([])
		expect(result.unchanged).toBe(result.candidate.evaluated)
	})

	it('exposes both sides for reporting', () => {
		const result = comparePolicies([exfilTrace('b')], {
			baseline: permissive,
			candidate: strict,
		})

		expect(result.baseline.denied).toBe(0)
		expect(result.candidate.denied).toBeGreaterThan(0)
	})
})

describe('formatting', () => {
	const probe = flowPolicyProbe({
		policy: createFlowPolicy([lethalTrifectaRule()]),
		initial: createLabel({ classes: ['secret'], origin: 'trusted' }),
	})

	it('summarises a plan with the affected ratio', () => {
		const output = formatSimulation(simulatePolicy([benignTrace('a'), exfilTrace('b')], probe))

		expect(output).toMatch(/decision point/)
		expect(output).toMatch(/1 of 2 run\(s\) affected \(50\.00%\)/)
		expect(output).toMatch(/lethal-trifecta/)
	})

	it('says so plainly when nothing is affected', () => {
		const output = formatSimulation(simulatePolicy([benignTrace('a')], probe))
		expect(output).toMatch(/No run would have been affected/)
	})

	it('renders a plan-style diff', () => {
		const permissive = flowPolicyProbe({
			policy: createFlowPolicy([{ name: 'none', sink: 'never:*', deny: { origin: ['model'] } }]),
		})
		const output = formatComparison(
			comparePolicies([exfilTrace('b')], { baseline: permissive, candidate: probe }),
		)

		expect(output).toMatch(/newly denied/)
		expect(output).toMatch(/Would now be BLOCKED/)
	})

	it('flags relaxations as a control being loosened', () => {
		const permissive = flowPolicyProbe({
			policy: createFlowPolicy([{ name: 'none', sink: 'never:*', deny: { origin: ['model'] } }]),
		})
		const output = formatComparison(
			comparePolicies([exfilTrace('b')], { baseline: probe, candidate: permissive }),
		)

		expect(output).toMatch(/control relaxed/)
	})
})
