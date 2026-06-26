import { ElsiumError, hmacSha256Hex, sha256Hex, timingSafeEqualHex } from '@elsium-ai/core'
import type { EvalSuiteResult } from './eval'

export interface AttestationMetadata {
	readonly model?: string
	readonly judge?: string
	readonly datasetVersion?: string
	readonly promptVersion?: string
	readonly seed?: number
	readonly [key: string]: string | number | boolean | undefined
}

export interface AttestedOverride {
	readonly approver: string
	readonly reason: string
	readonly approvedAt?: number
}

export interface AttestedGovernance {
	readonly gate: string
	readonly passed: boolean
	readonly violationCount: number
	readonly override?: AttestedOverride
}

export interface AttestationSummary {
	readonly total: number
	readonly passed: number
	readonly failed: number
	readonly score: number
}

export interface AttestationHeader {
	readonly apiVersion: 'elsium.eval-attestation/v1'
	readonly algorithm: 'hmac-sha256'
	readonly suite: string
	readonly attestedAt: number
	readonly metadata: AttestationMetadata
	readonly summary: AttestationSummary
	readonly governance?: AttestedGovernance
}

export interface AttestationRecord {
	readonly index: number
	readonly caseName: string
	readonly inputHash: string
	readonly outputHash: string
	readonly passed: boolean
	readonly score: number
	readonly criteria: readonly { readonly type: string; readonly passed: boolean }[]
}

export interface AttestationEntry {
	readonly record: AttestationRecord
	readonly previousSignature: string
	readonly signature: string
}

export interface EvalAttestation extends AttestationHeader {
	readonly entries: readonly AttestationEntry[]
}

export interface AttestEvalOptions {
	readonly secret: string
	readonly metadata?: AttestationMetadata
	readonly governance?: AttestedGovernance
	readonly attestedAt?: number
}

export interface AttestationVerification {
	readonly valid: boolean
	readonly entryCount: number
	readonly invalidAtIndex?: number
	readonly reason?: string
}

function stableStringify(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value)
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
	const keys = Object.keys(value as Record<string, unknown>).sort()
	const pairs = keys.map(
		(k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`,
	)
	return `{${pairs.join(',')}}`
}

function headerOf(attestation: AttestationHeader): AttestationHeader {
	return {
		apiVersion: attestation.apiVersion,
		algorithm: attestation.algorithm,
		suite: attestation.suite,
		attestedAt: attestation.attestedAt,
		metadata: attestation.metadata,
		summary: attestation.summary,
		governance: attestation.governance,
	}
}

async function genesisSignature(header: AttestationHeader, secret: string): Promise<string> {
	return hmacSha256Hex(secret, `genesis|${stableStringify(headerOf(header))}`)
}

async function signRecord(
	record: AttestationRecord,
	previousSignature: string,
	secret: string,
): Promise<string> {
	return hmacSha256Hex(secret, `${previousSignature}|${stableStringify(record)}`)
}

export async function attestEvalSuite(
	result: EvalSuiteResult,
	options: AttestEvalOptions,
): Promise<EvalAttestation> {
	if (options.secret.length < 16) {
		throw ElsiumError.validation(
			'attestEvalSuite: secret must be at least 16 characters for HMAC strength',
		)
	}

	const header: AttestationHeader = {
		apiVersion: 'elsium.eval-attestation/v1',
		algorithm: 'hmac-sha256',
		suite: result.name,
		attestedAt: options.attestedAt ?? Date.now(),
		metadata: options.metadata ?? {},
		summary: {
			total: result.total,
			passed: result.passed,
			failed: result.failed,
			score: result.score,
		},
		governance: options.governance,
	}

	const entries: AttestationEntry[] = []
	let previousSignature = await genesisSignature(header, options.secret)

	for (let i = 0; i < result.results.length; i++) {
		const r = result.results[i]
		const [inputHash, outputHash] = await Promise.all([sha256Hex(r.input), sha256Hex(r.output)])
		const record: AttestationRecord = {
			index: i,
			caseName: r.name,
			inputHash,
			outputHash,
			passed: r.passed,
			score: r.score,
			criteria: r.criteria.map((c) => ({ type: c.type, passed: c.passed })),
		}
		const signature = await signRecord(record, previousSignature, options.secret)
		entries.push({ record, previousSignature, signature })
		previousSignature = signature
	}

	return { ...header, entries }
}

export async function verifyEvalAttestation(
	fileOrJson: EvalAttestation | string,
	secret: string,
): Promise<AttestationVerification> {
	let file: EvalAttestation
	try {
		file = typeof fileOrJson === 'string' ? (JSON.parse(fileOrJson) as EvalAttestation) : fileOrJson
	} catch (err) {
		return {
			valid: false,
			entryCount: 0,
			invalidAtIndex: 0,
			reason: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
		}
	}

	if (file.apiVersion !== 'elsium.eval-attestation/v1') {
		return {
			valid: false,
			entryCount: file.entries?.length ?? 0,
			reason: `Unsupported apiVersion: ${file.apiVersion}`,
		}
	}
	if (file.algorithm !== 'hmac-sha256') {
		return {
			valid: false,
			entryCount: file.entries.length,
			reason: `Unsupported algorithm: ${file.algorithm}`,
		}
	}

	let expectedPrev = await genesisSignature(file, secret)
	for (let i = 0; i < file.entries.length; i++) {
		const e = file.entries[i]
		if (e.previousSignature !== expectedPrev) {
			return {
				valid: false,
				entryCount: file.entries.length,
				invalidAtIndex: i,
				reason:
					i === 0
						? 'Entry 0: genesis mismatch (header tampered or wrong secret)'
						: `Entry ${i}: previousSignature mismatch (chain broken)`,
			}
		}
		const expected = await signRecord(e.record, e.previousSignature, secret)
		if (!timingSafeEqualHex(e.signature, expected)) {
			return {
				valid: false,
				entryCount: file.entries.length,
				invalidAtIndex: i,
				reason: `Entry ${i}: signature mismatch (record tampered or wrong secret)`,
			}
		}
		expectedPrev = e.signature
	}

	return { valid: true, entryCount: file.entries.length }
}

export function formatAttestation(attestation: EvalAttestation): string {
	const lines: string[] = []
	lines.push('')
	lines.push(`  Eval Attestation: ${attestation.suite}`)
	lines.push(`  ${'─'.repeat(50)}`)
	lines.push(`  apiVersion: ${attestation.apiVersion}  algorithm: ${attestation.algorithm}`)
	const s = attestation.summary
	lines.push(
		`  summary: ${(s.score * 100).toFixed(1)}% | ${s.passed}/${s.total} passed | ${s.failed} failed`,
	)
	if (attestation.governance) {
		const g = attestation.governance
		const verdict = g.passed ? 'PASS' : 'FAIL'
		const ov = g.override ? ` (overridden by ${g.override.approver})` : ''
		lines.push(`  governance: ${g.gate} ${verdict} — ${g.violationCount} violations${ov}`)
	}
	lines.push(`  entries: ${attestation.entries.length} (hash-chained, HMAC-SHA256)`)
	lines.push('')
	return lines.join('\n')
}
