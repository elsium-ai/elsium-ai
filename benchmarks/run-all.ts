#!/usr/bin/env bun

/**
 * Run all ElsiumAI benchmarks
 */

import { spawn } from 'node:child_process'
import { join } from 'node:path'

const benchmarks = [
	{ name: 'Startup', file: 'startup.ts' },
	{ name: 'Throughput', file: 'throughput.ts' },
	{ name: 'Memory', file: 'memory.ts' },
	{ name: 'Bundle Size', file: 'bundle-size.ts' },
]

function runBenchmark(file: string): Promise<number> {
	return new Promise((resolve) => {
		const child = spawn('bun', [join(import.meta.dir, file)], {
			stdio: 'inherit',
			cwd: import.meta.dir,
		})
		child.on('exit', (code) => resolve(code ?? 0))
	})
}

async function main() {
	console.log('\n  ╔══════════════════════════════════════════╗')
	console.log('  ║       ElsiumAI Performance Report        ║')
	console.log('  ╚══════════════════════════════════════════╝')

	for (const bench of benchmarks) {
		await runBenchmark(bench.file)
	}

	console.log('  ══════════════════════════════════════════')
	console.log('  Benchmark suite complete.\n')
}

main()
