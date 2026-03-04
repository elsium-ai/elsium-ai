#!/usr/bin/env bun

/**
 * Fetches npm download stats for all ElsiumAI packages.
 *
 * Usage:
 *   bun scripts/stats.ts
 */

const PACKAGES = [
	'elsium-ai',
	'@elsium-ai/core',
	'@elsium-ai/gateway',
	'@elsium-ai/agents',
	'@elsium-ai/tools',
	'@elsium-ai/rag',
	'@elsium-ai/workflows',
	'@elsium-ai/observe',
	'@elsium-ai/app',
	'@elsium-ai/client',
	'@elsium-ai/mcp',
	'@elsium-ai/testing',
	'@elsium-ai/cli',
]

const PERIODS = ['last-day', 'last-week', 'last-month'] as const

interface DownloadResponse {
	downloads: number
	package: string
}

async function fetchDownloads(pkg: string, period: string): Promise<number> {
	try {
		const res = await fetch(`https://api.npmjs.org/downloads/point/${period}/${pkg}`)
		if (!res.ok) return 0
		const data = (await res.json()) as DownloadResponse
		return data.downloads ?? 0
	} catch {
		return 0
	}
}

async function main() {
	console.log()
	console.log('  ElsiumAI Downloads')
	console.log('  ══════════════════════════════════════════════════════════')
	console.log()
	console.log(
		`  ${'Package'.padEnd(28)} ${'Day'.padStart(8)} ${'Week'.padStart(8)} ${'Month'.padStart(8)}`,
	)
	console.log(`  ${'─'.repeat(28)} ${'─'.repeat(8)} ${'─'.repeat(8)} ${'─'.repeat(8)}`)

	let totalDay = 0
	let totalWeek = 0
	let totalMonth = 0

	for (const pkg of PACKAGES) {
		const [day, week, month] = await Promise.all(PERIODS.map((p) => fetchDownloads(pkg, p)))

		totalDay += day
		totalWeek += week
		totalMonth += month

		console.log(
			`  ${pkg.padEnd(28)} ${String(day).padStart(8)} ${String(week).padStart(8)} ${String(month).padStart(8)}`,
		)
	}

	console.log(`  ${'─'.repeat(28)} ${'─'.repeat(8)} ${'─'.repeat(8)} ${'─'.repeat(8)}`)
	console.log(
		`  ${'TOTAL'.padEnd(28)} ${String(totalDay).padStart(8)} ${String(totalWeek).padStart(8)} ${String(totalMonth).padStart(8)}`,
	)
	console.log()
}

main()
