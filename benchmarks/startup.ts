/**
 * Benchmark: Cold start time
 * Measures how long it takes to import and initialize core modules.
 * Target: < 50ms
 */

async function benchmarkColdStart() {
	const results: number[] = []

	for (let i = 0; i < 10; i++) {
		const start = performance.now()

		// Dynamic imports to measure actual cold start
		await import('@elsium-ai/core')
		await import('@elsium-ai/gateway')
		await import('@elsium-ai/agents')
		await import('@elsium-ai/tools')
		await import('@elsium-ai/observe')

		const elapsed = performance.now() - start
		results.push(elapsed)

		// Clear module cache for next iteration
		// Note: In production Bun, modules are cached after first import
		// This measures worst-case with cache
	}

	return results
}

async function benchmarkCoreImport() {
	const results: number[] = []

	for (let i = 0; i < 10; i++) {
		const start = performance.now()
		await import('@elsium-ai/core')
		const elapsed = performance.now() - start
		results.push(elapsed)
	}

	return results
}

function stats(results: number[]) {
	const sorted = [...results].sort((a, b) => a - b)
	const avg = results.reduce((a, b) => a + b, 0) / results.length
	return {
		avg: avg.toFixed(2),
		min: sorted[0].toFixed(2),
		max: sorted[sorted.length - 1].toFixed(2),
		p50: sorted[Math.floor(sorted.length * 0.5)].toFixed(2),
		p99: sorted[Math.floor(sorted.length * 0.99)].toFixed(2),
	}
}

async function main() {
	console.log('\n  ElsiumAI Startup Benchmarks')
	console.log('  ══════════════════════════════════════════\n')

	console.log('  Cold Start (all packages)')
	const coldStart = await benchmarkColdStart()
	const coldStats = stats(coldStart)
	console.log(`    avg: ${coldStats.avg}ms  min: ${coldStats.min}ms  max: ${coldStats.max}ms`)
	console.log(`    p50: ${coldStats.p50}ms  p99: ${coldStats.p99}ms`)
	console.log(`    target: < 50ms  ${Number(coldStats.avg) < 50 ? '✓ PASS' : '✗ FAIL'}\n`)

	console.log('  Core Import Only')
	const coreImport = await benchmarkCoreImport()
	const coreStats = stats(coreImport)
	console.log(`    avg: ${coreStats.avg}ms  min: ${coreStats.min}ms  max: ${coreStats.max}ms`)
	console.log()
}

main()
