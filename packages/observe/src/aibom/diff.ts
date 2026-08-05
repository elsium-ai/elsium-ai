import type {
	AiBom,
	AiBomDiff,
	ComponentDrift,
	ComponentKind,
	DriftSeverity,
	ModelComponent,
} from './types'

/**
 * Severity answers one question: does this change widen what the agent can
 * do, or where its data can go?
 *
 * `critical` — the blast radius grew, or a control was weakened. Adding a
 *   tool, loosening a sandbox capability, dropping an approval requirement,
 *   moving a model to another region, demoting a policy to monitor-only.
 * `major` — behaviour will change but the boundary did not move. A new
 *   prompt revision, a provider reshipping the same model name, a retuned
 *   threshold. Needs review, is not an escalation.
 * `minor` — descriptive only. Framework version bumps, tool descriptions.
 *
 * A removal is rarely critical: losing a capability is a correctness problem,
 * not a security one. Losing a *control* — a policy, an approval gate — is.
 */
const SEVERITY_RULES: Record<
	ComponentKind,
	{
		added: DriftSeverity
		removed: DriftSeverity
		fields: Record<string, DriftSeverity>
		defaultField: DriftSeverity
	}
> = {
	model: {
		added: 'critical',
		removed: 'major',
		fields: {
			provider: 'critical',
			model: 'critical',
			region: 'critical',
			fingerprint: 'major',
			role: 'major',
		},
		defaultField: 'major',
	},
	prompt: {
		added: 'major',
		removed: 'major',
		fields: { sha256: 'major', version: 'minor', variables: 'major' },
		defaultField: 'minor',
	},
	tool: {
		added: 'critical',
		removed: 'major',
		fields: {
			capabilities: 'critical',
			sandboxMode: 'critical',
			sideEffectLevel: 'critical',
			requiresApproval: 'critical',
			handlerSha256: 'critical',
			schemaSha256: 'major',
			description: 'minor',
		},
		defaultField: 'major',
	},
	mcpServer: {
		added: 'critical',
		removed: 'major',
		fields: {
			manifestSha256: 'critical',
			allowedTools: 'critical',
			transport: 'critical',
			toolCount: 'major',
		},
		defaultField: 'major',
	},
	dataset: {
		added: 'minor',
		removed: 'major',
		fields: {
			contentSha256: 'major',
			caseCount: 'major',
			annotatorAgreement: 'minor',
			annotators: 'minor',
			version: 'minor',
		},
		defaultField: 'minor',
	},
	policy: {
		added: 'major',
		removed: 'critical',
		fields: { sha256: 'critical', mode: 'critical', version: 'major' },
		defaultField: 'critical',
	},
	threshold: {
		added: 'minor',
		removed: 'major',
		fields: {},
		defaultField: 'major',
	},
	runtime: {
		added: 'minor',
		removed: 'minor',
		fields: {},
		defaultField: 'minor',
	},
}

const SEVERITY_ORDER: DriftSeverity[] = ['minor', 'major', 'critical']

function maxSeverity(a: DriftSeverity | null, b: DriftSeverity): DriftSeverity {
	if (a === null) return b
	return SEVERITY_ORDER.indexOf(a) >= SEVERITY_ORDER.indexOf(b) ? a : b
}

/**
 * Identify a model by the role it plays when one is declared.
 *
 * Without this, swapping the primary model reads as one removal plus one
 * addition; with it, the diff says "the primary model changed", which is
 * what a reviewer actually needs to see.
 */
function modelId(model: ModelComponent): string {
	return model.role ? `role:${model.role}` : `${model.provider}:${model.model}`
}

function valuesEqual(a: unknown, b: unknown): boolean {
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((item, i) => valuesEqual(item, b[i]))
	}
	if (a && b && typeof a === 'object' && typeof b === 'object') {
		const aKeys = Object.keys(a as object).sort()
		const bKeys = Object.keys(b as object).sort()
		if (aKeys.length !== bKeys.length || aKeys.some((k, i) => k !== bKeys[i])) return false
		return aKeys.every((k) =>
			valuesEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
		)
	}
	return a === b
}

function describe(value: unknown): string {
	if (value === undefined) return 'unset'
	if (Array.isArray(value)) return value.length === 0 ? '[]' : value.join(', ')
	return String(value)
}

function compareCollection<T extends object>(
	kind: ComponentKind,
	approved: readonly T[],
	current: readonly T[],
	identify: (item: T) => string,
): ComponentDrift[] {
	const rules = SEVERITY_RULES[kind]
	const drifts: ComponentDrift[] = []
	const approvedById = new Map(approved.map((item) => [identify(item), item]))
	const currentById = new Map(current.map((item) => [identify(item), item]))

	for (const [id, item] of currentById) {
		if (approvedById.has(id)) continue
		drifts.push({
			kind: 'added',
			componentKind: kind,
			id,
			severity: rules.added,
			current: item,
			reason: `${kind} "${id}" is present in the current BOM but was never approved`,
		})
	}

	for (const [id, item] of approvedById) {
		if (currentById.has(id)) continue
		drifts.push({
			kind: 'removed',
			componentKind: kind,
			id,
			severity: rules.removed,
			approved: item,
			reason: `approved ${kind} "${id}" is missing from the current BOM`,
		})
	}

	for (const [id, currentItem] of currentById) {
		const approvedItem = approvedById.get(id)
		if (!approvedItem) continue

		const approvedFields = approvedItem as Record<string, unknown>
		const currentFields = currentItem as Record<string, unknown>
		const fields = [
			...new Set([...Object.keys(approvedFields), ...Object.keys(currentFields)]),
		].sort()
		for (const field of fields) {
			const before = approvedFields[field]
			const after = currentFields[field]
			if (valuesEqual(before, after)) continue
			drifts.push({
				kind: 'changed',
				componentKind: kind,
				id,
				field,
				severity: rules.fields[field] ?? rules.defaultField,
				approved: before,
				current: after,
				reason: `${kind} "${id}" ${field}: ${describe(before)} → ${describe(after)}`,
			})
		}
	}

	return drifts
}

function compareThresholds(approved: AiBom, current: AiBom): ComponentDrift[] {
	const rules = SEVERITY_RULES.threshold
	const drifts: ComponentDrift[] = []
	const before = approved.components.thresholds ?? {}
	const after = current.components.thresholds ?? {}

	for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
		const hasBefore = key in before
		const hasAfter = key in after

		if (!hasBefore) {
			drifts.push({
				kind: 'added',
				componentKind: 'threshold',
				id: key,
				severity: rules.added,
				current: after[key],
				reason: `threshold "${key}" added (${describe(after[key])})`,
			})
		} else if (!hasAfter) {
			drifts.push({
				kind: 'removed',
				componentKind: 'threshold',
				id: key,
				severity: rules.removed,
				approved: before[key],
				reason: `threshold "${key}" removed (was ${describe(before[key])})`,
			})
		} else if (before[key] !== after[key]) {
			drifts.push({
				kind: 'changed',
				componentKind: 'threshold',
				id: key,
				field: 'value',
				severity: rules.defaultField,
				approved: before[key],
				current: after[key],
				reason: `threshold "${key}": ${describe(before[key])} → ${describe(after[key])}`,
			})
		}
	}

	return drifts
}

function compareRuntime(approved: AiBom, current: AiBom): ComponentDrift[] {
	const before = (approved.components.runtime ?? {}) as Record<string, unknown>
	const after = (current.components.runtime ?? {}) as Record<string, unknown>
	if (valuesEqual(before, after)) return []

	const rules = SEVERITY_RULES.runtime
	const drifts: ComponentDrift[] = []
	for (const field of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
		if (valuesEqual(before[field], after[field])) continue
		drifts.push({
			kind: 'changed',
			componentKind: 'runtime',
			id: 'runtime',
			field,
			severity: rules.defaultField,
			approved: before[field],
			current: after[field],
			reason: `runtime ${field}: ${describe(before[field])} → ${describe(after[field])}`,
		})
	}
	return drifts
}

/**
 * Compare an approved AI-BOM against the current one.
 *
 * This is the release gate: `identical` means the agent that shipped is the
 * agent that was signed off on. Anything else is composition drift, ranked
 * so CI can fail on `critical` while letting `minor` through.
 *
 * Purely structural — it does not verify signatures. Verify both BOMs first;
 * a diff against an unverified baseline proves nothing.
 */
export function diffAiBom(approved: AiBom, current: AiBom): AiBomDiff {
	const a = approved.components
	const b = current.components

	const drifts: ComponentDrift[] = [
		...compareCollection('model', a.models, b.models, modelId),
		...compareCollection('prompt', a.prompts, b.prompts, (p) => p.name),
		...compareCollection('tool', a.tools, b.tools, (t) => t.name),
		...compareCollection('mcpServer', a.mcpServers, b.mcpServers, (s) => s.name),
		...compareCollection('dataset', a.datasets, b.datasets, (d) => d.name),
		...compareCollection('policy', a.policies, b.policies, (p) => p.name),
		...compareThresholds(approved, current),
		...compareRuntime(approved, current),
	]

	const counts: Record<DriftSeverity, number> = { critical: 0, major: 0, minor: 0 }
	let highest: DriftSeverity | null = null
	for (const drift of drifts) {
		counts[drift.severity] += 1
		highest = maxSeverity(highest, drift.severity)
	}

	return {
		identical: drifts.length === 0,
		drifts,
		counts,
		highestSeverity: highest,
	}
}

/** True when the diff contains nothing at or above `failOn`. */
export function passesGate(diff: AiBomDiff, failOn: DriftSeverity = 'critical'): boolean {
	const threshold = SEVERITY_ORDER.indexOf(failOn)
	return !diff.drifts.some((d) => SEVERITY_ORDER.indexOf(d.severity) >= threshold)
}
