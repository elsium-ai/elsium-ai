/**
 * Information-flow control — governance for the *data*, not the caller.
 *
 * Capability tokens answer "may this agent call this tool?". They say nothing
 * about what is inside the prompt by the time it does. Once a retrieved
 * document, a tool result, or a user message enters the context it becomes
 * undifferentiated text, and every downstream decision is made blind.
 *
 * This module keeps that provenance attached. Data carries a label, labels
 * join as data merges, and a sink is checked against the accumulated label
 * before anything leaves.
 *
 * The failure it exists to stop is the lethal trifecta: sensitive data,
 * untrusted content, and an outbound channel present in the same context. Any
 * two are fine; all three is an exfiltration path, and prompt injection is how
 * it gets triggered.
 */

/**
 * Where data came from — the axis that decides whether it may be trusted as
 * instructions rather than as content.
 *
 * `trusted`   — authored by the operator: system prompts, hardcoded config.
 * `model`     — produced by an LLM. Not attacker-controlled by default, but
 *               derived from whatever was in context, so it cannot launder
 *               untrusted input back into trusted standing.
 * `untrusted` — anything from outside: user input, retrieved documents, tool
 *               results, MCP responses, web pages.
 */
export type Origin = 'trusted' | 'model' | 'untrusted'

/**
 * Sensitivity tags — deliberately the same `DataClass` capability tokens use.
 *
 * A token that permits `dataClasses: ['pii']` and a flow rule that denies
 * `pii` reaching the network have to be talking about the same thing, or the
 * two controls can be satisfied simultaneously while contradicting each other.
 * Free-form by design: classification is the operator's regulatory
 * interpretation, not something a framework should hardcode.
 */
import type { DataClass } from '../capability/types'

export type { DataClass }

/**
 * Provenance attached to a value.
 *
 * A label is a point in a lattice: `classes` and `sources` join by union,
 * `origin` by taking the least trusted. Joins only ever move upward, so
 * combining data can never launder it into a weaker label.
 */
export interface TaintLabel {
	readonly classes: readonly DataClass[]
	readonly origin: Origin
	/** Provenance identifiers — document ids, tool names, user ids. For audit. */
	readonly sources: readonly string[]
}

/** A value carrying its provenance. */
export interface Tainted<T> {
	readonly value: T
	readonly label: TaintLabel
}

/**
 * A destination data can flow to.
 *
 * Convention is `kind:name` — `llm:anthropic`, `tool:send_email`,
 * `network:api.example.com`, `mcp:filesystem`. Rules match with `*` globs, so
 * `network:*` covers every outbound host.
 */
export type Sink = string

export interface FlowCondition {
	/** Matches when the label carries every one of these classes. */
	readonly hasClasses?: readonly DataClass[]
	/** Matches when the label carries at least one of these classes. */
	readonly hasAnyClass?: readonly DataClass[]
	/** Matches when the label's origin is one of these. */
	readonly origin?: readonly Origin[]
}

export interface FlowRule {
	readonly name: string
	/** Sink pattern(s) this rule governs. Supports `*` wildcards. */
	readonly sink: Sink | readonly Sink[]
	/**
	 * Conditions on the accumulated label. All present fields must match for
	 * the rule to fire — an omitted field is not a constraint.
	 */
	readonly deny: FlowCondition
	/** Operator-facing explanation, surfaced on denial and in audit events. */
	readonly reason?: string
}

export interface FlowDecision {
	readonly allowed: boolean
	readonly sink: Sink
	/** The accumulated label the decision was made against. */
	readonly label: TaintLabel
	/** Name of the rule that denied, when denied. */
	readonly rule?: string
	readonly reason?: string
}

export interface FlowPolicy {
	readonly rules: readonly FlowRule[]
	/** Evaluate a flow to `sink` carrying `label`. First matching deny wins. */
	check(sink: Sink, label: TaintLabel): FlowDecision
}

/**
 * Accumulates the labels of everything that has entered a context, so a sink
 * can be checked against the whole of it rather than one value at a time.
 */
export interface FlowTracker {
	/** The join of every label recorded so far. */
	readonly label: TaintLabel
	/** Record data entering the context. */
	record(label: TaintLabel): void
	/** Record a tainted value and return its inner value. */
	unwrap<T>(tainted: Tainted<T>): T
	/** Evaluate a flow to `sink` against everything accumulated. */
	check(sink: Sink): FlowDecision
	/** Drop all accumulated provenance — e.g. between independent runs. */
	reset(): void
}
