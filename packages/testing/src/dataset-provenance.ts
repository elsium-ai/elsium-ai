import { sha256Hex } from '@elsium-ai/core'
import type { EvalDataset } from './dataset'

/**
 * Dataset provenance — make the eval *data itself* auditable.
 *
 * Two questions a third party asks about an eval: "do I trust the judge?"
 * (see judge-alignment) and "do I trust the labels?". This answers the second:
 * inter-annotator agreement + a content hash so a signed eval proof can pin the
 * exact dataset it ran against.
 */

export interface Annotation {
	/** Who produced this label. */
	annotator: string
	/** The label — a score (0..1) or a category string. */
	label: number | string
	/** When (epoch ms). */
	at?: number
	/** Annotator's self-reported confidence (0..1). */
	confidence?: number
}

export interface AnnotatedCase {
	name: string
	input?: string
	annotations: Annotation[]
}

export interface AnnotationSummaryOptions {
	/** Numeric labels >= threshold count as the positive class. Default 0.5. */
	threshold?: number
	/** A case is "disputed" when agreement falls below this. Default 0.8. */
	disputeBelow?: number
}

export interface CaseAnnotationSummary {
	name: string
	annotatorCount: number
	/** Majority/most-common label after discretization. */
	goldLabel: string
	/** Fraction of annotators agreeing with the gold label (0..1). */
	agreement: number
	disputed: boolean
}

export interface DatasetAnnotationReport {
	cases: CaseAnnotationSummary[]
	annotators: string[]
	/** Mean per-case agreement (0..1). */
	overallAgreement: number
	/** Fleiss' kappa across raters when computable (uniform rater count), else null. */
	fleissKappa: number | null
	disputedCases: string[]
}

function discretize(label: number | string, threshold: number): string {
	if (typeof label === 'number') return label >= threshold ? 'pass' : 'fail'
	return label
}

function goldAndAgreement(labels: string[]): { gold: string; agreement: number } {
	const counts = new Map<string, number>()
	for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1)
	let gold = labels[0]
	let best = 0
	for (const [label, count] of counts) {
		if (count > best) {
			best = count
			gold = label
		}
	}
	return { gold, agreement: best / labels.length }
}

/** Fleiss' kappa — requires a uniform rater count per case and >= 2 raters. */
function fleissKappa(perCaseLabels: string[][]): number | null {
	const n = perCaseLabels[0]?.length ?? 0
	if (n < 2 || !perCaseLabels.every((ls) => ls.length === n)) return null

	const categories = [...new Set(perCaseLabels.flat())]
	const N = perCaseLabels.length
	if (categories.length < 2) return 1 // everyone agrees on a single category

	let pBarSum = 0
	const categoryTotals = new Map<string, number>(categories.map((c) => [c, 0]))
	for (const labels of perCaseLabels) {
		const counts = new Map<string, number>()
		for (const l of labels) {
			counts.set(l, (counts.get(l) ?? 0) + 1)
			categoryTotals.set(l, (categoryTotals.get(l) ?? 0) + 1)
		}
		let sumSq = 0
		for (const c of counts.values()) sumSq += c * c
		pBarSum += (sumSq - n) / (n * (n - 1))
	}
	const pBar = pBarSum / N
	let pe = 0
	for (const total of categoryTotals.values()) {
		const pj = total / (N * n)
		pe += pj * pj
	}
	if (pe === 1) return pBar === 1 ? 1 : 0
	return (pBar - pe) / (1 - pe)
}

/**
 * Summarize multi-annotator labels: gold label, per-case agreement, disputed
 * cases, and Fleiss' kappa when rater counts are uniform.
 */
export function summarizeAnnotations(
	cases: AnnotatedCase[],
	options: AnnotationSummaryOptions = {},
): DatasetAnnotationReport {
	if (cases.length === 0) throw new Error('summarizeAnnotations requires at least one case')
	const threshold = options.threshold ?? 0.5
	const disputeBelow = options.disputeBelow ?? 0.8

	const annotators = new Set<string>()
	const perCaseLabels: string[][] = []
	const summaries: CaseAnnotationSummary[] = []

	for (const c of cases) {
		if (c.annotations.length === 0) {
			throw new Error(`case "${c.name}" has no annotations`)
		}
		const labels = c.annotations.map((a) => discretize(a.label, threshold))
		for (const a of c.annotations) annotators.add(a.annotator)
		perCaseLabels.push(labels)
		const { gold, agreement } = goldAndAgreement(labels)
		summaries.push({
			name: c.name,
			annotatorCount: c.annotations.length,
			goldLabel: gold,
			agreement,
			disputed: agreement < disputeBelow,
		})
	}

	const overallAgreement = summaries.reduce((sum, s) => sum + s.agreement, 0) / summaries.length

	return {
		cases: summaries,
		annotators: [...annotators],
		overallAgreement,
		fleissKappa: fleissKappa(perCaseLabels),
		disputedCases: summaries.filter((s) => s.disputed).map((s) => s.name),
	}
}

export interface DatasetManifest {
	name: string
	version?: string
	caseCount: number
	/** SHA-256 of the canonical dataset content. */
	contentHash: string
}

function canonicalizeDataset(dataset: EvalDataset): string {
	const cases = [...dataset.cases]
		.map((c) => ({
			name: c.name,
			input: c.input,
			expected: c.expected ?? null,
			tags: c.tags ?? [],
		}))
		.sort((a, b) => a.name.localeCompare(b.name))
	return JSON.stringify({ name: dataset.name, version: dataset.version ?? null, cases })
}

/** Deterministic content hash of a dataset — for versioning and provenance. */
export async function hashDataset(dataset: EvalDataset): Promise<string> {
	return sha256Hex(canonicalizeDataset(dataset))
}

/** Build a content-addressed manifest pinning the exact dataset used. */
export async function createDatasetManifest(dataset: EvalDataset): Promise<DatasetManifest> {
	return {
		name: dataset.name,
		version: dataset.version,
		caseCount: dataset.cases.length,
		contentHash: await hashDataset(dataset),
	}
}
