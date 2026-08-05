import type { ExecutionProof } from '../proof/types'
import type { PolicyComparison, PolicyProbe, PolicySimulation, SimulatedDecision } from './types'

/** Identity of a decision point, so two policies can be compared position by position. */
function decisionKey(decision: SimulatedDecision): string {
	return `${decision.traceId}#${decision.sequence}:${decision.subject}`
}

function summarize(
	traces: readonly ExecutionProof[],
	decisions: SimulatedDecision[],
): PolicySimulation {
	const denials = decisions.filter((d) => !d.allowed)
	const byRule: Record<string, number> = {}
	for (const denial of denials) {
		const rule = denial.rule ?? '(unnamed)'
		byRule[rule] = (byRule[rule] ?? 0) + 1
	}

	const affected = [...new Set(denials.map((d) => d.traceId))].sort()

	return {
		traces: traces.length,
		evaluated: decisions.length,
		allowed: decisions.length - denials.length,
		denied: denials.length,
		denials,
		byRule,
		affectedTraces: affected,
		affectedTraceRatio: traces.length === 0 ? 0 : affected.length / traces.length,
	}
}

/**
 * Run a policy over recorded runs and report what it would have decided.
 *
 * Read-only: proofs are inputs, nothing is executed, no side effect is
 * replayed. A tool call that was denied in simulation still happened in the
 * recording — the point is to learn that before shipping the rule.
 */
export function simulatePolicy(
	traces: readonly ExecutionProof[],
	probe: PolicyProbe,
): PolicySimulation {
	const decisions: SimulatedDecision[] = []
	for (const trace of traces) decisions.push(...probe(trace))
	return summarize(traces, decisions)
}

/**
 * Diff two policies over the same history.
 *
 * `newlyDenied` is the question everyone actually asks — what breaks if I turn
 * this on. `newlyAllowed` is the one they forget: a relaxed policy silently
 * permitting what used to be blocked is how controls erode.
 */
export function comparePolicies(
	traces: readonly ExecutionProof[],
	policies: { baseline: PolicyProbe; candidate: PolicyProbe },
): PolicyComparison {
	const baselineDecisions: SimulatedDecision[] = []
	const candidateDecisions: SimulatedDecision[] = []

	for (const trace of traces) {
		baselineDecisions.push(...policies.baseline(trace))
		candidateDecisions.push(...policies.candidate(trace))
	}

	const baselineByKey = new Map(baselineDecisions.map((d) => [decisionKey(d), d]))

	const newlyDenied: SimulatedDecision[] = []
	const newlyAllowed: SimulatedDecision[] = []
	let unchanged = 0

	for (const decision of candidateDecisions) {
		const before = baselineByKey.get(decisionKey(decision))

		// No counterpart means the candidate evaluates a point the baseline did
		// not reach — count a denial there as newly denied, not as agreement.
		if (!before) {
			if (!decision.allowed) newlyDenied.push(decision)
			else unchanged++
			continue
		}

		if (before.allowed === decision.allowed) unchanged++
		else if (decision.allowed) newlyAllowed.push(decision)
		else newlyDenied.push(decision)
	}

	return {
		baseline: summarize(traces, baselineDecisions),
		candidate: summarize(traces, candidateDecisions),
		newlyDenied,
		newlyAllowed,
		unchanged,
	}
}

/** Human-readable plan, in the spirit of `terraform plan`. */
export function formatSimulation(simulation: PolicySimulation): string {
	const lines: string[] = []
	const pct = (simulation.affectedTraceRatio * 100).toFixed(2)

	lines.push(
		`${simulation.evaluated} decision point(s) across ${simulation.traces} run(s): ${simulation.allowed} allowed, ${simulation.denied} denied`,
	)

	if (simulation.denied === 0) {
		lines.push('No run would have been affected.')
		return lines.join('\n')
	}

	lines.push(
		`${simulation.affectedTraces.length} of ${simulation.traces} run(s) affected (${pct}%)`,
	)
	lines.push('')

	for (const [rule, count] of Object.entries(simulation.byRule).sort((a, b) => b[1] - a[1])) {
		lines.push(`  ${String(count).padStart(5)}  ${rule}`)
	}

	// The reason is a property of the rule, not of each hit — printing it per
	// denial buries the summary under repetition.
	const firstReason = simulation.denials.find((d) => d.reason)?.reason
	if (firstReason) {
		lines.push('')
		lines.push(`  ${firstReason}`)
	}

	lines.push('')
	// Enough to investigate, not enough to scroll past.
	for (const denial of simulation.denials.slice(0, 5)) {
		lines.push(`  ✗ ${denial.traceId} @${denial.sequence} ${denial.subject}`)
	}
	if (simulation.denials.length > 5) {
		lines.push(`  … and ${simulation.denials.length - 5} more`)
	}

	return lines.join('\n')
}

/** Human-readable diff between two policies. */
export function formatComparison(comparison: PolicyComparison): string {
	const lines: string[] = []
	const { newlyDenied, newlyAllowed, unchanged } = comparison

	lines.push(
		`Plan: ${newlyDenied.length} newly denied, ${newlyAllowed.length} newly allowed, ${unchanged} unchanged`,
	)

	if (newlyDenied.length === 0 && newlyAllowed.length === 0) {
		lines.push('\nNo behavioural change over this history.')
		return lines.join('\n')
	}

	if (newlyDenied.length > 0) {
		lines.push('\nWould now be BLOCKED:')
		for (const d of newlyDenied.slice(0, 10)) {
			lines.push(`  ✗ ${d.traceId} @${d.sequence} ${d.subject}${d.rule ? ` — ${d.rule}` : ''}`)
		}
		if (newlyDenied.length > 10) lines.push(`  … and ${newlyDenied.length - 10} more`)
	}

	if (newlyAllowed.length > 0) {
		lines.push('\nWould now be ALLOWED (control relaxed):')
		for (const d of newlyAllowed.slice(0, 10)) {
			lines.push(`  ! ${d.traceId} @${d.sequence} ${d.subject}`)
		}
		if (newlyAllowed.length > 10) lines.push(`  … and ${newlyAllowed.length - 10} more`)
	}

	return lines.join('\n')
}
