/**
 * Example: dataset provenance — can you trust the eval LABELS?
 *
 * Usage:
 *   bun examples/dataset-provenance/index.ts
 *
 * No API key needed. Judge-alignment asks "do I trust the judge?"; this asks the
 * other half: "do I trust the data?". It reports inter-annotator agreement, a
 * gold label, disputed cases, Fleiss' kappa, and a content hash that pins the
 * exact dataset an eval ran against.
 */

import { type AnnotatedCase, createDatasetManifest, summarizeAnnotations } from '@elsium-ai/testing'

// Three reviewers labeled each case (1 = good answer, 0 = bad).
const labeled: AnnotatedCase[] = [
	{
		name: 'capital-france',
		annotations: [
			{ annotator: 'alice', label: 1 },
			{ annotator: 'bob', label: 1 },
			{ annotator: 'carol', label: 1 },
		],
	},
	{
		name: 'tone-of-reply',
		annotations: [
			{ annotator: 'alice', label: 1 },
			{ annotator: 'bob', label: 0 },
			{ annotator: 'carol', label: 0 },
		],
	},
]

console.log('\n[1] inter-annotator agreement')
const report = summarizeAnnotations(labeled)
for (const c of report.cases) {
	console.log(
		`  ${c.name.padEnd(16)} gold=${c.goldLabel} agreement=${(c.agreement * 100).toFixed(0)}%${c.disputed ? '  ⚠ disputed' : ''}`,
	)
}
console.log(`  overall agreement: ${(report.overallAgreement * 100).toFixed(0)}%`)
console.log(
	`  Fleiss' kappa: ${report.fleissKappa?.toFixed(2)} | disputed: ${report.disputedCases.join(', ') || 'none'}`,
)

console.log('\n[2] content hash pins the exact dataset')
const manifest = await createDatasetManifest({
	name: 'quiz',
	version: '1',
	cases: [
		{ name: 'capital-france', input: 'Capital of France?' },
		{ name: 'tone-of-reply', input: 'Rate the tone.' },
	],
})
console.log(`  ${manifest.name}@${manifest.version} · ${manifest.caseCount} cases`)
console.log(`  contentHash: ${manifest.contentHash.slice(0, 16)}…`)
console.log('  → sign this with proveEvalSuite to prove which dataset an eval ran against.')
