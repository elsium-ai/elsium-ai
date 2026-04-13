import type { EvalSuiteResult } from './eval'
import type { ConversationResult } from './multi-turn'
import type { RedTeamResult } from './red-team'

export type CIReportInput = EvalSuiteResult | ConversationResult | RedTeamResult

function escapeXml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;')
}

function isEvalResult(input: CIReportInput): input is EvalSuiteResult {
	return (
		'results' in input &&
		'score' in input &&
		'total' in input &&
		!('turns' in input) &&
		!('compromised' in input)
	)
}

function isConversationResult(input: CIReportInput): input is ConversationResult {
	return 'turns' in input
}

function isRedTeamResult(input: CIReportInput): input is RedTeamResult {
	return 'compromised' in input
}

interface TestCase {
	name: string
	passed: boolean
	durationMs: number
	failureMessage?: string
}

function extractTestCases(input: CIReportInput): { suiteName: string; cases: TestCase[] } {
	if (isEvalResult(input)) {
		return {
			suiteName: input.name,
			cases: input.results.map((r) => ({
				name: r.name,
				passed: r.passed,
				durationMs: r.durationMs,
				failureMessage: r.passed
					? undefined
					: r.criteria
							.filter((c) => !c.passed)
							.map((c) => c.message)
							.join('; '),
			})),
		}
	}

	if (isConversationResult(input)) {
		return {
			suiteName: input.name,
			cases: input.turns.map((t) => ({
				name: t.name ?? `Turn ${t.turnIndex + 1}`,
				passed: t.passed,
				durationMs: t.durationMs,
				failureMessage: t.passed
					? undefined
					: t.assertions
							.filter((a) => !a.passed)
							.map((a) => a.message)
							.join('; '),
			})),
		}
	}

	return {
		suiteName: input.name,
		cases: input.results.map((r) => ({
			name: r.probe.name,
			passed: !r.compromised && !r.error,
			durationMs: r.durationMs,
			failureMessage: r.compromised
				? `Agent compromised by ${r.probe.category} probe (${r.probe.severity})`
				: r.error
					? `Probe error: ${r.error}`
					: undefined,
		})),
	}
}

export function toJUnitXML(input: CIReportInput): string {
	const { suiteName, cases } = extractTestCases(input)
	const failures = cases.filter((c) => !c.passed).length
	const totalTime = cases.reduce((sum, c) => sum + c.durationMs, 0) / 1000

	const lines: string[] = []
	lines.push('<?xml version="1.0" encoding="UTF-8"?>')
	lines.push(
		`<testsuite name="${escapeXml(suiteName)}" tests="${cases.length}" failures="${failures}" time="${totalTime.toFixed(3)}">`,
	)

	for (const tc of cases) {
		const time = (tc.durationMs / 1000).toFixed(3)
		if (tc.passed) {
			lines.push(`  <testcase name="${escapeXml(tc.name)}" time="${time}" />`)
		} else {
			lines.push(`  <testcase name="${escapeXml(tc.name)}" time="${time}">`)
			lines.push(
				`    <failure message="${escapeXml(tc.failureMessage ?? 'Test failed')}">${escapeXml(tc.failureMessage ?? 'Test failed')}</failure>`,
			)
			lines.push('  </testcase>')
		}
	}

	lines.push('</testsuite>')
	return lines.join('\n')
}

export function toGitHubAnnotations(input: CIReportInput): string {
	const { suiteName, cases } = extractTestCases(input)
	const lines: string[] = []

	for (const tc of cases) {
		if (!tc.passed) {
			const msg = tc.failureMessage ?? 'Test failed'
			lines.push(`::error title=${suiteName}: ${tc.name}::${msg}`)
		}
	}

	const passed = cases.filter((c) => c.passed).length
	if (passed === cases.length) {
		lines.push(`::notice title=${suiteName}::All ${cases.length} checks passed`)
	}

	return lines.join('\n')
}

export function toMarkdownSummary(input: CIReportInput): string {
	const { suiteName, cases } = extractTestCases(input)
	const passed = cases.filter((c) => c.passed).length
	const failed = cases.length - passed
	const allPassed = failed === 0

	const lines: string[] = []
	lines.push(`## ${allPassed ? '\u2705' : '\u274c'} ${suiteName}`)
	lines.push('')

	if (isRedTeamResult(input)) {
		const score = (input.score * 100).toFixed(1)
		lines.push(
			`**Security Score:** ${score}% | ${input.passed} resisted | ${input.compromised} compromised | ${input.errored} errors`,
		)
		lines.push('')
	}

	lines.push('| Status | Test | Duration |')
	lines.push('|--------|------|----------|')

	for (const tc of cases) {
		const icon = tc.passed ? '\u2705' : '\u274c'
		lines.push(`| ${icon} | ${tc.name} | ${tc.durationMs}ms |`)
	}

	lines.push('')
	lines.push(`**${passed}/${cases.length} passed** (${failed} failed)`)

	if (failed > 0) {
		lines.push('')
		lines.push('<details><summary>Failures</summary>')
		lines.push('')
		for (const tc of cases) {
			if (!tc.passed && tc.failureMessage) {
				lines.push(`- **${tc.name}**: ${tc.failureMessage}`)
			}
		}
		lines.push('')
		lines.push('</details>')
	}

	return lines.join('\n')
}
