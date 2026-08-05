import { emptyLabel, joinLabels } from './label'
import type { FlowDecision, FlowPolicy, FlowTracker, Sink, TaintLabel, Tainted } from './types'

export interface FlowTrackerConfig {
	policy: FlowPolicy
	/** Starting label — defaults to the lattice bottom (trusted, unclassified). */
	initial?: TaintLabel
	/** Called on every denial. Wire to the audit trail or proof recorder. */
	onDeny?: (decision: FlowDecision) => void
}

/**
 * Accumulates provenance across a run.
 *
 * Labels only ever join, never subtract: once untrusted content enters a
 * context it stays untrusted for the life of that context. That is what makes
 * the check meaningful at the sink — by then the model has already seen
 * everything, so asking about one value in isolation would prove nothing.
 *
 * Trackers are per-run. Sharing one across independent requests would leak
 * taint between them; call `reset()` or build a new one.
 */
export function createFlowTracker(config: FlowTrackerConfig): FlowTracker {
	const { policy, onDeny } = config
	const initial = config.initial ?? emptyLabel()
	let current: TaintLabel = initial

	return {
		get label(): TaintLabel {
			return current
		},

		record(label: TaintLabel): void {
			current = joinLabels(current, label)
		},

		unwrap<T>(tainted: Tainted<T>): T {
			current = joinLabels(current, tainted.label)
			return tainted.value
		},

		check(sink: Sink): FlowDecision {
			const decision = policy.check(sink, current)
			if (!decision.allowed) onDeny?.(decision)
			return decision
		},

		reset(): void {
			current = initial
		},
	}
}
