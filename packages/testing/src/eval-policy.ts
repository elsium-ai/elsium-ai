import type { PolicyContext, PolicySet } from '@elsium-ai/core'
import type { AttestedGovernance, AttestedOverride } from './attestation'
import type { EvalResult, EvalSuiteResult } from './eval'

export interface GovernanceAssertion {
	readonly name: string
	readonly description?: string
	readonly controls?: readonly string[]
	readonly assert: (result: EvalResult) => boolean
}

export interface EvalGateConfig {
	readonly name: string
	readonly assertions?: readonly GovernanceAssertion[]
	readonly policySet?: PolicySet
	readonly contextFor?: (result: EvalResult) => PolicyContext
}

export interface GovernanceViolation {
	readonly assertion: string
	readonly reason: string
	readonly controls: readonly string[]
}

export interface EvalGateCaseResult {
	readonly caseName: string
	readonly passed: boolean
	readonly violations: readonly GovernanceViolation[]
}

export interface EvalGateResult {
	readonly name: string
	readonly passed: boolean
	readonly violationCount: number
	readonly cases: readonly EvalGateCaseResult[]
	readonly override?: AttestedOverride
}

function defaultContextFor(result: EvalResult): PolicyContext {
	return {
		costEstimate: undefined,
		requestContent: result.output,
		metadata: { evalCase: result.name, score: result.score, passed: result.passed },
	}
}

function evaluateCase(result: EvalResult, config: EvalGateConfig): GovernanceViolation[] {
	const violations: GovernanceViolation[] = []

	for (const assertion of config.assertions ?? []) {
		if (!assertion.assert(result)) {
			violations.push({
				assertion: assertion.name,
				reason: assertion.description ?? `Assertion "${assertion.name}" failed`,
				controls: assertion.controls ?? [],
			})
		}
	}

	if (config.policySet) {
		const ctx = (config.contextFor ?? defaultContextFor)(result)
		for (const denial of config.policySet.evaluate(ctx)) {
			violations.push({
				assertion: denial.policyName,
				reason: denial.reason,
				controls: [],
			})
		}
	}

	return violations
}

export function runEvalGate(
	suite: EvalSuiteResult,
	config: EvalGateConfig,
	override?: AttestedOverride,
): EvalGateResult {
	const cases: EvalGateCaseResult[] = suite.results.map((result) => {
		const violations = evaluateCase(result, config)
		return {
			caseName: result.name,
			passed: violations.length === 0,
			violations,
		}
	})

	const violationCount = cases.reduce((sum, c) => sum + c.violations.length, 0)
	const clean = violationCount === 0

	return {
		name: config.name,
		passed: clean || override !== undefined,
		violationCount,
		cases,
		override: clean ? undefined : override,
	}
}

export function toAttestedGovernance(gate: EvalGateResult): AttestedGovernance {
	return {
		gate: gate.name,
		passed: gate.passed,
		violationCount: gate.violationCount,
		override: gate.override,
	}
}

export interface EvalComplianceControlResult {
	readonly control: string
	readonly assertions: readonly string[]
	readonly violations: number
	readonly passed: boolean
}

export interface EvalComplianceReport {
	readonly framework?: string
	readonly compliant: boolean
	readonly controls: readonly EvalComplianceControlResult[]
	readonly unmappedViolations: number
}

export interface EvalComplianceReportOptions {
	readonly framework?: string
	readonly controls?: readonly string[]
}

function mapAssertionsToControls(config: EvalGateConfig): Map<string, Set<string>> {
	const mapped = new Map<string, Set<string>>()
	for (const assertion of config.assertions ?? []) {
		for (const control of assertion.controls ?? []) {
			const set = mapped.get(control) ?? new Set<string>()
			set.add(assertion.name)
			mapped.set(control, set)
		}
	}
	return mapped
}

function countViolations(gate: EvalGateResult): {
	byControl: Map<string, number>
	unmapped: number
} {
	const byControl = new Map<string, number>()
	let unmapped = 0
	const violations = gate.cases.flatMap((c) => c.violations)
	for (const v of violations) {
		if (v.controls.length === 0) {
			unmapped++
			continue
		}
		for (const control of v.controls) {
			byControl.set(control, (byControl.get(control) ?? 0) + 1)
		}
	}
	return { byControl, unmapped }
}

export function buildEvalComplianceReport(
	gate: EvalGateResult,
	config: EvalGateConfig,
	options: EvalComplianceReportOptions = {},
): EvalComplianceReport {
	const mappedAssertions = mapAssertionsToControls(config)
	const { byControl, unmapped } = countViolations(gate)

	const controlIds = new Set<string>([
		...mappedAssertions.keys(),
		...(options.controls ?? []),
		...byControl.keys(),
	])

	const controls: EvalComplianceControlResult[] = [...controlIds].sort().map((control) => {
		const violations = byControl.get(control) ?? 0
		return {
			control,
			assertions: [...(mappedAssertions.get(control) ?? [])].sort(),
			violations,
			passed: violations === 0,
		}
	})

	return {
		framework: options.framework,
		compliant: controls.every((c) => c.passed) && unmapped === 0,
		controls,
		unmappedViolations: unmapped,
	}
}

export function formatEvalComplianceReport(report: EvalComplianceReport): string {
	const lines: string[] = []
	lines.push('')
	lines.push(`  Compliance Report${report.framework ? `: ${report.framework}` : ''}`)
	lines.push(`  ${'─'.repeat(50)}`)
	for (const c of report.controls) {
		const icon = c.passed ? 'PASS' : 'FAIL'
		const mapped = c.assertions.length > 0 ? ` [${c.assertions.join(', ')}]` : ''
		lines.push(`  [${icon}] ${c.control}${mapped}${c.violations > 0 ? ` — ${c.violations}` : ''}`)
	}
	if (report.unmappedViolations > 0) {
		lines.push(`  ${report.unmappedViolations} violation(s) not mapped to any control`)
	}
	lines.push(`  ${'─'.repeat(50)}`)
	lines.push(`  ${report.compliant ? 'COMPLIANT' : 'NON-COMPLIANT'}`)
	lines.push('')
	return lines.join('\n')
}
