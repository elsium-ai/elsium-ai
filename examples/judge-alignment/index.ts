/**
 * Example: judge alignment — is your LLM-judge trustworthy?
 *
 * Usage:
 *   bun examples/judge-alignment/index.ts
 *
 * No API key needed. An LLM-judge produces a score; on its own that is an
 * opinion. This measures whether the judge agrees with human ground-truth
 * (agreement, Cohen's kappa) and whether it agrees with itself (consistency).
 * "Evals are proof, not opinion" — including the judge.
 */

import {
	assessJudgeConsistency,
	computeJudgeAlignment,
	runJudgeAlignment,
} from '@elsium-ai/testing'

// ─── [1] Align a judge against human-labeled cases ──────────────

console.log('\n[1] runJudgeAlignment — judge vs human ground-truth')

// Human-labeled cases (0..1). In real use these come from your reviewers.
const labeled = [
	{ output: 'Paris is the capital of France.', humanScore: 1 },
	{ output: 'The capital of France is Lyon.', humanScore: 0 },
	{ output: 'France is in Europe; its capital is Paris.', humanScore: 1 },
	{ output: 'I think it might be Berlin?', humanScore: 0 },
	{ output: 'Paris.', humanScore: 1 },
	{ output: 'Not sure, ask someone else.', humanScore: 0 },
]

// A stand-in "judge": flags answers that mention Paris. (Swap for
// createRubricJudge(...).evaluate in real use — its score plugs in directly.)
const judge = (output: string) => (/\bparis\b/i.test(output) ? 1 : 0)

const aligned = await runJudgeAlignment(labeled, judge)
console.log(`  agreement: ${(aligned.agreementRate * 100).toFixed(0)}%`)
console.log(`  Cohen's kappa: ${aligned.cohenKappa.toFixed(2)} (${aligned.strength})`)
console.log(`  MAE: ${aligned.meanAbsoluteError.toFixed(2)} | confusion:`, aligned.confusion)

// ─── [2] A biased judge scores high agreement but low kappa ─────

console.log('\n[2] a biased judge — high agreement, but kappa exposes it')
const yesJudge = () => 1 // says "pass" to everything
const biased = computeJudgeAlignment(
	labeled.map((c) => ({ human: c.humanScore, judge: yesJudge() })),
)
console.log(`  agreement: ${(biased.agreementRate * 100).toFixed(0)}%`)
console.log(
	`  Cohen's kappa: ${biased.cohenKappa.toFixed(2)} (${biased.strength}) ← chance-corrected`,
)

// ─── [3] Does the judge agree with itself? ──────────────────────

console.log('\n[3] assessJudgeConsistency — the judge re-judged N times')
const stable = await assessJudgeConsistency(() => 0.82, { runs: 5 })
console.log(`  stable judge → consistent: ${stable.consistent}, range: ${stable.range}`)

const flaky = [0.4, 0.9, 0.6, 0.5, 0.8]
let i = 0
const wobbly = await assessJudgeConsistency(() => flaky[i++ % flaky.length], { runs: 5 })
console.log(`  wobbly judge → consistent: ${wobbly.consistent}, range: ${wobbly.range.toFixed(2)}`)
