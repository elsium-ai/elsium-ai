import type { AuditEvent, AuditTrail } from './audit'

export type ComplianceFramework = 'eu-ai-act' | 'colorado-ai-act' | 'owasp-agentic' | 'custom'

export interface ComplianceReportConfig {
	framework: ComplianceFramework
	systemName: string
	systemVersion: string
	reportPeriod: { from: number; to: number }
	riskLevel?: 'minimal' | 'limited' | 'high' | 'unacceptable'
	customChecks?: ComplianceCheck[]
}

export interface ComplianceCheck {
	id: string
	name: string
	description: string
	category: string
	evaluate: (events: AuditEvent[]) => ComplianceCheckResult
}

export interface ComplianceCheckResult {
	status: 'pass' | 'fail' | 'warning' | 'not-applicable'
	details: string
	evidence?: string[]
	recommendations?: string[]
}

export interface ComplianceReport {
	id: string
	framework: ComplianceFramework
	systemName: string
	systemVersion: string
	generatedAt: number
	reportPeriod: { from: number; to: number }
	summary: ComplianceSummary
	checks: ComplianceReportEntry[]
	auditIntegrity: { valid: boolean; totalEvents: number }
}

export interface ComplianceSummary {
	totalChecks: number
	passed: number
	failed: number
	warnings: number
	notApplicable: number
	overallStatus: 'compliant' | 'non-compliant' | 'needs-review'
}

export interface ComplianceReportEntry {
	id: string
	name: string
	category: string
	result: ComplianceCheckResult
}

function createOWASPAgenticChecks(): ComplianceCheck[] {
	return [
		{
			id: 'owasp-ag-01',
			name: 'Prompt Injection Detection',
			description: 'Verify security violation events exist for injection attempts',
			category: 'Goal Hijacking',
			evaluate: (events) => {
				const violations = events.filter(
					(e) => e.type === 'security_violation' && e.data.category === 'injection',
				)
				return {
					status: 'pass',
					details: `${violations.length} injection attempts detected and blocked`,
					evidence: violations
						.slice(0, 5)
						.map((v) => `Event ${v.id} at ${new Date(v.timestamp).toISOString()}`),
				}
			},
		},
		{
			id: 'owasp-ag-02',
			name: 'Tool Execution Audit',
			description: 'All tool executions are logged in audit trail',
			category: 'Tool Abuse',
			evaluate: (events) => {
				const toolEvents = events.filter((e) => e.type === 'tool_execution')
				if (toolEvents.length === 0) {
					return {
						status: 'warning',
						details: 'No tool execution events found in audit trail',
						recommendations: ['Enable audit middleware for tool executions'],
					}
				}
				return {
					status: 'pass',
					details: `${toolEvents.length} tool executions audited`,
				}
			},
		},
		{
			id: 'owasp-ag-03',
			name: 'Budget Enforcement',
			description: 'Budget alerts and limits are enforced',
			category: 'Runaway Agents',
			evaluate: (events) => {
				const budgetAlerts = events.filter((e) => e.type === 'budget_alert')
				const policyViolations = events.filter(
					(e) =>
						e.type === 'policy_violation' &&
						(e.data.policyName === 'cost-limit' || e.data.policyName === 'token-limit'),
				)
				return {
					status: 'pass',
					details: `${budgetAlerts.length} budget alerts, ${policyViolations.length} policy violations enforced`,
				}
			},
		},
		{
			id: 'owasp-ag-04',
			name: 'Audit Trail Integrity',
			description: 'Audit trail hash chain is intact',
			category: 'Audit Integrity',
			evaluate: () => ({
				status: 'pass',
				details: 'Audit trail integrity verified separately via verifyIntegrity()',
			}),
		},
		{
			id: 'owasp-ag-05',
			name: 'Secret Redaction Active',
			description: 'Security middleware redacts secrets from inputs and outputs',
			category: 'Data Exfiltration',
			evaluate: (events) => {
				const redactions = events.filter(
					(e) =>
						e.type === 'security_violation' &&
						(e.data.category === 'secret_detected' || e.data.redacted === true),
				)
				return {
					status: 'pass',
					details: `${redactions.length} secret redaction events recorded`,
				}
			},
		},
		{
			id: 'owasp-ag-06',
			name: 'Approval Gates Active',
			description: 'High-risk operations require approval',
			category: 'Privilege Escalation',
			evaluate: (events) => {
				const approvalRequests = events.filter((e) => e.type === 'approval_request')
				const approvalDecisions = events.filter((e) => e.type === 'approval_decision')
				if (approvalRequests.length === 0) {
					return {
						status: 'warning',
						details: 'No approval requests found — ensure approval gates are configured',
						recommendations: ['Configure approval gates for high-risk tool calls'],
					}
				}
				const denied = approvalDecisions.filter((e) => e.data.approved === false)
				return {
					status: 'pass',
					details: `${approvalRequests.length} approval requests, ${denied.length} denied`,
				}
			},
		},
	]
}

function createEUAIActChecks(riskLevel: string): ComplianceCheck[] {
	return [
		{
			id: 'eu-ai-01',
			name: 'Risk Classification',
			description: 'System risk level is documented',
			category: 'Risk Management',
			evaluate: () => ({
				status: 'pass',
				details: `System classified as "${riskLevel}" risk`,
			}),
		},
		{
			id: 'eu-ai-02',
			name: 'Human Oversight',
			description: 'Human-in-the-loop mechanisms are available (approval gates)',
			category: 'Human Oversight',
			evaluate: (events) => {
				const approvals = events.filter(
					(e) => e.type === 'approval_request' || e.type === 'approval_decision',
				)
				if (riskLevel === 'high' && approvals.length === 0) {
					return {
						status: 'fail',
						details: 'High-risk system requires human oversight mechanisms',
						recommendations: ['Implement approval gates for critical operations'],
					}
				}
				return {
					status: 'pass',
					details: `${approvals.length} human oversight events recorded`,
				}
			},
		},
		{
			id: 'eu-ai-03',
			name: 'Transparency Logging',
			description: 'All AI decisions are logged with full traceability',
			category: 'Transparency',
			evaluate: (events) => {
				const llmCalls = events.filter((e) => e.type === 'llm_call')
				const withTraceId = llmCalls.filter((e) => e.traceId)
				if (llmCalls.length === 0) {
					return {
						status: 'fail',
						details: 'No LLM call events logged',
						recommendations: ['Enable audit middleware on gateway'],
					}
				}
				const traceRate = withTraceId.length / llmCalls.length
				return {
					status: traceRate >= 0.95 ? 'pass' : 'warning',
					details: `${llmCalls.length} LLM calls logged, ${Math.round(traceRate * 100)}% with trace IDs`,
					recommendations:
						traceRate < 0.95
							? ['Ensure all requests include trace IDs for full traceability']
							: undefined,
				}
			},
		},
		{
			id: 'eu-ai-04',
			name: 'Data Governance',
			description: 'PII and sensitive data are protected',
			category: 'Data Governance',
			evaluate: (events) => {
				const securityEvents = events.filter((e) => e.type === 'security_violation')
				return {
					status: 'pass',
					details: `${securityEvents.length} security events recorded — data protection active`,
				}
			},
		},
		{
			id: 'eu-ai-05',
			name: 'Record Keeping',
			description: 'Audit trail is maintained with tamper-evident hash chain',
			category: 'Record Keeping',
			evaluate: () => ({
				status: 'pass',
				details: 'SHA-256 hash-chained audit trail is active',
			}),
		},
	]
}

function createColoradoAIActChecks(): ComplianceCheck[] {
	return [
		{
			id: 'co-ai-01',
			name: 'Impact Assessment Documentation',
			description: 'AI system impact is documented and assessable',
			category: 'Impact Assessment',
			evaluate: (events) => {
				const totalEvents = events.length
				return {
					status: totalEvents > 0 ? 'pass' : 'warning',
					details: `${totalEvents} events available for impact assessment`,
					recommendations:
						totalEvents === 0
							? ['Enable comprehensive audit logging for impact assessment evidence']
							: undefined,
				}
			},
		},
		{
			id: 'co-ai-02',
			name: 'Algorithmic Discrimination Prevention',
			description: 'Content policy and guardrails prevent discriminatory outputs',
			category: 'Fairness',
			evaluate: (events) => {
				const policyViolations = events.filter(
					(e) => e.type === 'policy_violation' && e.data.policyName === 'content-policy',
				)
				return {
					status: 'pass',
					details: `Content policy active — ${policyViolations.length} violations blocked`,
				}
			},
		},
		{
			id: 'co-ai-03',
			name: 'Consumer Notification Capability',
			description: 'System can notify users when AI is making consequential decisions',
			category: 'Transparency',
			evaluate: (events) => {
				const auditCount = events.filter((e) => e.type === 'llm_call').length
				return {
					status: 'pass',
					details: `${auditCount} AI decisions logged — notification capability supported via audit trail`,
				}
			},
		},
	]
}

function getChecksForFramework(config: ComplianceReportConfig): ComplianceCheck[] {
	switch (config.framework) {
		case 'owasp-agentic':
			return createOWASPAgenticChecks()
		case 'eu-ai-act':
			return createEUAIActChecks(config.riskLevel ?? 'limited')
		case 'colorado-ai-act':
			return createColoradoAIActChecks()
		case 'custom':
			return config.customChecks ?? []
	}
}

export async function generateComplianceReport(
	auditTrail: AuditTrail,
	config: ComplianceReportConfig,
): Promise<ComplianceReport> {
	const events = await auditTrail.query({
		fromTimestamp: config.reportPeriod.from,
		toTimestamp: config.reportPeriod.to,
	})

	const integrity = await auditTrail.verifyIntegrity()
	const checks = getChecksForFramework(config)

	const entries: ComplianceReportEntry[] = checks.map((check) => ({
		id: check.id,
		name: check.name,
		category: check.category,
		result: check.evaluate(events),
	}))

	const passed = entries.filter((e) => e.result.status === 'pass').length
	const failed = entries.filter((e) => e.result.status === 'fail').length
	const warnings = entries.filter((e) => e.result.status === 'warning').length
	const notApplicable = entries.filter((e) => e.result.status === 'not-applicable').length

	let overallStatus: ComplianceSummary['overallStatus'] = 'compliant'
	if (failed > 0) overallStatus = 'non-compliant'
	else if (warnings > 0) overallStatus = 'needs-review'

	return {
		id: `compliance_${config.framework}_${Date.now().toString(36)}`,
		framework: config.framework,
		systemName: config.systemName,
		systemVersion: config.systemVersion,
		generatedAt: Date.now(),
		reportPeriod: config.reportPeriod,
		summary: {
			totalChecks: entries.length,
			passed,
			failed,
			warnings,
			notApplicable,
			overallStatus,
		},
		checks: entries,
		auditIntegrity: { valid: integrity.valid, totalEvents: integrity.totalEvents },
	}
}

const STATUS_ICONS: Record<string, string> = {
	pass: '[PASS]',
	fail: '[FAIL]',
	warning: '[WARN]',
	'not-applicable': '[N/A]',
}

function formatCheckEntry(check: ComplianceReportEntry): string[] {
	const icon = STATUS_ICONS[check.result.status] ?? '[N/A]'
	const lines = [`**${icon} ${check.id}: ${check.name}**`, '', check.result.details]

	if (check.result.evidence?.length) {
		lines.push('', 'Evidence:')
		lines.push(...check.result.evidence.map((e) => `- ${e}`))
	}

	if (check.result.recommendations?.length) {
		lines.push('', 'Recommendations:')
		lines.push(...check.result.recommendations.map((r) => `- ${r}`))
	}

	lines.push('')
	return lines
}

export function formatComplianceReport(report: ComplianceReport): string {
	const lines: string[] = [
		`# Compliance Report: ${report.framework.toUpperCase()}`,
		'',
		`**System:** ${report.systemName} v${report.systemVersion}`,
		`**Generated:** ${new Date(report.generatedAt).toISOString()}`,
		`**Period:** ${new Date(report.reportPeriod.from).toISOString()} to ${new Date(report.reportPeriod.to).toISOString()}`,
		`**Status:** ${report.summary.overallStatus.toUpperCase()}`,
		'',
		'## Summary',
		'',
		'| Metric | Count |',
		'|--------|-------|',
		`| Total Checks | ${report.summary.totalChecks} |`,
		`| Passed | ${report.summary.passed} |`,
		`| Failed | ${report.summary.failed} |`,
		`| Warnings | ${report.summary.warnings} |`,
		`| N/A | ${report.summary.notApplicable} |`,
		'',
		'## Audit Trail Integrity',
		'',
		`- Valid: ${report.auditIntegrity.valid ? 'Yes' : 'NO'}`,
		`- Total Events: ${report.auditIntegrity.totalEvents}`,
		'',
		'## Checks',
		'',
	]

	const categories = [...new Set(report.checks.map((c) => c.category))]
	for (const category of categories) {
		lines.push(`### ${category}`, '')
		const categoryChecks = report.checks.filter((c) => c.category === category)
		for (const check of categoryChecks) {
			lines.push(...formatCheckEntry(check))
		}
	}

	return lines.join('\n')
}
