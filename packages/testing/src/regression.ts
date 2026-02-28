import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface RegressionBaseline {
	name: string
	cases: Array<{
		input: string
		output: string
		score: number
		timestamp: number
	}>
	createdAt: number
	updatedAt: number
}

export interface RegressionResult {
	name: string
	totalCases: number
	regressions: RegressionDetail[]
	improvements: RegressionDetail[]
	unchanged: number
	overallScore: number
	baselineScore: number
}

export interface RegressionDetail {
	input: string
	baselineOutput: string
	currentOutput: string
	baselineScore: number
	currentScore: number
	delta: number
}

export interface RegressionSuite {
	load(path: string): Promise<void>
	save(path: string): Promise<void>
	run(
		runner: (input: string) => Promise<string>,
		scorer?: (input: string, output: string) => Promise<number>,
	): Promise<RegressionResult>
	addCase(input: string, output: string, score: number): void
	readonly baseline: RegressionBaseline | null
}

function makeEmptyResult(name: string): RegressionResult {
	return {
		name,
		totalCases: 0,
		regressions: [],
		improvements: [],
		unchanged: 0,
		overallScore: 0,
		baselineScore: 0,
	}
}

async function scoreCase(
	input: string,
	currentOutput: string,
	baselineOutput: string,
	scorer?: (input: string, output: string) => Promise<number>,
): Promise<number> {
	if (scorer) return scorer(input, currentOutput)
	return currentOutput === baselineOutput ? 1 : 0.5
}

function classifyDetail(
	detail: RegressionDetail,
	regressions: RegressionDetail[],
	improvements: RegressionDetail[],
): boolean {
	if (detail.delta < -0.1) {
		regressions.push(detail)
		return false
	}
	if (detail.delta > 0.1) {
		improvements.push(detail)
		return false
	}
	return true
}

async function compareWithBaseline(
	name: string,
	baseline: RegressionBaseline,
	runner: (input: string) => Promise<string>,
	scorer?: (input: string, output: string) => Promise<number>,
): Promise<RegressionResult> {
	const regressions: RegressionDetail[] = []
	const improvements: RegressionDetail[] = []
	let unchanged = 0
	let totalCurrentScore = 0

	const baselineScore = baseline.cases.reduce((sum, c) => sum + c.score, 0) / baseline.cases.length

	for (const baselineCase of baseline.cases) {
		const currentOutput = await runner(baselineCase.input)
		const currentScore = await scoreCase(
			baselineCase.input,
			currentOutput,
			baselineCase.output,
			scorer,
		)

		totalCurrentScore += currentScore

		const detail: RegressionDetail = {
			input: baselineCase.input,
			baselineOutput: baselineCase.output,
			currentOutput,
			baselineScore: baselineCase.score,
			currentScore,
			delta: currentScore - baselineCase.score,
		}

		if (classifyDetail(detail, regressions, improvements)) {
			unchanged++
		}
	}

	return {
		name,
		totalCases: baseline.cases.length,
		regressions,
		improvements,
		unchanged,
		overallScore: totalCurrentScore / baseline.cases.length,
		baselineScore,
	}
}

export function createRegressionSuite(name: string): RegressionSuite {
	let baseline: RegressionBaseline | null = null

	return {
		get baseline() {
			return baseline
		},

		async load(path: string): Promise<void> {
			try {
				const data = readFileSync(path, 'utf-8')
				baseline = JSON.parse(data) as RegressionBaseline
			} catch {
				baseline = null
			}
		},

		async save(path: string): Promise<void> {
			if (!baseline) {
				baseline = {
					name,
					cases: [],
					createdAt: Date.now(),
					updatedAt: Date.now(),
				}
			}

			mkdirSync(dirname(path), { recursive: true })
			writeFileSync(path, JSON.stringify(baseline, null, 2))
		},

		addCase(input: string, output: string, score: number): void {
			if (!baseline) {
				baseline = {
					name,
					cases: [],
					createdAt: Date.now(),
					updatedAt: Date.now(),
				}
			}

			const existing = baseline.cases.findIndex((c) => c.input === input)
			if (existing >= 0) {
				baseline.cases[existing] = { input, output, score, timestamp: Date.now() }
			} else {
				baseline.cases.push({ input, output, score, timestamp: Date.now() })
			}
			baseline.updatedAt = Date.now()
		},

		async run(
			runner: (input: string) => Promise<string>,
			scorer?: (input: string, output: string) => Promise<number>,
		): Promise<RegressionResult> {
			if (!baseline || baseline.cases.length === 0) {
				return makeEmptyResult(name)
			}

			return compareWithBaseline(name, baseline, runner, scorer)
		},
	}
}
