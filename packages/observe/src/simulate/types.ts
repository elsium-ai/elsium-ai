import type { ExecutionProof } from '../proof/types'

/**
 * Policy simulation — what a policy *would have done*, before it decides
 * anything for real.
 *
 * Governance controls fail on adoption, not on design. Nobody enables a rule
 * in production without knowing what it breaks, so policies sit in
 * monitor-only mode indefinitely and protect nothing. The gap is not a better
 * policy engine; it is the missing answer to "what will this block?".
 *
 * Recorded `ExecutionProof`s already hold what actually happened. Replaying a
 * candidate policy over them turns that question into an answer with traceIds
 * attached.
 *
 * The same shape as `terraform plan` or `opa eval`: decide against history,
 * then commit.
 */

export interface SimulatedDecision {
	allowed: boolean
	traceId: string
	/** Sequence number of the proof event this decision was made at. */
	sequence: number
	/** What was being decided — `llm:anthropic`, `tool:send_email`. */
	subject: string
	/** Rule that denied, when denied. */
	rule?: string
	reason?: string
}

/**
 * Evaluates one recorded run and returns every decision a policy would make
 * over it.
 *
 * A port, not a closed set: policy engines differ in what they decide over
 * (flows to a sink, authorization requests, budgets), and simulation should
 * not need to know. Built-in probes cover the shipped engines; custom ones
 * plug in the same way.
 */
export type PolicyProbe = (trace: ExecutionProof) => SimulatedDecision[]

export interface PolicySimulation {
	/** Runs examined. */
	traces: number
	/** Decision points evaluated across all runs. */
	evaluated: number
	allowed: number
	denied: number
	/** Every denial, with the trace it came from. */
	denials: readonly SimulatedDecision[]
	/** Denial count per rule — which rule does the work. */
	byRule: Readonly<Record<string, number>>
	/** Runs containing at least one denial. */
	affectedTraces: readonly string[]
	/** Fraction of runs a denial would have touched (0..1). */
	affectedTraceRatio: number
}

export interface PolicyComparison {
	baseline: PolicySimulation
	candidate: PolicySimulation
	/** Decisions the candidate blocks and the baseline did not — the blast radius. */
	newlyDenied: readonly SimulatedDecision[]
	/** Decisions the candidate permits and the baseline blocked — the regressions. */
	newlyAllowed: readonly SimulatedDecision[]
	/** Decisions both policies agree on. */
	unchanged: number
}
