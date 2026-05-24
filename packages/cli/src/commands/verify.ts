import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createKeyRegistry } from '@elsium-ai/core'
import { type ExecutionProof, verifyProof } from '@elsium-ai/observe'

interface VerifyArgs {
	proofPath: string
	publicKey?: string
	trustRootsPath?: string
	quiet: boolean
	json: boolean
	help: boolean
}

interface TrustRoot {
	keyId: string
	publicKey: string
	label?: string
	notBefore?: number
	notAfter?: number
}

const HELP = `
  elsium verify — Verify an ExecutionProof offline

  Usage:
    elsium verify <proof.json> [options]

  Required (one of):
    --public-key <pem-or-path>     PEM string or path to a single SPKI PEM file
    --trust-roots <path>           JSON file: [{ keyId, publicKey, label? }]

  Options:
    --quiet                        Exit code only, no human output
    --json                         Machine-readable JSON output
    -h, --help                     Show this help

  Examples:
    elsium verify ./proofs/proof_abc.json --public-key ./org-aperion.pub
    elsium verify ./proofs/proof_abc.json --trust-roots ./trust-roots.json --json
`

function parseArgs(args: string[]): VerifyArgs {
	const parsed: VerifyArgs = {
		proofPath: '',
		quiet: false,
		json: false,
		help: false,
	}

	for (let i = 0; i < args.length; i++) {
		const arg = args[i]
		if (arg === '--help' || arg === '-h') parsed.help = true
		else if (arg === '--quiet') parsed.quiet = true
		else if (arg === '--json') parsed.json = true
		else if (arg === '--public-key') parsed.publicKey = args[++i]
		else if (arg === '--trust-roots') parsed.trustRootsPath = args[++i]
		else if (!arg.startsWith('-') && !parsed.proofPath) parsed.proofPath = arg
	}

	return parsed
}

function loadPublicKey(input: string): string {
	if (input.includes('-----BEGIN')) return input
	const path = resolve(process.cwd(), input)
	if (!existsSync(path)) {
		throw new Error(`Public key file not found: ${path}`)
	}
	return readFileSync(path, 'utf8')
}

function loadTrustRoots(path: string): TrustRoot[] {
	const abs = resolve(process.cwd(), path)
	if (!existsSync(abs)) throw new Error(`Trust roots file not found: ${abs}`)
	const raw = readFileSync(abs, 'utf8')
	const parsed = JSON.parse(raw) as unknown
	if (!Array.isArray(parsed)) {
		throw new Error('Trust roots file must be a JSON array of { keyId, publicKey, label? }')
	}
	return parsed as TrustRoot[]
}

function loadProof(path: string): ExecutionProof {
	const abs = resolve(process.cwd(), path)
	if (!existsSync(abs)) throw new Error(`Proof file not found: ${abs}`)
	return JSON.parse(readFileSync(abs, 'utf8')) as ExecutionProof
}

function summarizeEvents(proof: ExecutionProof): Record<string, number> {
	const counts: Record<string, number> = {}
	for (const event of proof.events) {
		counts[event.type] = (counts[event.type] ?? 0) + 1
	}
	return counts
}

function formatHuman(proof: ExecutionProof, result: ReturnType<typeof verifyProof>): string {
	const lines: string[] = []
	const sigStatus = result.signatureValid ? 'valid' : 'INVALID'
	const chainStatus = result.chainValid ? 'intact' : 'BROKEN'

	lines.push(
		`${result.signatureValid ? '✓' : '✗'} Signature ${sigStatus} (${proof.signature.algorithm}, key=${proof.signature.keyId})`,
	)
	lines.push(
		`${result.chainValid ? '✓' : '✗'} Hash chain ${chainStatus} (${proof.events.length} events, head=${proof.chainHead.slice(0, 12)}…)`,
	)

	if (result.chainBrokenAt !== undefined) {
		lines.push(`  └─ broken at event index ${result.chainBrokenAt}`)
	}
	if (result.reason && !result.valid) {
		lines.push(`  └─ reason: ${result.reason}`)
	}

	const counts = summarizeEvents(proof)
	const breakdown = Object.entries(counts)
		.map(([k, v]) => `${v} ${k}`)
		.join(', ')
	if (breakdown) {
		lines.push(`  Events: ${breakdown}`)
	}
	lines.push(`  Agent: ${proof.agentId}${proof.agentVersion ? `@${proof.agentVersion}` : ''}`)
	lines.push(`  Span:  ${proof.startedAt} → ${proof.endedAt}`)

	return lines.join('\n')
}

function buildRegistry(
	proofKeyId: string,
	publicKey: string | undefined,
	trustRootsPath: string | undefined,
): ReturnType<typeof createKeyRegistry> {
	const registry = createKeyRegistry()

	if (publicKey) {
		registry.add(proofKeyId, loadPublicKey(publicKey), { label: 'cli-supplied' })
	}

	if (trustRootsPath) {
		for (const root of loadTrustRoots(trustRootsPath)) {
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

function emitResult(
	parsed: VerifyArgs,
	proof: ExecutionProof,
	result: ReturnType<typeof verifyProof>,
): void {
	if (parsed.json) {
		console.log(
			JSON.stringify(
				{
					valid: result.valid,
					signatureValid: result.signatureValid,
					chainValid: result.chainValid,
					chainBrokenAt: result.chainBrokenAt,
					reason: result.reason,
					proofId: proof.proofId,
					agentId: proof.agentId,
					agentVersion: proof.agentVersion,
					chainHead: proof.chainHead,
					eventCount: proof.events.length,
					events: summarizeEvents(proof),
				},
				null,
				2,
			),
		)
		return
	}
	if (!parsed.quiet) console.log(formatHuman(proof, result))
}

export async function verifyCommand(args: string[]): Promise<void> {
	const parsed = parseArgs(args)

	if (parsed.help || !parsed.proofPath) {
		console.log(HELP)
		process.exit(parsed.help ? 0 : 1)
	}

	if (!parsed.publicKey && !parsed.trustRootsPath) {
		console.error('Error: --public-key or --trust-roots is required')
		process.exit(1)
	}

	const proof = loadProof(parsed.proofPath)
	const registry = buildRegistry(proof.signature.keyId, parsed.publicKey, parsed.trustRootsPath)
	const result = verifyProof(proof, registry)

	emitResult(parsed, proof, result)
	process.exit(result.valid ? 0 : 1)
}
