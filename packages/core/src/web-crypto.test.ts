import { describe, expect, it } from 'vitest'
import {
	hmacSha256Hex,
	randomHexString,
	sha256Hex,
	timingSafeEqualHex,
	timingSafeEqualString,
} from './web-crypto'

describe('sha256Hex', () => {
	it('hashes a known input to the expected SHA-256 digest', async () => {
		// Reference value: echo -n "hello" | sha256sum
		const out = await sha256Hex('hello')
		expect(out).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
	})

	it('handles empty string', async () => {
		// Reference: echo -n "" | sha256sum
		expect(await sha256Hex('')).toBe(
			'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
		)
	})

	it('is deterministic — same input twice yields same output', async () => {
		const a = await sha256Hex('elsium-ai')
		const b = await sha256Hex('elsium-ai')
		expect(a).toBe(b)
	})

	it('handles unicode (UTF-8)', async () => {
		const out = await sha256Hex('héllo 🌍')
		expect(out).toMatch(/^[0-9a-f]{64}$/)
	})
})

describe('hmacSha256Hex', () => {
	it('computes HMAC-SHA256 — known test vector', async () => {
		// RFC 4231 Test Case 1: key=0x0b*20, data="Hi There"
		const key = '\x0b'.repeat(20)
		const out = await hmacSha256Hex(key, 'Hi There')
		expect(out).toBe('b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7')
	})

	it('different keys produce different HMACs for the same input', async () => {
		const a = await hmacSha256Hex('secret-a', 'message')
		const b = await hmacSha256Hex('secret-b', 'message')
		expect(a).not.toBe(b)
	})

	it('is deterministic', async () => {
		const a = await hmacSha256Hex('k', 'm')
		const b = await hmacSha256Hex('k', 'm')
		expect(a).toBe(b)
	})
})

describe('randomHexString', () => {
	it('returns a hex string of the requested byte length × 2', () => {
		const r = randomHexString(16)
		expect(r).toMatch(/^[0-9a-f]{32}$/)
	})

	it('returns different values on subsequent calls (high entropy)', () => {
		const a = randomHexString(32)
		const b = randomHexString(32)
		expect(a).not.toBe(b)
	})

	it('throws on non-positive byteLength', () => {
		expect(() => randomHexString(0)).toThrow(RangeError)
		expect(() => randomHexString(-4)).toThrow(RangeError)
	})

	it('throws on non-integer byteLength', () => {
		expect(() => randomHexString(1.5)).toThrow(RangeError)
	})
})

describe('timingSafeEqualHex', () => {
	it('returns true for equal hex strings', () => {
		expect(timingSafeEqualHex('deadbeef', 'deadbeef')).toBe(true)
	})

	it('returns false for different hex strings of the same length', () => {
		expect(timingSafeEqualHex('deadbeef', 'cafebabe')).toBe(false)
	})

	it('returns false for hex strings of different length (no throw)', () => {
		expect(timingSafeEqualHex('dead', 'deadbeef')).toBe(false)
	})

	it('returns false for invalid hex input', () => {
		expect(timingSafeEqualHex('not-hex', 'deadbeef')).toBe(false)
		expect(timingSafeEqualHex('deadbeefz', 'deadbeefz')).toBe(false)
	})

	it('is case-insensitive on hex digits', () => {
		expect(timingSafeEqualHex('DEADBEEF', 'deadbeef')).toBe(true)
	})
})

describe('timingSafeEqualString', () => {
	it('returns true for equal strings', () => {
		expect(timingSafeEqualString('secret-token', 'secret-token')).toBe(true)
	})

	it('returns false for different strings of the same length', () => {
		expect(timingSafeEqualString('abcdef', 'abcdeg')).toBe(false)
	})

	it('returns false for strings of different length', () => {
		expect(timingSafeEqualString('short', 'longer-string')).toBe(false)
	})

	it('handles unicode (compares UTF-8 bytes)', () => {
		expect(timingSafeEqualString('café', 'café')).toBe(true)
		expect(timingSafeEqualString('café', 'cafe')).toBe(false)
	})
})

describe('runtime guarantee — no node:* imports', () => {
	it('this module does not depend on node:crypto', async () => {
		// Read the source and assert it does not import from node:* — this catches
		// regressions where a maintainer "fixes" something by reaching for node APIs.
		const fs = await import('node:fs/promises')
		const path = await import('node:path')
		const src = await fs.readFile(
			path.join(import.meta.dirname ?? __dirname, 'web-crypto.ts'),
			'utf-8',
		)
		expect(src).not.toMatch(/from\s+['"]node:/)
	})
})
