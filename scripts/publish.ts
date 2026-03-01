#!/usr/bin/env bun

/**
 * Publish script for ElsiumAI monorepo.
 *
 * Replaces `workspace:*` dependencies with real versions before publishing,
 * then restores them afterwards. Publishes packages in dependency order.
 *
 * Usage:
 *   bun scripts/publish.ts                    # publish all packages
 *   bun scripts/publish.ts --dry-run          # preview without publishing
 *   bun scripts/publish.ts --registry npm     # publish to npm (default: github)
 */

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const PACKAGES_DIR = join(ROOT, 'packages')

// Publish order: dependencies first, dependents last
const PUBLISH_ORDER = [
	'core',
	'tools',
	'observe',
	'gateway',
	'rag',
	'workflows',
	'mcp',
	'agents',
	'cli',
	'testing',
	'app',
	// 'elsium-ai' — unscoped, skip for GitHub Packages
]

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const registryArg = args.includes('--registry') ? args[args.indexOf('--registry') + 1] : 'github'

const registryUrl =
	registryArg === 'npm' ? 'https://registry.npmjs.org' : 'https://npm.pkg.github.com'

interface PackageJson {
	name: string
	version: string
	dependencies?: Record<string, string>
	devDependencies?: Record<string, string>
	publishConfig?: { registry: string; access: string }
	[key: string]: unknown
}

// ─── Collect package versions ────────────────────────────────────

const versions = new Map<string, string>()

for (const pkg of PUBLISH_ORDER) {
	const pkgJsonPath = join(PACKAGES_DIR, pkg, 'package.json')
	const pkgJson: PackageJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'))
	versions.set(pkgJson.name, pkgJson.version)
}

console.log()
console.log('  ElsiumAI Publish')
console.log('  ════════════════════════════════════════')
console.log(`  Registry:  ${registryUrl}`)
console.log(`  Packages:  ${PUBLISH_ORDER.length}`)
console.log(`  Dry run:   ${dryRun}`)
console.log()

// ─── Replace workspace:* → real versions ─────────────────────────

const originals = new Map<string, string>()

function resolveWorkspaceDeps(deps: Record<string, string> | undefined): boolean {
	if (!deps) return false
	let changed = false
	for (const [name, version] of Object.entries(deps)) {
		if (version.startsWith('workspace:')) {
			const realVersion = versions.get(name)
			if (!realVersion) {
				console.error(`  ✗ Cannot resolve workspace dependency: ${name}`)
				process.exit(1)
			}
			deps[name] = `^${realVersion}`
			changed = true
		}
	}
	return changed
}

for (const pkg of PUBLISH_ORDER) {
	const pkgJsonPath = join(PACKAGES_DIR, pkg, 'package.json')
	const raw = readFileSync(pkgJsonPath, 'utf-8')
	originals.set(pkgJsonPath, raw)

	const pkgJson: PackageJson = JSON.parse(raw)

	resolveWorkspaceDeps(pkgJson.dependencies)
	resolveWorkspaceDeps(pkgJson.devDependencies)

	// Add publishConfig for this publish
	pkgJson.publishConfig = {
		registry: registryUrl,
		access: registryArg === 'npm' ? 'public' : 'restricted',
	}

	writeFileSync(pkgJsonPath, `${JSON.stringify(pkgJson, null, '\t')}\n`)
}

console.log('  ✓ Resolved workspace:* → real versions')
console.log()

// ─── Publish ─────────────────────────────────────────────────────

let succeeded = 0
let failed = 0

try {
	for (const pkg of PUBLISH_ORDER) {
		const pkgDir = join(PACKAGES_DIR, pkg)
		const pkgJson: PackageJson = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf-8'))

		process.stdout.write(`  Publishing ${pkgJson.name}@${pkgJson.version}...`)

		if (dryRun) {
			console.log(' (dry run — skipped)')
			succeeded++
			continue
		}

		try {
			execSync('npm publish', {
				cwd: pkgDir,
				stdio: 'pipe',
			})
			console.log(' ✓')
			succeeded++
		} catch (err: unknown) {
			const stderr =
				err instanceof Error && 'stderr' in err ? (err as { stderr: Buffer }).stderr.toString() : ''

			if (stderr.includes('already been published') || stderr.includes('EPUBLISHCONFLICT')) {
				console.log(' (already published)')
				succeeded++
			} else {
				console.log(' ✗')
				console.error(`    ${stderr.split('\n')[0]}`)
				failed++
			}
		}
	}
} finally {
	// ─── Restore original package.json files ─────────────────────
	for (const [path, content] of originals) {
		writeFileSync(path, content)
	}
	console.log()
	console.log('  ✓ Restored original package.json files')
}

// ─── Summary ─────────────────────────────────────────────────────

console.log()
console.log(`  Results: ${succeeded} published, ${failed} failed`)
console.log()

if (failed > 0) {
	process.exit(1)
}
