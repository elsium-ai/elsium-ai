#!/usr/bin/env bun

/**
 * Benchmark Regression Checker
 *
 * Compares latest.json against a frozen baseline.
 * Exits with code 1 if any metric regresses beyond the allowed tolerance.
 *
 * Usage:
 *   bun benchmarks/check-regression.ts                    # compare latest vs baseline
 *   bun benchmarks/check-regression.ts --freeze v0.1.0    # freeze current latest as baseline
 *   bun benchmarks/check-regression.ts --tolerance 0.3    # allow 30% regression (default: 20%)
 */

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const RESULTS_DIR = join(import.meta.dir, 'results')
const LATEST_PATH = join(RESULTS_DIR, 'latest.json')
const BASELINE_PATH = join(RESULTS_DIR, 'baseline.json')

// ─── Types ──────────────────────────────────────────────────────

interface BenchmarkStats {
	p50: number
	p95: number
	p99: number
	avg: number
	opsPerSec: number
	samples: number
}

interface BenchmarkResults {
	version: string
	timestamp: string
	environment: Record<string, string>
	scenarios: Record<string, BenchmarkStats>
	middleware: Record<string, BenchmarkStats>
	memory: {
		heapGrowth10k: number
		perRequestBytes: number
		rss10k: number
	}
	thresholds: Record<
		string,
		{
			limit: number
			unit: string
			actual: number
		}
	>
}

// ─── CLI Parsing ────────────────────────────────────────────────

const args = process.argv.slice(2)
const freezeIndex = args.indexOf('--freeze')
const toleranceIndex = args.indexOf('--tolerance')

const freezeVersion = freezeIndex !== -1 ? args[freezeIndex + 1] : null
const tolerance = toleranceIndex !== -1 ? Number.parseFloat(args[toleranceIndex + 1]) : 0.2

// ─── Freeze Mode ────────────────────────────────────────────────

if (freezeVersion) {
	if (!existsSync(LATEST_PATH)) {
		console.error('  ✗ No latest.json found. Run the benchmark first:')
		console.error('    bun benchmarks/framework-overhead.ts')
		process.exit(1)
	}

	const latest = JSON.parse(readFileSync(LATEST_PATH, 'utf-8'))
	latest.version = freezeVersion
	latest.frozenAt = new Date().toISOString()

	const versionPath = join(RESULTS_DIR, `${freezeVersion}.json`)
	writeFileSync(versionPath, JSON.stringify(latest, null, '\t'))
	copyFileSync(LATEST_PATH, BASELINE_PATH)

	// Update baseline to include version tag
	const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'))
	baseline.version = freezeVersion
	baseline.frozenAt = latest.frozenAt
	writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, '\t'))

	console.log()
	console.log(`  ✓ Baseline frozen as ${freezeVersion}`)
	console.log(`    ${versionPath}`)
	console.log(`    ${BASELINE_PATH}`)
	console.log()
	process.exit(0)
}

// ─── Regression Check Mode ──────────────────────────────────────

if (!existsSync(BASELINE_PATH)) {
	console.error('  ✗ No baseline.json found. Freeze a baseline first:')
	console.error('    bun benchmarks/check-regression.ts --freeze v0.1.0')
	process.exit(1)
}

if (!existsSync(LATEST_PATH)) {
	console.error('  ✗ No latest.json found. Run the benchmark first:')
	console.error('    bun benchmarks/framework-overhead.ts')
	process.exit(1)
}

const baseline: BenchmarkResults = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'))
const latest: BenchmarkResults = JSON.parse(readFileSync(LATEST_PATH, 'utf-8'))

console.log()
console.log('  ╔══════════════════════════════════════════════════════════════════╗')
console.log('  ║          ElsiumAI Benchmark Regression Check                    ║')
console.log('  ╚══════════════════════════════════════════════════════════════════╝')
console.log()
console.log(`  Baseline:    ${baseline.version} (${baseline.timestamp})`)
console.log(`  Current:     ${latest.version} (${latest.timestamp})`)
console.log(`  Tolerance:   ${(tolerance * 100).toFixed(0)}% regression allowed`)
console.log()

// ─── Compare ────────────────────────────────────────────────────

interface CheckResult {
	name: string
	metric: string
	baseline: number
	current: number
	change: number
	pass: boolean
}

const checks: CheckResult[] = []

function checkLatency(
	name: string,
	baselineStats: BenchmarkStats | undefined,
	currentStats: BenchmarkStats | undefined,
) {
	if (!baselineStats || !currentStats) return

	// P99 is informational only — too noisy at microsecond scale for regression gating.
	// P50 and P95 are enforced.
	for (const metric of ['p50', 'p95', 'p99'] as const) {
		const base = baselineStats[metric]
		const curr = currentStats[metric]
		if (base === 0) continue
		const change = (curr - base) / base
		const enforced = metric !== 'p99'
		checks.push({
			name,
			metric,
			baseline: base,
			current: curr,
			change,
			pass: enforced ? change <= tolerance : true,
		})
	}
}

function checkMemory(name: string, base: number, curr: number) {
	if (base === 0) return
	const change = (curr - base) / base
	checks.push({
		name: 'memory',
		metric: name,
		baseline: base,
		current: curr,
		change,
		pass: change <= tolerance,
	})
}

// Scenario checks
for (const key of Object.keys(baseline.scenarios)) {
	checkLatency(key, baseline.scenarios[key], latest.scenarios[key])
}

// Middleware checks
for (const key of Object.keys(baseline.middleware)) {
	checkLatency(`middleware.${key}`, baseline.middleware[key], latest.middleware[key])
}

// Memory checks
checkMemory('heapGrowth10k', baseline.memory.heapGrowth10k, latest.memory.heapGrowth10k)
checkMemory('perRequestBytes', baseline.memory.perRequestBytes, latest.memory.perRequestBytes)

// ─── Report ─────────────────────────────────────────────────────

function fmtMs(ms: number): string {
	return ms < 0.01 ? `${(ms * 1000).toFixed(1)}μs` : `${ms.toFixed(3)}ms`
}

function fmtChange(change: number): string {
	const pct = (change * 100).toFixed(1)
	if (change <= -0.05) return `\x1b[32m${pct}%\x1b[0m` // green = faster
	if (change <= tolerance) return `\x1b[33m+${pct}%\x1b[0m` // yellow = within tolerance
	return `\x1b[31m+${pct}%\x1b[0m` // red = regression
}

function fmtValue(name: string, value: number): string {
	if (name === 'memory') {
		if (value > 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)}MB`
		if (value > 1024) return `${(value / 1024).toFixed(1)}KB`
		return `${value}B`
	}
	return fmtMs(value)
}

const failures = checks.filter((c) => !c.pass)
const improvements = checks.filter((c) => c.change < -0.05)

console.log(
	`  ${'Scenario'.padEnd(28)} ${'Metric'.padEnd(6)} ${'Baseline'.padStart(10)} ${'Current'.padStart(10)} ${'Change'.padStart(10)}  Status`,
)
console.log(`  ${'─'.repeat(80)}`)

for (const c of checks) {
	const status = c.pass ? (c.change < -0.05 ? '  ↑' : '  ✓') : '  ✗ REGRESSION'
	console.log(
		`  ${c.name.padEnd(28)} ${c.metric.padEnd(6)} ${fmtValue(c.name, c.baseline).padStart(10)} ${fmtValue(c.name, c.current).padStart(10)} ${fmtChange(c.change).padStart(20)}${status}`,
	)
}

console.log()

if (improvements.length > 0) {
	console.log(`  ↑ ${improvements.length} metric(s) improved (>5% faster)`)
}

if (failures.length > 0) {
	console.log(`  ✗ ${failures.length} REGRESSION(S) DETECTED`)
	console.log()
	for (const f of failures) {
		console.log(
			`    ${f.name}.${f.metric}: ${fmtValue(f.name, f.baseline)} → ${fmtValue(f.name, f.current)} (+${(f.change * 100).toFixed(1)}% > ${(tolerance * 100).toFixed(0)}% tolerance)`,
		)
	}
	console.log()
	process.exit(1)
} else {
	console.log('  ✓ No regressions detected.')
	console.log()
}
