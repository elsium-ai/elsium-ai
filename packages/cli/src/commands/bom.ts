import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createKeyRegistry } from '@elsium-ai/core'
import {
	type AiBom,
	type AiBomDiff,
	type ComponentDrift,
	type DriftSeverity,
	type VerifyAiBomResult,
	diffAiBom,
	passesGate,
	verifyAiBom,
} from '@elsium-ai/observe'

interface TrustRoot {
	keyId: string
	publicKey: string
	label?: string
	notBefore?: number
	notAfter?: number
}

const HELP = `
  elsium bom — Work with AI-BOMs (signed agent composition manifests)

  Usage:
    elsium bom verify <bom.json> [options]
    elsium bom diff <approved.json> <current.json> [options]

  verify — check signature, component hash, and header digest offline
    --public-key <pem-or-path>     PEM string or path to a single SPKI PEM file
    --trust-roots <path>           JSON file: [{ keyId, publicKey, label? }]

  diff — compare a shipped BOM against the approved one (release gate)
    --fail-on <severity>           critical (default) | major | minor
    --verify                       also verify both BOMs before comparing
    --public-key / --trust-roots   keys for --verify

  Common options:
    --json                         Machine-readable JSON output
    --quiet                        Exit code only, no human output
    -h, --help                     Show this help

  Exit codes:
    0  verified / no drift at or above --fail-on
    1  invalid signature, drift at or above --fail-on, or bad usage

  Examples:
    elsium bom verify ./aibom.json --public-key ./release.pub
    elsium bom diff ./approved-bom.json ./aibom.json --fail-on major
    elsium bom diff ./approved-bom.json ./aibom.json --verify --trust-roots ./roots.json
`

const SEVERITY_ICON: Record<DriftSeverity, string> = {
	critical: '✗',
	major: '!',
	minor: '·',
}

interface BomArgs {
	subcommand: string
	paths: string[]
	publicKey?: string
	trustRootsPath?: string
	failOn: DriftSeverity
	verify: boolean
	json: boolean
	quiet: boolean
	help: boolean
}

/** Flags that stand alone, mapped to the field they set. */
const BOOLEAN_FLAGS: Record<string, keyof BomArgs> = {
	'--help': 'help',
	'-h': 'help',
	'--json': 'json',
	'--quiet': 'quiet',
	'--verify': 'verify',
}

/** Flags that consume the next argument. */
const VALUE_FLAGS: Record<string, keyof BomArgs> = {
	'--public-key': 'publicKey',
	'--trust-roots': 'trustRootsPath',
	'--fail-on': 'failOn',
}

function parseArgs(args: string[]): BomArgs {
	const parsed: BomArgs = {
		subcommand: '',
		paths: [],
		failOn: 'critical',
		verify: false,
		json: false,
		quiet: false,
		help: false,
	}

	for (let i = 0; i < args.length; i++) {
		const arg = args[i]
		const booleanField = BOOLEAN_FLAGS[arg]
		if (booleanField) {
			Object.assign(parsed, { [booleanField]: true })
			continue
		}

		const valueField = VALUE_FLAGS[arg]
		if (valueField) {
			Object.assign(parsed, { [valueField]: args[++i] })
			continue
		}

		if (arg.startsWith('-')) continue
		if (parsed.subcommand) parsed.paths.push(arg)
		else parsed.subcommand = arg
	}

	return parsed
}

function loadJson<T>(path: string, label: string): T {
	const abs = resolve(process.cwd(), path)
	if (!existsSync(abs)) throw new Error(`${label} not found: ${abs}`)
	return JSON.parse(readFileSync(abs, 'utf8')) as T
}

function loadPublicKey(input: string): string {
	if (input.includes('-----BEGIN')) return input
	const path = resolve(process.cwd(), input)
	if (!existsSync(path)) throw new Error(`Public key file not found: ${path}`)
	return readFileSync(path, 'utf8')
}

function buildRegistry(
	keyId: string,
	publicKey: string | undefined,
	trustRootsPath: string | undefined,
): ReturnType<typeof createKeyRegistry> {
	const registry = createKeyRegistry()

	if (publicKey) {
		registry.add(keyId, loadPublicKey(publicKey), { label: 'cli-supplied' })
	}
	if (trustRootsPath) {
		const roots = loadJson<TrustRoot[]>(trustRootsPath, 'Trust roots file')
		if (!Array.isArray(roots)) {
			throw new Error('Trust roots file must be a JSON array of { keyId, publicKey, label? }')
		}
		for (const root of roots) {
			if (registry.get(root.keyId)) continue
			registry.add(root.keyId, root.publicKey, {
				label: root.label,
				notBefore: root.notBefore,
				notAfter: root.notAfter,
			})
		}
	}

	return registry
}

function countComponents(bom: AiBom): Record<string, number> {
	const c = bom.components
	return {
		models: c.models.length,
		prompts: c.prompts.length,
		tools: c.tools.length,
		mcpServers: c.mcpServers.length,
		datasets: c.datasets.length,
		policies: c.policies.length,
		thresholds: Object.keys(c.thresholds ?? {}).length,
	}
}

/**
 * Render one check.
 *
 * `verifyAiBom` short-circuits at the innermost failure, so anything past that
 * point was never evaluated. Reporting it as "INVALID" would be a lie.
 */
function checkLine(
	label: string,
	checked: boolean,
	ok: boolean,
	pass: string,
	fail: string,
): string {
	if (!checked) return `· ${label.padEnd(16)} not checked`
	return `${ok ? '✓' : '✗'} ${label} ${ok ? pass : fail}`
}

function formatVerify(bom: AiBom, result: VerifyAiBomResult): string {
	const lines: string[] = [
		checkLine(
			'Components',
			result.checked.componentsHash,
			result.componentsHashValid,
			`match componentsHash (${bom.componentsHash.slice(0, 12)}…)`,
			'DO NOT MATCH componentsHash',
		),
		checkLine('Header digest', result.checked.digest, result.digestValid, 'intact', 'BROKEN'),
		checkLine(
			'Signature',
			result.checked.signature,
			result.signatureValid,
			`valid (${bom.signature.algorithm}, key=${bom.signature.keyId})`,
			'INVALID',
		),
	]
	if (result.reason && !result.valid) lines.push(`  └─ reason: ${result.reason}`)

	const counts = countComponents(bom)
	const breakdown = Object.entries(counts)
		.filter(([, v]) => v > 0)
		.map(([k, v]) => `${v} ${k}`)
		.join(', ')
	lines.push(`  Agent: ${bom.agentId}${bom.agentVersion ? `@${bom.agentVersion}` : ''}`)
	if (bom.environment) lines.push(`  Env:   ${bom.environment}`)
	if (breakdown) lines.push(`  Parts: ${breakdown}`)
	lines.push(`  Built: ${bom.generatedAt}`)

	return lines.join('\n')
}

function formatDrift(drift: ComponentDrift): string {
	const icon = SEVERITY_ICON[drift.severity]
	return `  ${icon} [${drift.severity}] ${drift.reason}`
}

function formatDiff(diff: AiBomDiff, failOn: DriftSeverity, passed: boolean): string {
	if (diff.identical) return '✓ No composition drift — the shipped agent matches the approved BOM.'

	const lines: string[] = []
	const order: DriftSeverity[] = ['critical', 'major', 'minor']
	for (const severity of order) {
		const group = diff.drifts.filter((d) => d.severity === severity)
		if (group.length === 0) continue
		lines.push(`${severity.toUpperCase()} (${group.length})`)
		for (const drift of group) lines.push(formatDrift(drift))
	}

	lines.push('')
	lines.push(
		`${passed ? '✓' : '✗'} ${diff.drifts.length} change(s): ${diff.counts.critical} critical, ${diff.counts.major} major, ${diff.counts.minor} minor — gate --fail-on=${failOn} ${passed ? 'PASSED' : 'FAILED'}`,
	)
	return lines.join('\n')
}

async function runVerify(parsed: BomArgs): Promise<never> {
	if (parsed.paths.length < 1) {
		console.error('Error: elsium bom verify requires a <bom.json> path')
		process.exit(1)
	}
	if (!parsed.publicKey && !parsed.trustRootsPath) {
		console.error('Error: --public-key or --trust-roots is required')
		process.exit(1)
	}

	const bom = loadJson<AiBom>(parsed.paths[0], 'BOM file')
	const registry = buildRegistry(bom.signature.keyId, parsed.publicKey, parsed.trustRootsPath)
	const result = await verifyAiBom(bom, registry)

	if (parsed.json) {
		console.log(
			JSON.stringify(
				{
					...result,
					bomId: bom.bomId,
					agentId: bom.agentId,
					agentVersion: bom.agentVersion,
					environment: bom.environment,
					componentsHash: bom.componentsHash,
					components: countComponents(bom),
				},
				null,
				2,
			),
		)
	} else if (!parsed.quiet) {
		console.log(formatVerify(bom, result))
	}

	process.exit(result.valid ? 0 : 1)
}

async function verifyBoth(parsed: BomArgs, approved: AiBom, current: AiBom): Promise<void> {
	if (!parsed.publicKey && !parsed.trustRootsPath) {
		console.error('Error: --verify requires --public-key or --trust-roots')
		process.exit(1)
	}

	for (const [label, bom] of [
		['approved', approved],
		['current', current],
	] as const) {
		const registry = buildRegistry(bom.signature.keyId, parsed.publicKey, parsed.trustRootsPath)
		const result = await verifyAiBom(bom, registry)
		if (!result.valid) {
			console.error(`Error: ${label} BOM failed verification — ${result.reason ?? 'invalid'}`)
			process.exit(1)
		}
	}
}

async function runDiff(parsed: BomArgs): Promise<never> {
	if (parsed.paths.length < 2) {
		console.error('Error: elsium bom diff requires <approved.json> and <current.json>')
		process.exit(1)
	}
	if (!['critical', 'major', 'minor'].includes(parsed.failOn)) {
		console.error(`Error: --fail-on must be critical, major, or minor (got "${parsed.failOn}")`)
		process.exit(1)
	}

	const approved = loadJson<AiBom>(parsed.paths[0], 'Approved BOM')
	const current = loadJson<AiBom>(parsed.paths[1], 'Current BOM')

	// Diffing against an unverified baseline proves nothing — opt in with --verify.
	if (parsed.verify) await verifyBoth(parsed, approved, current)

	const diff = diffAiBom(approved, current)
	const passed = passesGate(diff, parsed.failOn)

	if (parsed.json) {
		console.log(JSON.stringify({ ...diff, failOn: parsed.failOn, passed }, null, 2))
	} else if (!parsed.quiet) {
		console.log(formatDiff(diff, parsed.failOn, passed))
	}

	process.exit(passed ? 0 : 1)
}

export async function bomCommand(args: string[]): Promise<void> {
	const parsed = parseArgs(args)

	if (parsed.help || !parsed.subcommand) {
		console.log(HELP)
		process.exit(parsed.help ? 0 : 1)
	}

	switch (parsed.subcommand) {
		case 'verify':
			await runVerify(parsed)
			break
		case 'diff':
			await runDiff(parsed)
			break
		default:
			console.error(`Unknown bom subcommand: ${parsed.subcommand}`)
			console.log(HELP)
			process.exit(1)
	}
}
