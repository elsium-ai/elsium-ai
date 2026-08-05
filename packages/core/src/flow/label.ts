import type { DataClass, Origin, TaintLabel, Tainted } from './types'

/**
 * Trust ordering. Higher wins a join, so mixing trusted and untrusted data
 * yields untrusted — the direction that keeps the guarantee sound.
 */
const ORIGIN_RANK: Record<Origin, number> = {
	trusted: 0,
	model: 1,
	untrusted: 2,
}

/** The bottom of the lattice: no classes, fully trusted, no provenance. */
export function emptyLabel(): TaintLabel {
	return { classes: [], origin: 'trusted', sources: [] }
}

function dedupeSorted(values: readonly string[]): readonly string[] {
	return [...new Set(values)].sort()
}

export interface LabelInit {
	classes?: readonly DataClass[]
	origin?: Origin
	sources?: readonly string[]
	/** Convenience for the common single-source case. */
	source?: string
}

/** Build a normalized label. Defaults to `untrusted` — safe by omission. */
export function createLabel(init: LabelInit = {}): TaintLabel {
	const sources = [...(init.sources ?? []), ...(init.source ? [init.source] : [])]
	return {
		classes: dedupeSorted(init.classes ?? []),
		origin: init.origin ?? 'untrusted',
		sources: dedupeSorted(sources),
	}
}

/**
 * Least upper bound of two labels.
 *
 * Union of classes and sources, least-trusted origin. Monotonic by
 * construction: a join is never weaker than either input, so no sequence of
 * merges can wash a taint out.
 */
export function joinLabels(a: TaintLabel, b: TaintLabel): TaintLabel {
	return {
		classes: dedupeSorted([...a.classes, ...b.classes]),
		origin: ORIGIN_RANK[a.origin] >= ORIGIN_RANK[b.origin] ? a.origin : b.origin,
		sources: dedupeSorted([...a.sources, ...b.sources]),
	}
}

/** Join any number of labels. */
export function joinAll(labels: readonly TaintLabel[]): TaintLabel {
	return labels.reduce(joinLabels, emptyLabel())
}

/** Attach provenance to a value. */
export function taint<T>(value: T, init: LabelInit = {}): Tainted<T> {
	return { value, label: createLabel(init) }
}

/** True when `label` is at least as restrictive as `other` in every dimension. */
export function dominates(label: TaintLabel, other: TaintLabel): boolean {
	if (ORIGIN_RANK[label.origin] < ORIGIN_RANK[other.origin]) return false
	return other.classes.every((c) => label.classes.includes(c))
}

/**
 * Deliberate downgrade — the only way to weaken a label.
 *
 * Every declassification is a hole in the guarantee, so it is explicit, needs
 * a stated reason, and records who did it. Auditors should be able to find
 * every one of these by grepping for the source marker.
 */
export function declassify<T>(
	tainted: Tainted<T>,
	options: { to: LabelInit; reason: string; by: string },
): Tainted<T> {
	const next = createLabel(options.to)
	return {
		value: tainted.value,
		label: {
			...next,
			sources: dedupeSorted([
				...next.sources,
				...tainted.label.sources,
				`declassified-by:${options.by}`,
			]),
		},
	}
}

/** Human-readable rendering for logs and denial messages. */
export function formatLabel(label: TaintLabel): string {
	const classes = label.classes.length > 0 ? label.classes.join(',') : 'none'
	const sources = label.sources.length > 0 ? ` from ${label.sources.join(',')}` : ''
	return `origin=${label.origin} classes=[${classes}]${sources}`
}
