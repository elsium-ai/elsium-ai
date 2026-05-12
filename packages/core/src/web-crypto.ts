/**
 * Web Crypto API utilities — runtime-agnostic primitives for governance code.
 *
 * Replaces the `node:crypto` imports that previously locked four core
 * governance modules (audit, identity, integrity, app/middleware) to Node-only
 * runtimes. With these utilities every governance primitive runs on Node ≥ 20,
 * Bun, Deno, Cloudflare Workers, Vercel Edge, and the browser.
 *
 * Two design notes worth knowing:
 *
 * 1. `crypto.subtle.*` is **always async** on Web Crypto. The hashes and
 *    HMAC functions therefore return `Promise<string>`. Any caller that
 *    previously took a sync result becomes async — a breaking API change
 *    documented in CHANGELOG.
 *
 * 2. `crypto.getRandomValues` is **sync** on Web Crypto, so the random/
 *    entropy primitives below remain synchronous. `generateId` and similar
 *    sync APIs are NOT broken by this migration.
 */

const HEX_CHARS = '0123456789abcdef'

function toHex(bytes: Uint8Array): string {
	let out = ''
	for (let i = 0; i < bytes.length; i++) {
		const b = bytes[i]
		out += HEX_CHARS[(b >> 4) & 0xf] + HEX_CHARS[b & 0xf]
	}
	return out
}

function fromHex(hex: string): Uint8Array | null {
	if (hex.length % 2 !== 0) return null
	const out = new Uint8Array(hex.length / 2)
	for (let i = 0; i < out.length; i++) {
		const hi = HEX_CHARS.indexOf(hex[i * 2].toLowerCase())
		const lo = HEX_CHARS.indexOf(hex[i * 2 + 1].toLowerCase())
		if (hi === -1 || lo === -1) return null
		out[i] = (hi << 4) | lo
	}
	return out
}

// Minimal local type for the slice of Web Crypto subtle that we use. Avoids
// depending on `lib: ["dom"]` which would broaden the ambient types of every
// downstream consumer of @elsium-ai/core.
interface SubtleLike {
	digest(algorithm: string, data: ArrayBuffer | Uint8Array): Promise<ArrayBuffer>
	importKey(
		format: 'raw',
		keyData: ArrayBuffer | Uint8Array,
		algorithm: { name: 'HMAC'; hash: 'SHA-256' },
		extractable: boolean,
		keyUsages: readonly ('sign' | 'verify')[],
	): Promise<unknown>
	sign(
		algorithm: 'HMAC' | { name: 'HMAC' },
		key: unknown,
		data: ArrayBuffer | Uint8Array,
	): Promise<ArrayBuffer>
}

interface CryptoLike {
	subtle?: SubtleLike
	getRandomValues?<T extends Uint8Array>(array: T): T
}

function getSubtle(): SubtleLike {
	const c = (globalThis as { crypto?: CryptoLike }).crypto
	if (!c || !c.subtle) {
		throw new Error(
			'Web Crypto API not available: globalThis.crypto.subtle is undefined. ' +
				'Requires Node ≥ 20, Bun, Deno, Workers, or a modern browser.',
		)
	}
	return c.subtle
}

/**
 * SHA-256 of a UTF-8 string, returned as lowercase hex.
 * Async — backed by `crypto.subtle.digest`.
 */
export async function sha256Hex(input: string): Promise<string> {
	const buf = new TextEncoder().encode(input)
	const digest = await getSubtle().digest('SHA-256', buf)
	return toHex(new Uint8Array(digest))
}

/**
 * HMAC-SHA256 of `input` keyed by `secret`, returned as lowercase hex.
 * Async — backed by `crypto.subtle.sign`.
 */
export async function hmacSha256Hex(secret: string, input: string): Promise<string> {
	const enc = new TextEncoder()
	const key = await getSubtle().importKey(
		'raw',
		enc.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	)
	const sig = await getSubtle().sign('HMAC', key, enc.encode(input))
	return toHex(new Uint8Array(sig))
}

/**
 * Cryptographically secure random bytes as a lowercase hex string.
 * Sync — backed by `crypto.getRandomValues`.
 */
export function randomHexString(byteLength: number): string {
	if (!Number.isInteger(byteLength) || byteLength <= 0) {
		throw new RangeError(
			`randomHexString: byteLength must be a positive integer, got ${byteLength}`,
		)
	}
	const buf = new Uint8Array(byteLength)
	const c = (globalThis as { crypto?: CryptoLike }).crypto
	if (!c || typeof c.getRandomValues !== 'function') {
		throw new Error('Web Crypto API not available: globalThis.crypto.getRandomValues is undefined.')
	}
	c.getRandomValues(buf)
	return toHex(buf)
}

/**
 * Constant-time comparison of two hex strings of equal length.
 * Returns false (without short-circuiting) when lengths differ.
 * Pure JS, sync — no Web Crypto dependency.
 *
 * Polyfills `node:crypto.timingSafeEqual` for the hex-encoded values
 * elsium-ai uses (signatures, hashes, HMAC outputs).
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
	const aBytes = fromHex(a)
	const bBytes = fromHex(b)
	if (!aBytes || !bBytes) return false
	if (aBytes.length !== bBytes.length) return false
	let diff = 0
	for (let i = 0; i < aBytes.length; i++) {
		diff |= aBytes[i] ^ bBytes[i]
	}
	return diff === 0
}

/**
 * Constant-time comparison of two UTF-8 strings of equal length. Useful for
 * comparing API tokens / bearer tokens where the caller has them as strings,
 * not hex. Returns false (without short-circuiting) when lengths differ.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
	const enc = new TextEncoder()
	const aBytes = enc.encode(a)
	const bBytes = enc.encode(b)
	if (aBytes.length !== bBytes.length) return false
	let diff = 0
	for (let i = 0; i < aBytes.length; i++) {
		diff |= aBytes[i] ^ bBytes[i]
	}
	return diff === 0
}
