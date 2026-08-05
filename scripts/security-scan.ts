#!/usr/bin/env bun
/**
 * security-scan — pre-commit / CI gate for source-level tampering.
 *
 * This exists because of a real incident: an obfuscated payload was appended
 * to a Tailwind config, padded with ~400 spaces so it sat off-screen in an
 * editor. It was committed unnoticed and executed on every build. Lint,
 * typecheck, tests and `bun audit` all passed — none of them look at what this
 * looks at.
 *
 * Detectors, in rough order of how much they earn their keep:
 *
 *  1. hidden-payload   — code pushed off-screen behind a wall of whitespace.
 *                        This is the one that would have caught the incident.
 *  2. obfuscated-payload — byte signatures of the loader family involved
 *                        (char-shuffle deobfuscators, `global[...] = require`).
 *  3. bidi-control     — Trojan Source (CVE-2021-42574): bidirectional or
 *                        invisible Unicode that makes code read differently to
 *                        a human than to a compiler.
 *  4. install-hook     — `preinstall` / `postinstall` / `install` added to a
 *                        publishable package. These run on `npm install` on
 *                        every consumer machine; this repo ships none.
 *  5. anomalous-line   — very long lines that also look obfuscated. Broadest
 *                        net, most prone to noise, so generated and minified
 *                        output is excluded.
 *
 * Exit code is 1 on any finding, 0 when clean. Building or running a poisoned
 * tree is what detonates it, so this is wired to run *before* those.
 *
 * Portable by design — it depends only on node builtins. To reuse it in
 * another repo, copy this file and add:
 *   "scan:security": "bun scripts/security-scan.ts"
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, extname, join, relative, sep } from 'node:path'

export type FindingKind =
	| 'hidden-payload'
	| 'obfuscated-payload'
	| 'bidi-control'
	| 'install-hook'
	| 'anomalous-line'

export interface Finding {
	kind: FindingKind
	file: string
	line: number
	detail: string
	/** Trimmed evidence, safe to print — never the whole payload. */
	evidence: string
}

// ─── Configuration ──────────────────────────────────────────────

const SKIP_DIRS = new Set([
	'node_modules',
	'dist',
	'build',
	'out',
	'coverage',
	'.git',
	'.cache',
	'.next',
	'.nuxt',
	'.turbo',
	'.output',
	'.svelte-kit',
	'vendor',
	'.venv',
	'venv',
	'__pycache__',
	'.pnpm',
	'.yarn',
	'tmp',
	'.expo',
	'.terraform',
	'.claude',
	'.vscode',
	'.idea',
	'generated',
])

const SCAN_EXTENSIONS = new Set([
	'.js',
	'.jsx',
	'.ts',
	'.tsx',
	'.mjs',
	'.cjs',
	'.vue',
	'.svelte',
	'.astro',
])

/**
 * This file and its test necessarily contain the patterns they detect.
 * Scanning them would be a guaranteed self-report.
 */
const SELF = new Set(['security-scan.ts', 'security-scan.test.ts'])

/**
 * Padding threshold.
 *
 * The incident used roughly 400 spaces. Legitimate code does not run to 80
 * consecutive spaces mid-line — deep indentation lives at the *start* of a
 * line, which is why the match requires non-whitespace before the run.
 */
const PADDING_RUN = 80

/** Long-line thresholds. Configs are terser, so they get a tighter bound. */
const LONG_LINE = { config: 500, source: 2000 }

/** Byte patterns from the loader family seen in the wild. Absent from real code. */
const OBFUSCATION_SIGNATURES: Array<{ re: RegExp; detail: string }> = [
	{ re: /global\s*\[\s*['"]_V['"]\s*\]/, detail: 'obfuscated loader global marker' },
	{ re: /global\s*\[\s*['"]!['"]\s*\]/, detail: 'obfuscated loader global marker' },
	{ re: /global\s*\[\s*['"]_t_t['"]\s*\]/, detail: 'obfuscated loader global marker' },
	{
		// `[^=]*?` rather than `[^\]]*` — the real payload indexes an array
		// (`global[_$_1e42[0]] = require`), so the subscript contains brackets.
		re: /global\s*\[[^=]*?\]\s*=\s*require\b/,
		detail: 'require aliased onto a global — payload bootstrap',
	},
	{
		re: /\(\s*function\s*\(\s*\w\s*,\s*\w\s*\)\s*\{\s*var\s+\w+\s*=\s*\w+\.length\s*;\s*var\s+\w+\s*=\s*\[\]\s*;\s*for/,
		detail: 'char-shuffle deobfuscator IIFE',
	},
	{ re: /eval\s*\(\s*atob\s*\(/, detail: 'eval of base64-decoded content' },
	{
		re: /new\s+Function\s*\(\s*atob\s*\(/,
		detail: 'Function constructor over base64-decoded content',
	},
]

/**
 * Bidirectional and invisible control characters (Trojan Source).
 *
 * LRE/RLE/PDF/LRO/RLO, the isolates, and zero-width joiners. None of these
 * belong in source; they exist to make rendered code lie about what runs.
 */
const BIDI_CONTROL = /[‪-‮⁦-⁩​-‏؜]/

const OBFUSCATION_HINT =
	/fromCharCode|function\s*\(|atob\s*\(|global\s*\[|require\s*\(|=>|\\x[0-9a-f]{2}/i

/** Lifecycle scripts that execute on a consumer's machine at install time. */
const DANGEROUS_LIFECYCLE = ['preinstall', 'install', 'postinstall']

// ─── Detectors ──────────────────────────────────────────────────

function isConfigFile(file: string): boolean {
	const base = basename(file)
	return (
		/\.config\.[mc]?[jt]s$/.test(base) ||
		/^(next|postcss|tailwind|vite|rollup|webpack|svelte|astro|nuxt|remix|vue)\.config\./.test(base)
	)
}

function isGeneratedOrMinified(file: string): boolean {
	const base = basename(file)
	return /\.min\.[jt]s$/.test(base) || /\.generated\./.test(base) || /\bbundle\./.test(base)
}

function truncate(text: string, max = 100): string {
	const collapsed = text.replace(/\s+/g, ' ').trim()
	return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed
}

function codePointName(char: string): string {
	return `U+${char.codePointAt(0)?.toString(16).toUpperCase().padStart(4, '0')}`
}

/**
 * Scan one file's content. Pure — no I/O — so tests drive it directly.
 */
export function scanContent(file: string, content: string): Finding[] {
	const findings: Finding[] = []
	const lines = content.split('\n')
	const ext = extname(file)
	const limit = isConfigFile(file) ? LONG_LINE.config : LONG_LINE.source

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		const lineNumber = i + 1

		// 1. Code hidden behind a run of padding whitespace.
		const padding = line.match(new RegExp(`\\S[ \\t]{${PADDING_RUN},}(\\S.*)$`))
		if (padding) {
			findings.push({
				kind: 'hidden-payload',
				file,
				line: lineNumber,
				detail: `content hidden behind ${line.length - (padding[1]?.length ?? 0)} columns of padding`,
				evidence: truncate(padding[1] ?? ''),
			})
			continue
		}

		// 2. Known obfuscated-loader signatures.
		const signature = OBFUSCATION_SIGNATURES.find((s) => s.re.test(line))
		if (signature) {
			findings.push({
				kind: 'obfuscated-payload',
				file,
				line: lineNumber,
				detail: signature.detail,
				evidence: truncate(line.match(signature.re)?.[0] ?? ''),
			})
			continue
		}

		// 3. Bidirectional / invisible control characters.
		const bidi = line.match(BIDI_CONTROL)
		if (bidi) {
			findings.push({
				kind: 'bidi-control',
				file,
				line: lineNumber,
				detail: `bidirectional or invisible control character ${codePointName(bidi[0])}`,
				evidence: truncate(line),
			})
			continue
		}

		// 4. Anomalously long lines that also look obfuscated.
		if (
			ext !== '.json' &&
			!isGeneratedOrMinified(file) &&
			line.length > limit &&
			OBFUSCATION_HINT.test(line)
		) {
			findings.push({
				kind: 'anomalous-line',
				file,
				line: lineNumber,
				detail: `line of ${line.length} characters matching obfuscation heuristics`,
				evidence: truncate(line),
			})
		}
	}

	return findings
}

/**
 * Scan a package manifest for install-time lifecycle scripts.
 *
 * A `postinstall` in a published package runs on every consumer machine that
 * installs it — the single most abused vector in npm supply-chain attacks.
 */
export function scanManifest(file: string, content: string): Finding[] {
	let parsed: { scripts?: Record<string, string>; private?: boolean }
	try {
		parsed = JSON.parse(content)
	} catch {
		return []
	}

	// The repo root is private and legitimately runs `prepare` for husky.
	if (parsed.private) return []

	const scripts = parsed.scripts ?? {}
	const findings: Finding[] = []
	for (const hook of DANGEROUS_LIFECYCLE) {
		if (scripts[hook] === undefined) continue
		findings.push({
			kind: 'install-hook',
			file,
			line: 1,
			detail: `publishable package declares "${hook}", which runs on every consumer install`,
			evidence: truncate(`${hook}: ${scripts[hook]}`),
		})
	}
	return findings
}

// ─── Walk ───────────────────────────────────────────────────────

export interface ScanOptions {
	root: string
	/** Restrict the scan to these paths (relative to root). Used for staged files. */
	only?: string[]
}

function shouldSkipDir(name: string): boolean {
	return SKIP_DIRS.has(name) || name.startsWith('.tmp')
}

function collectFiles(dir: string, root: string, acc: string[]): void {
	let entries: ReturnType<typeof readdirSync>
	try {
		entries = readdirSync(dir, { withFileTypes: true })
	} catch {
		return
	}

	for (const entry of entries) {
		const full = join(dir, entry.name)
		if (entry.isDirectory()) {
			if (!shouldSkipDir(entry.name)) collectFiles(full, root, acc)
			continue
		}
		if (!entry.isFile()) continue
		if (SELF.has(entry.name)) continue
		if (SCAN_EXTENSIONS.has(extname(entry.name)) || entry.name === 'package.json') {
			acc.push(full)
		}
	}
}

export function scanPaths(files: string[], root: string): Finding[] {
	const findings: Finding[] = []

	for (const full of files) {
		const rel = relative(root, full)
		let content: string
		try {
			content = readFileSync(full, 'utf8')
		} catch {
			continue
		}

		findings.push(
			...(basename(full) === 'package.json'
				? scanManifest(rel, content)
				: scanContent(rel, content)),
		)
	}

	return findings
}

export function scanRepo(options: ScanOptions): Finding[] {
	const { root, only } = options

	if (only && only.length > 0) {
		const selected = only
			.filter((p) => {
				const name = basename(p)
				if (SELF.has(name)) return false
				if (p.split(sep).some(shouldSkipDir)) return false
				return SCAN_EXTENSIONS.has(extname(p)) || name === 'package.json'
			})
			.map((p) => join(root, p))
			.filter((p) => {
				try {
					return statSync(p).isFile()
				} catch {
					return false
				}
			})
		return scanPaths(selected, root)
	}

	const files: string[] = []
	collectFiles(root, root, files)
	return scanPaths(files, root)
}

// ─── CLI ────────────────────────────────────────────────────────

const KIND_HELP: Record<FindingKind, string> = {
	'hidden-payload':
		'Code was pushed off-screen behind padding whitespace. This is how the 2026-05 incident hid an executable payload in a config file.',
	'obfuscated-payload':
		'A known obfuscated-loader signature. Do not run or build this tree until it is removed.',
	'bidi-control':
		'Invisible or bidirectional Unicode makes source render differently than it executes (Trojan Source, CVE-2021-42574).',
	'install-hook':
		'A publishable package declares an install-time script, which executes on every consumer machine.',
	'anomalous-line':
		'A very long line matching obfuscation heuristics. Verify it is generated output before dismissing.',
}

function report(findings: Finding[]): void {
	console.error('\n\x1b[41m\x1b[97m  ⛔  SECURITY SCAN FAILED  \x1b[0m\n')

	const byKind = new Map<FindingKind, Finding[]>()
	for (const finding of findings) {
		const group = byKind.get(finding.kind) ?? []
		group.push(finding)
		byKind.set(finding.kind, group)
	}

	for (const [kind, group] of byKind) {
		console.error(`\x1b[31m${kind}\x1b[0m — ${KIND_HELP[kind]}`)
		for (const finding of group) {
			console.error(`  • \x1b[1m${finding.file}:${finding.line}\x1b[0m — ${finding.detail}`)
			console.error(`      ↳ ${finding.evidence}`)
		}
		console.error('')
	}

	console.error(
		'Inspect with `git diff` before doing anything else. Do not build or run the tree.\n',
	)
}

function main(): void {
	const args = process.argv.slice(2)
	if (args.includes('--help') || args.includes('-h')) {
		console.log(`
  security-scan — detect source-level tampering

  Usage:
    bun scripts/security-scan.ts [paths...]

  With no paths, scans the whole repository. Pass paths (relative to the repo
  root) to scan a subset — used by the pre-commit hook for staged files.

  Exits 1 on any finding.
`)
		process.exit(0)
	}

	const root = process.cwd()
	let findings: Finding[]
	try {
		findings = scanRepo({ root, only: args.length > 0 ? args : undefined })
	} catch (error) {
		// Fail open on an internal error: a scanner bug must never block work.
		console.warn(
			`[security-scan] scanner failed internally: ${error instanceof Error ? error.message : String(error)}`,
		)
		process.exit(0)
	}

	if (findings.length > 0) {
		report(findings)
		process.exit(1)
	}

	console.log('\x1b[32m✓ security-scan: no tampering signatures found\x1b[0m')
	process.exit(0)
}

// Only run the CLI when executed directly, so tests can import the detectors.
if (import.meta.main) main()
