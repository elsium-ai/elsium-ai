import { sha256Hex } from '@elsium-ai/core'

/**
 * Deterministic JSON encoding: object keys sorted, `undefined` dropped.
 *
 * Same shape must always produce the same bytes, or the hash is worthless
 * as an identity. Mirrors the canonicalizer used by the proof recorder.
 */
export function canonicalize(value: unknown): string {
	if (value === undefined) return 'null'
	if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
	if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`

	const record = value as Record<string, unknown>
	const keys = Object.keys(record)
		.filter((k) => record[k] !== undefined)
		.sort()
	const entries = keys.map((k) => `${JSON.stringify(k)}:${canonicalize(record[k])}`)
	return `{${entries.join(',')}}`
}

/** SHA-256 of the canonical encoding of `value`, as lowercase hex. */
export function hashCanonical(value: unknown): Promise<string> {
	return sha256Hex(canonicalize(value))
}

/** SHA-256 of a raw string (prompt text, policy source, handler source). */
export function hashText(text: string): Promise<string> {
	return sha256Hex(text)
}
