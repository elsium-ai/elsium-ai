import { createPolicySet } from '@elsium-ai/core'
import { describe, expect, it } from 'vitest'
import { runEvalSuite } from './eval'
import {
	type EvalGateConfig,
	buildEvalComplianceReport,
	formatEvalComplianceReport,
	runEvalGate,
	toAttestedGovernance,
} from './eval-policy'

async function suiteWithOutputs(outputs: Record<string, string>) {
	return runEvalSuite({
		name: 'governed suite',
		cases: Object.keys(outputs).map((name) => ({ name, input: name })),
		runner: async (input) => outputs[input],
	})
}

const noPiiAssertion = {
	name: 'no-ssn',
	description: 'Output must not contain an SSN',
	controls: ['eu-ai-act:art-10', 'nist-ai-rmf:measure-2.7'],
	assert: (r: { output: string }) => !/\d{3}-\d{2}-\d{4}/.test(r.output),
}

describe('runEvalGate', () => {
	it('passes when no assertion is violated', async () => {
		const suite = await suiteWithOutputs({ a: 'all clear', b: 'fine' })
		const gate = runEvalGate(suite, { name: 'pii', assertions: [noPiiAssertion] })
		expect(gate.passed).toBe(true)
		expect(gate.violationCount).toBe(0)
		expect(gate.override).toBeUndefined()
	})

	it('flags violations and fails the gate', async () => {
		const suite = await suiteWithOutputs({ a: 'ok', leak: 'SSN 123-45-6789' })
		const gate = runEvalGate(suite, { name: 'pii', assertions: [noPiiAssertion] })
		expect(gate.passed).toBe(false)
		expect(gate.violationCount).toBe(1)
		const failed = gate.cases.find((c) => c.caseName === 'leak')
		expect(failed?.violations[0].assertion).toBe('no-ssn')
		expect(failed?.violations[0].controls).toContain('eu-ai-act:art-10')
	})

	it('records a signed-off override that flips the gate to passed', async () => {
		const suite = await suiteWithOutputs({ leak: 'SSN 123-45-6789' })
		const gate = runEvalGate(
			suite,
			{ name: 'pii', assertions: [noPiiAssertion] },
			{ approver: 'eric', reason: 'test fixture, not real PII', approvedAt: 5 },
		)
		expect(gate.passed).toBe(true)
		expect(gate.violationCount).toBe(1)
		expect(gate.override?.approver).toBe('eric')
		expect(toAttestedGovernance(gate)).toEqual({
			gate: 'pii',
			passed: true,
			violationCount: 1,
			override: { approver: 'eric', reason: 'test fixture, not real PII', approvedAt: 5 },
		})
	})

	it('integrates a core PolicySet, turning denials into violations', async () => {
		const policySet = createPolicySet([
			{
				name: 'no-refusal',
				rules: [
					(ctx) =>
						(ctx.requestContent ?? '').includes('cannot help')
							? { decision: 'deny', reason: 'model refused', policyName: 'no-refusal' }
							: { decision: 'allow', reason: 'ok', policyName: 'no-refusal' },
				],
			},
		])
		const suite = await suiteWithOutputs({ a: 'sure thing', b: 'I cannot help with that' })
		const gate = runEvalGate(suite, { name: 'policy', policySet })
		expect(gate.violationCount).toBe(1)
		expect(gate.cases.find((c) => c.caseName === 'b')?.violations[0].reason).toBe('model refused')
	})
})

describe('buildEvalComplianceReport', () => {
	const config: EvalGateConfig = { name: 'pii', assertions: [noPiiAssertion] }

	it('maps violations to controls and reports non-compliant', async () => {
		const suite = await suiteWithOutputs({ leak: 'SSN 123-45-6789' })
		const gate = runEvalGate(suite, config)
		const report = buildEvalComplianceReport(gate, config, { framework: 'EU AI Act' })
		expect(report.framework).toBe('EU AI Act')
		expect(report.compliant).toBe(false)
		const control = report.controls.find((c) => c.control === 'eu-ai-act:art-10')
		expect(control?.violations).toBe(1)
		expect(control?.assertions).toContain('no-ssn')
		expect(control?.passed).toBe(false)
	})

	it('reports compliant when all mapped controls pass', async () => {
		const suite = await suiteWithOutputs({ a: 'clean' })
		const gate = runEvalGate(suite, config)
		const report = buildEvalComplianceReport(gate, config)
		expect(report.compliant).toBe(true)
		expect(report.controls.every((c) => c.passed)).toBe(true)
		const text = formatEvalComplianceReport(report)
		expect(text).toContain('COMPLIANT')
		expect(text).toContain('eu-ai-act:art-10')
	})

	it('counts violations from unmapped assertions separately', async () => {
		const unmapped = {
			name: 'must-be-json',
			assert: (r: { output: string }) => r.output.startsWith('{'),
		}
		const suite = await suiteWithOutputs({ a: 'plain text' })
		const cfg: EvalGateConfig = { name: 'fmt', assertions: [unmapped] }
		const gate = runEvalGate(suite, cfg)
		const report = buildEvalComplianceReport(gate, cfg)
		expect(report.unmappedViolations).toBe(1)
		expect(report.compliant).toBe(false)
	})
})
