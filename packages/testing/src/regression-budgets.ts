/**
 * Per-case regression budgets (O3).
 *
 * Extension of regression.ts where each baseline case carries its own
 * tolerance + maxDelta budget. The legacy regression suite uses a
 * hard-coded 0.1 delta threshold for everyone, which is the wrong
 * answer when:
 *  - Some test cases are deterministic single-token answers
 *    (tolerance ~0)
 *  - Other test cases are summaries / open-ended (tolerance ~0.2+)
 *  - Important customer-flagged cases warrant tighter budgets
 *
 * Backwards compatible: defaults are taken from `defaults` config, and
 * cases without explicit budgets use those. No change to the v0.x
 * regression.ts API.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { ElsiumError } from '@elsium-ai/core'

// ─── Data model ─────────────────────────────────────────────────

export interface BudgetedRegressionCase {
	readonly input: string
	readonly output: string
	readonly score: number
	readonly timestamp: number
	/** Acceptable absolute drop in score before it counts as a regression. Default 0.1. */
	readonly tolerance?: number
	/** Hard cap on drop. If exceeded, the result is flagged 'critical'. Default 0.3. */
	readonly maxDelta?: number
	/** Optional tags for grouping in reports. */
	readonly tags?: readonly string[]
}

export interface BudgetedRegressionBaseline {
	readonly name: string
	readonly cases: readonly BudgetedRegressionCase[]
	readonly defaults: { readonly tolerance: number; readonly maxDelta: number }
	readonly createdAt: number
	readonly updatedAt: number
}

export type CaseOutcome = 'unchanged' | 'improved' | 'regression' | 'critical'

export interface BudgetedCaseResult {
	readonly input: string
	readonly baselineOutput: string
	readonly currentOutput: string
	readonly baselineScore: number
	readonly currentScore: number
	readonly delta: number
	readonly tolerance: number
	readonly maxDelta: number
	readonly outcome: CaseOutcome
	readonly tags: readonly string[]
}

export interface BudgetedRegressionReport {
	readonly name: string
	readonly totalCases: number
	readonly byOutcome: Record<CaseOutcome, number>
	readonly criticalCases: readonly BudgetedCaseResult[]
	readonly regressionCases: readonly BudgetedCaseResult[]
	readonly improvedCases: readonly BudgetedCaseResult[]
	readonly perCase: readonly BudgetedCaseResult[]
	readonly overallScore: number
	readonly baselineScore: number
}

export interface BudgetedRegressionSuite {
	load(path: string): Promise<void>
	save(path: string): Promise<void>
	addCase(c: Omit<BudgetedRegressionCase, 'timestamp'>): void
	setDefaults(defaults: { tolerance: number; maxDelta: number }): void
	run(
		runner: (input: string) => Promise<string>,
		scorer?: (input: string, output: string) => Promise<number>,
	): Promise<BudgetedRegressionReport>
	readonly baseline: BudgetedRegressionBaseline | null
}

// ─── Implementation ─────────────────────────────────────────────

const DEFAULT_TOLERANCE = 0.1
const DEFAULT_MAX_DELTA = 0.3

function defaultScorer(_input: string, currentOutput: string, baselineOutput: string): number {
	return currentOutput === baselineOutput ? 1 : 0.5
}

function classify(delta: number, tolerance: number, maxDelta: number): CaseOutcome {
	if (delta > tolerance) return 'improved'
	if (Math.abs(delta) <= tolerance) return 'unchanged'
	// delta < -tolerance
	if (-delta >= maxDelta) return 'critical'
	return 'regression'
}

async function evaluateCase(
	c: BudgetedRegressionCase,
	defaults: { tolerance: number; maxDelta: number },
	runner: (input: string) => Promise<string>,
	scorer?: (input: string, output: string) => Promise<number>,
): Promise<BudgetedCaseResult> {
	const currentOutput = await runner(c.input)
	const currentScore = scorer
		? await scorer(c.input, currentOutput)
		: defaultScorer(c.input, currentOutput, c.output)
	const tolerance = c.tolerance ?? defaults.tolerance
	const maxDelta = c.maxDelta ?? defaults.maxDelta
	const delta = currentScore - c.score
	return {
		input: c.input,
		baselineOutput: c.output,
		currentOutput,
		baselineScore: c.score,
		currentScore,
		delta,
		tolerance,
		maxDelta,
		outcome: classify(delta, tolerance, maxDelta),
		tags: c.tags ?? [],
	}
}

function emptyReport(name: string): BudgetedRegressionReport {
	return {
		name,
		totalCases: 0,
		byOutcome: { unchanged: 0, improved: 0, regression: 0, critical: 0 },
		criticalCases: [],
		regressionCases: [],
		improvedCases: [],
		perCase: [],
		overallScore: 0,
		baselineScore: 0,
	}
}

export function createBudgetedRegressionSuite(name: string): BudgetedRegressionSuite {
	let baseline: BudgetedRegressionBaseline | null = null

	function ensureBaseline(): BudgetedRegressionBaseline {
		if (baseline) return baseline
		baseline = {
			name,
			cases: [],
			defaults: { tolerance: DEFAULT_TOLERANCE, maxDelta: DEFAULT_MAX_DELTA },
			createdAt: Date.now(),
			updatedAt: Date.now(),
		}
		return baseline
	}

	return {
		get baseline() {
			return baseline
		},

		async load(path: string): Promise<void> {
			try {
				const data = readFileSync(path, 'utf-8')
				baseline = JSON.parse(data) as BudgetedRegressionBaseline
			} catch {
				baseline = null
			}
		},

		async save(path: string): Promise<void> {
			const b = ensureBaseline()
			mkdirSync(dirname(path), { recursive: true })
			writeFileSync(path, JSON.stringify(b, null, 2))
		},

		addCase(c) {
			const b = ensureBaseline()
			const cases = [...b.cases]
			const existingIdx = cases.findIndex((x) => x.input === c.input)
			const next: BudgetedRegressionCase = { ...c, timestamp: Date.now() }
			if (existingIdx >= 0) cases[existingIdx] = next
			else cases.push(next)
			baseline = { ...b, cases, updatedAt: Date.now() }
		},

		setDefaults(defaults) {
			if (defaults.tolerance < 0 || defaults.tolerance > 1) {
				throw ElsiumError.validation('tolerance must be in [0, 1]')
			}
			if (defaults.maxDelta < 0 || defaults.maxDelta > 1) {
				throw ElsiumError.validation('maxDelta must be in [0, 1]')
			}
			if (defaults.maxDelta < defaults.tolerance) {
				throw ElsiumError.validation('maxDelta must be >= tolerance')
			}
			const b = ensureBaseline()
			baseline = { ...b, defaults, updatedAt: Date.now() }
		},

		async run(runner, scorer) {
			if (!baseline || baseline.cases.length === 0) return emptyReport(name)
			const snapshot = baseline

			const perCase = await Promise.all(
				snapshot.cases.map((c) => evaluateCase(c, snapshot.defaults, runner, scorer)),
			)

			const byOutcome: Record<CaseOutcome, number> = {
				unchanged: 0,
				improved: 0,
				regression: 0,
				critical: 0,
			}
			for (const r of perCase) byOutcome[r.outcome]++

			const baselineScore = baseline.cases.reduce((s, c) => s + c.score, 0) / baseline.cases.length
			const overallScore = perCase.reduce((s, r) => s + r.currentScore, 0) / perCase.length

			return {
				name,
				totalCases: perCase.length,
				byOutcome,
				criticalCases: perCase.filter((r) => r.outcome === 'critical'),
				regressionCases: perCase.filter((r) => r.outcome === 'regression'),
				improvedCases: perCase.filter((r) => r.outcome === 'improved'),
				perCase,
				overallScore,
				baselineScore,
			}
		},
	}
}
