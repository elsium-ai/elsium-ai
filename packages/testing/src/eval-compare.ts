import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { EvalSuiteResult } from './eval'

export interface EvalBaseline {
	name: string
	timestamp: number
	score: number
	results: Array<{ name: string; passed: boolean; score: number }>
}

export interface EvalComparison {
	baselineName: string
	currentName: string
	baselineScore: number
	currentScore: number
	delta: number
	regressions: Array<{ name: string; baselineScore: number; currentScore: number }>
	improvements: Array<{ name: string; baselineScore: number; currentScore: number }>
	regression: boolean
}

export async function saveBaseline(result: EvalSuiteResult, dir: string): Promise<string> {
	await mkdir(dir, { recursive: true })

	const baseline: EvalBaseline = {
		name: result.name,
		timestamp: Date.now(),
		score: result.score,
		results: result.results.map((r) => ({
			name: r.name,
			passed: r.passed,
			score: r.score,
		})),
	}

	const filePath = join(dir, `${result.name}.baseline.json`)
	await writeFile(filePath, JSON.stringify(baseline, null, '\t'), 'utf-8')
	return filePath
}

export async function loadBaseline(name: string, dir: string): Promise<EvalBaseline | null> {
	const filePath = join(dir, `${name}.baseline.json`)
	try {
		const content = await readFile(filePath, 'utf-8')
		return JSON.parse(content) as EvalBaseline
	} catch {
		return null
	}
}

export function compareResults(baseline: EvalBaseline, current: EvalSuiteResult): EvalComparison {
	const baselineMap = new Map(baseline.results.map((r) => [r.name, r]))

	const regressions: Array<{ name: string; baselineScore: number; currentScore: number }> = []
	const improvements: Array<{ name: string; baselineScore: number; currentScore: number }> = []

	for (const result of current.results) {
		const baselineResult = baselineMap.get(result.name)
		if (!baselineResult) continue

		if (result.score < baselineResult.score) {
			regressions.push({
				name: result.name,
				baselineScore: baselineResult.score,
				currentScore: result.score,
			})
		} else if (result.score > baselineResult.score) {
			improvements.push({
				name: result.name,
				baselineScore: baselineResult.score,
				currentScore: result.score,
			})
		}
	}

	const delta = current.score - baseline.score
	const hasFailedRegression = current.results.some((r) => {
		const base = baselineMap.get(r.name)
		return base?.passed && !r.passed
	})

	return {
		baselineName: baseline.name,
		currentName: current.name,
		baselineScore: baseline.score,
		currentScore: current.score,
		delta,
		regressions,
		improvements,
		regression: delta < 0 || hasFailedRegression,
	}
}

export function formatComparison(comparison: EvalComparison): string {
	const lines: string[] = []
	const deltaSign = comparison.delta >= 0 ? '+' : ''
	const deltaPercent = `${deltaSign}${(comparison.delta * 100).toFixed(1)}%`

	lines.push(`\n  Comparison: ${comparison.baselineName} -> ${comparison.currentName}`)
	lines.push(`  ${'─'.repeat(50)}`)
	lines.push(
		`  Baseline: ${(comparison.baselineScore * 100).toFixed(1)}% | Current: ${(comparison.currentScore * 100).toFixed(1)}% | Delta: ${deltaPercent}`,
	)

	if (comparison.regressions.length > 0) {
		lines.push(`\n  Regressions (${comparison.regressions.length}):`)
		for (const r of comparison.regressions) {
			lines.push(
				`    - ${r.name}: ${(r.baselineScore * 100).toFixed(1)}% -> ${(r.currentScore * 100).toFixed(1)}%`,
			)
		}
	}

	if (comparison.improvements.length > 0) {
		lines.push(`\n  Improvements (${comparison.improvements.length}):`)
		for (const imp of comparison.improvements) {
			lines.push(
				`    + ${imp.name}: ${(imp.baselineScore * 100).toFixed(1)}% -> ${(imp.currentScore * 100).toFixed(1)}%`,
			)
		}
	}

	lines.push(`  ${'─'.repeat(50)}`)
	lines.push(`  Result: ${comparison.regression ? 'REGRESSION DETECTED' : 'OK'}`)
	lines.push('')

	return lines.join('\n')
}
