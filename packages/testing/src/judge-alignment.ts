/**
 * Judge alignment — measure whether an LLM-judge can be trusted.
 *
 * An LLM-as-judge produces a score; on its own that is an opinion. This module
 * turns it into a calibrated instrument: it measures how well the judge agrees
 * with human ground-truth (agreement rate, Cohen's kappa, MAE, correlation) and
 * how consistent the judge is with itself across runs.
 *
 * "Evals are proof, not opinion" applies to the judge too: a judge you have not
 * aligned is just a confident guess.
 */

export interface AlignmentPair {
	/** Human ground-truth score (0..1). */
	human: number
	/** Judge score (0..1). */
	judge: number
}

export interface JudgeAlignmentOptions {
	/** Scores >= threshold count as "pass" for agreement/kappa. Default 0.5. */
	threshold?: number
}

export type AgreementStrength = 'poor' | 'fair' | 'moderate' | 'substantial' | 'almost-perfect'

export interface JudgeAlignmentResult {
	n: number
	threshold: number
	/** Observed agreement on pass/fail after thresholding (0..1). */
	agreementRate: number
	/** Cohen's kappa — agreement corrected for chance (-1..1). */
	cohenKappa: number
	/** Mean absolute error between human and judge continuous scores. */
	meanAbsoluteError: number
	/** Pearson correlation of continuous scores (-1..1; 0 if no variance). */
	pearson: number
	confusion: { truePos: number; trueNeg: number; falsePos: number; falseNeg: number }
	/** Landis–Koch interpretation of kappa. */
	strength: AgreementStrength
}

function interpretKappa(kappa: number): AgreementStrength {
	if (kappa < 0.2) return 'poor'
	if (kappa < 0.4) return 'fair'
	if (kappa < 0.6) return 'moderate'
	if (kappa < 0.8) return 'substantial'
	return 'almost-perfect'
}

function pearson(xs: number[], ys: number[]): number {
	const n = xs.length
	const mx = xs.reduce((a, b) => a + b, 0) / n
	const my = ys.reduce((a, b) => a + b, 0) / n
	let cov = 0
	let vx = 0
	let vy = 0
	for (let i = 0; i < n; i++) {
		const dx = xs[i] - mx
		const dy = ys[i] - my
		cov += dx * dy
		vx += dx * dx
		vy += dy * dy
	}
	if (vx === 0 || vy === 0) return 0
	return cov / Math.sqrt(vx * vy)
}

type Confusion = { truePos: number; trueNeg: number; falsePos: number; falseNeg: number }

function buildConfusion(pairs: AlignmentPair[], threshold: number): Confusion {
	const c: Confusion = { truePos: 0, trueNeg: 0, falsePos: 0, falseNeg: 0 }
	for (const { human, judge } of pairs) {
		const h = human >= threshold ? 1 : 0
		const j = judge >= threshold ? 1 : 0
		if (h === 1 && j === 1) c.truePos++
		else if (h === 0 && j === 0) c.trueNeg++
		else if (h === 0 && j === 1) c.falsePos++
		else c.falseNeg++
	}
	return c
}

/**
 * Compute alignment between human and judge scores. Pure — no I/O.
 */
export function computeJudgeAlignment(
	pairs: AlignmentPair[],
	options: JudgeAlignmentOptions = {},
): JudgeAlignmentResult {
	if (pairs.length === 0) {
		throw new Error('computeJudgeAlignment requires at least one pair')
	}
	const threshold = options.threshold ?? 0.5
	const n = pairs.length

	const humanScores = pairs.map((p) => p.human)
	const judgeScores = pairs.map((p) => p.judge)
	const absErr = pairs.reduce((sum, p) => sum + Math.abs(p.human - p.judge), 0)
	const { truePos, trueNeg, falsePos, falseNeg } = buildConfusion(pairs, threshold)

	const agreementRate = (truePos + trueNeg) / n
	// Expected agreement by chance (Cohen's kappa).
	const pJudgePos = (truePos + falsePos) / n
	const pHumanPos = (truePos + falseNeg) / n
	const pe = pJudgePos * pHumanPos + (1 - pJudgePos) * (1 - pHumanPos)
	const cohenKappa = pe === 1 ? (agreementRate === 1 ? 1 : 0) : (agreementRate - pe) / (1 - pe)

	return {
		n,
		threshold,
		agreementRate,
		cohenKappa,
		meanAbsoluteError: absErr / n,
		pearson: pearson(humanScores, judgeScores),
		confusion: { truePos, trueNeg, falsePos, falseNeg },
		strength: interpretKappa(cohenKappa),
	}
}

export interface LabeledJudgeCase {
	input?: string
	output: string
	/** Human ground-truth score (0..1). */
	humanScore: number
}

export type JudgeScorer = (output: string, input?: string) => Promise<number> | number

/**
 * Run a scorer (e.g. `createRubricJudge(...).evaluate`) over human-labeled cases
 * and report how well it aligns with the human scores.
 */
export async function runJudgeAlignment(
	cases: LabeledJudgeCase[],
	scorer: JudgeScorer,
	options: JudgeAlignmentOptions = {},
): Promise<JudgeAlignmentResult & { pairs: AlignmentPair[] }> {
	const pairs: AlignmentPair[] = []
	for (const c of cases) {
		const judge = await scorer(c.output, c.input)
		pairs.push({ human: c.humanScore, judge })
	}
	return { ...computeJudgeAlignment(pairs, options), pairs }
}

export interface JudgeConsistencyOptions {
	/** How many times to re-run the judge. Default 5. */
	runs?: number
	/** Max acceptable range (max-min) for the judge to be "consistent". Default 0.1. */
	tolerance?: number
}

export interface JudgeConsistencyResult {
	runs: number
	mean: number
	stdDev: number
	min: number
	max: number
	range: number
	consistent: boolean
	scores: number[]
}

/**
 * Re-run a judge on the SAME input N times and measure how much it disagrees
 * with itself — the judge's own reliability, independent of ground-truth.
 */
export async function assessJudgeConsistency(
	scorer: () => Promise<number> | number,
	options: JudgeConsistencyOptions = {},
): Promise<JudgeConsistencyResult> {
	const runs = options.runs ?? 5
	const tolerance = options.tolerance ?? 0.1
	const scores: number[] = []
	for (let i = 0; i < runs; i++) scores.push(await scorer())

	const mean = scores.reduce((a, b) => a + b, 0) / runs
	const variance = scores.reduce((a, b) => a + (b - mean) ** 2, 0) / runs
	const min = Math.min(...scores)
	const max = Math.max(...scores)
	const range = max - min

	return {
		runs,
		mean,
		stdDev: Math.sqrt(variance),
		min,
		max,
		range,
		consistent: range <= tolerance,
		scores,
	}
}
