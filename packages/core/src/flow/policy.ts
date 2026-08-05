import { ElsiumError } from '../errors'
import { formatLabel } from './label'
import type { FlowCondition, FlowDecision, FlowPolicy, FlowRule, Sink, TaintLabel } from './types'

/**
 * Glob matching for sink patterns. `*` matches any run of characters, so
 * `network:*` covers every host and `tool:*` every tool.
 */
function sinkMatches(pattern: string, sink: Sink): boolean {
	if (pattern === sink) return true
	if (!pattern.includes('*')) return false

	const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
	return new RegExp(`^${escaped}$`).test(sink)
}

function patternsOf(rule: FlowRule): readonly string[] {
	return typeof rule.sink === 'string' ? [rule.sink] : rule.sink
}

/**
 * A condition matches when every field it declares matches. An empty
 * condition would match everything, which is never what an author means, so
 * it is rejected at construction rather than silently denying all traffic.
 */
function conditionMatches(condition: FlowCondition, label: TaintLabel): boolean {
	if (condition.hasClasses && !condition.hasClasses.every((c) => label.classes.includes(c))) {
		return false
	}
	if (condition.hasAnyClass && !condition.hasAnyClass.some((c) => label.classes.includes(c))) {
		return false
	}
	if (condition.origin && !condition.origin.includes(label.origin)) {
		return false
	}
	return true
}

function assertUsableRule(rule: FlowRule): void {
	if (!rule.name) {
		throw ElsiumError.validation('Flow rule requires a name')
	}
	const { hasClasses, hasAnyClass, origin } = rule.deny
	if (!hasClasses && !hasAnyClass && !origin) {
		throw ElsiumError.validation(
			`Flow rule "${rule.name}" declares no deny conditions, which would block every flow to its sink. State a condition, or use a sink pattern that means what you intend.`,
		)
	}
	if (patternsOf(rule).length === 0) {
		throw ElsiumError.validation(`Flow rule "${rule.name}" declares no sink`)
	}
}

function describe(rule: FlowRule, sink: Sink, label: TaintLabel): string {
	return (
		rule.reason ??
		`flow to ${sink} denied by rule "${rule.name}" — context is ${formatLabel(label)}`
	)
}

/**
 * Build a flow policy. Rules are deny-only and evaluated in order; the first
 * match wins. Absence of a matching rule allows the flow.
 *
 * Deny-only is deliberate. An allow/deny mix forces authors to reason about
 * precedence, and precedence bugs in a security control fail open. Here the
 * only question per rule is "does this flow match a prohibition?".
 */
export function createFlowPolicy(rules: readonly FlowRule[]): FlowPolicy {
	for (const rule of rules) assertUsableRule(rule)
	const frozen = [...rules]

	return {
		rules: frozen,

		check(sink: Sink, label: TaintLabel): FlowDecision {
			for (const rule of frozen) {
				const sinkMatched = patternsOf(rule).some((p) => sinkMatches(p, sink))
				if (!sinkMatched) continue
				if (!conditionMatches(rule.deny, label)) continue

				return {
					allowed: false,
					sink,
					label,
					rule: rule.name,
					reason: describe(rule, sink, label),
				}
			}

			return { allowed: true, sink, label }
		},
	}
}

/**
 * The lethal trifecta as a reusable rule: sensitive data plus untrusted
 * content must not reach an outbound sink.
 *
 * Prompt injection is the trigger, not the vulnerability. The vulnerability is
 * that all three were in the same context with an open channel — so this
 * blocks the channel rather than trying to detect the injection.
 */
export function lethalTrifectaRule(
	options: {
		sensitiveClasses?: readonly string[]
		sinks?: readonly Sink[]
		name?: string
	} = {},
): FlowRule {
	return {
		name: options.name ?? 'lethal-trifecta',
		sink: options.sinks ?? ['network:*', 'tool:*', 'mcp:*'],
		deny: {
			hasAnyClass: options.sensitiveClasses ?? ['secret', 'pii'],
			origin: ['untrusted'],
		},
		reason:
			'context holds sensitive data alongside untrusted content, and this sink can reach outside — the combination is an exfiltration path regardless of what the model was asked to do',
	}
}
