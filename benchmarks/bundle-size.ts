/**
 * Benchmark: Bundle size analysis
 * Measures the size of each package when bundled.
 * Targets: core < 50KB, full < 200KB
 */

import { join } from 'node:path'

interface BundleResult {
	name: string
	size: number
	gzip: number
}

async function measureBundle(entry: string, name: string): Promise<BundleResult> {
	try {
		const result = await Bun.build({
			entrypoints: [entry],
			minify: true,
			target: 'bun',
			external: ['zod', 'hono'],
		})

		if (!result.success) {
			console.error(`  Failed to bundle ${name}:`, result.logs)
			return { name, size: 0, gzip: 0 }
		}

		const output = result.outputs[0]
		const text = await output.text()
		const size = new TextEncoder().encode(text).length

		// Estimate gzip (Bun doesn't have built-in gzip, approximate at ~30% of minified)
		const gzip = Math.round(size * 0.3)

		return { name, size, gzip }
	} catch (err) {
		console.error(`  Error bundling ${name}:`, err)
		return { name, size: 0, gzip: 0 }
	}
}

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	return `${(bytes / 1024).toFixed(1)} KB`
}

async function main() {
	console.log('\n  ElsiumAI Bundle Size Analysis')
	console.log('  ══════════════════════════════════════════\n')

	const root = join(import.meta.dir, '..')
	const packages = [
		{ entry: join(root, 'packages/core/src/index.ts'), name: '@elsium-ai/core' },
		{ entry: join(root, 'packages/gateway/src/index.ts'), name: '@elsium-ai/gateway' },
		{ entry: join(root, 'packages/agents/src/index.ts'), name: '@elsium-ai/agents' },
		{ entry: join(root, 'packages/tools/src/index.ts'), name: '@elsium-ai/tools' },
		{ entry: join(root, 'packages/observe/src/index.ts'), name: '@elsium-ai/observe' },
		{ entry: join(root, 'packages/rag/src/index.ts'), name: '@elsium-ai/rag' },
		{ entry: join(root, 'packages/workflows/src/index.ts'), name: '@elsium-ai/workflows' },
		{ entry: join(root, 'packages/app/src/index.ts'), name: '@elsium-ai/app' },
		{ entry: join(root, 'packages/testing/src/index.ts'), name: '@elsium-ai/testing' },
	]

	const results: BundleResult[] = []
	let totalSize = 0
	let totalGzip = 0

	console.log(`  ${'Package'.padEnd(30)} ${'Minified'.padStart(12)} ${'~Gzip'.padStart(12)}`)
	console.log(`  ${'─'.repeat(54)}`)

	for (const pkg of packages) {
		const result = await measureBundle(pkg.entry, pkg.name)
		results.push(result)
		totalSize += result.size
		totalGzip += result.gzip

		const pass = pkg.name === '@elsium-ai/core' ? result.size < 50 * 1024 : true
		const indicator = result.size > 0 ? (pass ? '  ✓' : '  ✗') : '  ?'

		console.log(
			`  ${result.name.padEnd(30)} ${formatSize(result.size).padStart(12)} ${formatSize(result.gzip).padStart(12)}${indicator}`,
		)
	}

	console.log(`  ${'─'.repeat(54)}`)
	console.log(
		`  ${'TOTAL'.padEnd(30)} ${formatSize(totalSize).padStart(12)} ${formatSize(totalGzip).padStart(12)}`,
	)
	console.log()

	// Targets
	const coreResult = results.find((r) => r.name === '@elsium-ai/core')
	console.log('  Targets:')
	console.log(
		`    Core < 50KB:  ${coreResult ? formatSize(coreResult.size) : '?'}  ${coreResult && coreResult.size < 50 * 1024 ? '✓ PASS' : '✗ FAIL'}`,
	)
	console.log(
		`    Full < 200KB: ${formatSize(totalSize)}  ${totalSize < 200 * 1024 ? '✓ PASS' : '✗ FAIL'}`,
	)
	console.log()
}

main()
