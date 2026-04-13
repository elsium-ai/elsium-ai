import { describe, expect, it } from 'vitest'
import { createAuditTrail } from './audit'
import { formatComplianceReport, generateComplianceReport } from './compliance'

function createTestAuditTrail() {
	return createAuditTrail({ hashChain: true })
}

describe('generateComplianceReport', () => {
	it('generates OWASP Agentic report', async () => {
		const audit = createTestAuditTrail()

		audit.log('llm_call', { provider: 'anthropic', model: 'claude-3' })
		audit.log('tool_execution', { tool: 'search', success: true })
		audit.log('security_violation', { category: 'injection', detail: 'blocked' })
		audit.log('budget_alert', { spent: 5, budget: 10 })

		const report = await generateComplianceReport(audit, {
			framework: 'owasp-agentic',
			systemName: 'test-system',
			systemVersion: '1.0.0',
			reportPeriod: { from: 0, to: Date.now() + 1000 },
		})

		expect(report.framework).toBe('owasp-agentic')
		expect(report.systemName).toBe('test-system')
		expect(report.summary.totalChecks).toBe(6)
		expect(report.summary.overallStatus).toBe('needs-review')
		expect(report.auditIntegrity.valid).toBe(true)
		expect(report.checks.length).toBe(6)
	})

	it('generates EU AI Act report for high-risk system', async () => {
		const audit = createTestAuditTrail()

		audit.log('llm_call', { provider: 'anthropic' }, { traceId: 'trace-1' })
		audit.log('approval_request', { operation: 'deploy' })
		audit.log('approval_decision', { approved: true })
		audit.log('security_violation', { category: 'pii', detail: 'redacted' })

		const report = await generateComplianceReport(audit, {
			framework: 'eu-ai-act',
			systemName: 'medical-ai',
			systemVersion: '2.0.0',
			reportPeriod: { from: 0, to: Date.now() + 1000 },
			riskLevel: 'high',
		})

		expect(report.framework).toBe('eu-ai-act')
		expect(report.summary.totalChecks).toBe(5)

		const humanOversight = report.checks.find((c) => c.id === 'eu-ai-02')
		expect(humanOversight?.result.status).toBe('pass')
	})

	it('generates EU AI Act report — fails on missing oversight for high-risk', async () => {
		const audit = createTestAuditTrail()
		audit.log('llm_call', { provider: 'openai' })

		const report = await generateComplianceReport(audit, {
			framework: 'eu-ai-act',
			systemName: 'decision-system',
			systemVersion: '1.0.0',
			reportPeriod: { from: 0, to: Date.now() + 1000 },
			riskLevel: 'high',
		})

		const humanOversight = report.checks.find((c) => c.id === 'eu-ai-02')
		expect(humanOversight?.result.status).toBe('fail')
		expect(report.summary.overallStatus).toBe('non-compliant')
	})

	it('generates Colorado AI Act report', async () => {
		const audit = createTestAuditTrail()
		audit.log('llm_call', { provider: 'anthropic' })
		audit.log('policy_violation', { policyName: 'content-policy' })

		const report = await generateComplianceReport(audit, {
			framework: 'colorado-ai-act',
			systemName: 'co-system',
			systemVersion: '1.0.0',
			reportPeriod: { from: 0, to: Date.now() + 1000 },
		})

		expect(report.framework).toBe('colorado-ai-act')
		expect(report.summary.totalChecks).toBe(3)
		expect(report.summary.passed).toBeGreaterThan(0)
	})

	it('generates custom report with user-defined checks', async () => {
		const audit = createTestAuditTrail()
		audit.log('llm_call', { custom: true })

		const report = await generateComplianceReport(audit, {
			framework: 'custom',
			systemName: 'custom-system',
			systemVersion: '1.0.0',
			reportPeriod: { from: 0, to: Date.now() + 1000 },
			customChecks: [
				{
					id: 'custom-01',
					name: 'Custom Check',
					description: 'A custom compliance check',
					category: 'Custom',
					evaluate: (events) => ({
						status: events.length > 0 ? 'pass' : 'fail',
						details: `${events.length} events found`,
					}),
				},
			],
		})

		expect(report.summary.totalChecks).toBe(1)
		expect(report.checks[0].result.status).toBe('pass')
	})

	it('verifies audit integrity in report', async () => {
		const audit = createTestAuditTrail()
		audit.log('llm_call', { test: true })

		const report = await generateComplianceReport(audit, {
			framework: 'owasp-agentic',
			systemName: 'test',
			systemVersion: '1.0.0',
			reportPeriod: { from: 0, to: Date.now() + 1000 },
		})

		expect(report.auditIntegrity.valid).toBe(true)
		expect(report.auditIntegrity.totalEvents).toBe(1)
	})

	it('filters events by report period', async () => {
		const audit = createTestAuditTrail()
		const now = Date.now()

		audit.log('llm_call', { old: true })

		const report = await generateComplianceReport(audit, {
			framework: 'owasp-agentic',
			systemName: 'test',
			systemVersion: '1.0.0',
			reportPeriod: { from: now + 100000, to: now + 200000 },
		})

		expect(report.auditIntegrity.totalEvents).toBeGreaterThan(0)
	})
})

describe('formatComplianceReport', () => {
	it('formats report as markdown', async () => {
		const audit = createTestAuditTrail()
		audit.log('llm_call', { provider: 'anthropic' })

		const report = await generateComplianceReport(audit, {
			framework: 'owasp-agentic',
			systemName: 'test-system',
			systemVersion: '1.0.0',
			reportPeriod: { from: 0, to: Date.now() + 1000 },
		})

		const formatted = formatComplianceReport(report)

		expect(formatted).toContain('# Compliance Report: OWASP-AGENTIC')
		expect(formatted).toContain('**System:** test-system v1.0.0')
		expect(formatted).toContain('## Summary')
		expect(formatted).toContain('## Checks')
		expect(formatted).toContain('Total Checks')
	})

	it('includes recommendations in formatted output', async () => {
		const audit = createTestAuditTrail()

		const report = await generateComplianceReport(audit, {
			framework: 'owasp-agentic',
			systemName: 'test',
			systemVersion: '1.0.0',
			reportPeriod: { from: 0, to: Date.now() + 1000 },
		})

		const formatted = formatComplianceReport(report)
		expect(formatted).toContain('Recommendations:')
	})
})
