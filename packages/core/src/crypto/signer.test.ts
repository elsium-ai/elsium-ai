import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { ElsiumError } from '../errors'
import { createKeyRegistry } from './key-registry'
import {
	computeKeyFingerprint,
	createEd25519Signer,
	createEd25519Verifier,
	generateEd25519KeyPair,
	privateKeyFromPem,
	publicKeyFromPem,
} from './signer'

describe('generateEd25519KeyPair', () => {
	it('produces a valid PEM keypair with stable fingerprint', () => {
		const pair = generateEd25519KeyPair()
		expect(pair.privateKey).toMatch(/-----BEGIN PRIVATE KEY-----/)
		expect(pair.publicKey).toMatch(/-----BEGIN PUBLIC KEY-----/)
		expect(pair.fingerprint).toMatch(/^[a-f0-9]{64}$/)

		const reparsed = publicKeyFromPem(pair.publicKey)
		expect(computeKeyFingerprint(reparsed)).toBe(pair.fingerprint)
	})

	it('generates distinct keypairs on each call', () => {
		const a = generateEd25519KeyPair()
		const b = generateEd25519KeyPair()
		expect(a.fingerprint).not.toBe(b.fingerprint)
	})
})

describe('Ed25519 sign + verify roundtrip', () => {
	it('produces a verifiable signature for a string payload', () => {
		const pair = generateEd25519KeyPair()
		const signer = createEd25519Signer({ privateKey: pair.privateKey, keyId: 'k1' })
		const registry = createKeyRegistry({ trustRoots: [{ keyId: 'k1', publicKey: pair.publicKey }] })
		const verifier = createEd25519Verifier({ resolver: registry })

		const sig = signer.sign('hello, elsium')
		expect(sig.algorithm).toBe('Ed25519')
		expect(sig.keyId).toBe('k1')
		expect(sig.value.length).toBeGreaterThan(40)

		const result = verifier.verify('hello, elsium', sig)
		expect(result.valid).toBe(true)
		expect(result.keyId).toBe('k1')
		expect(result.algorithm).toBe('Ed25519')
	})

	it('produces a verifiable signature for Uint8Array payload', () => {
		const pair = generateEd25519KeyPair()
		const signer = createEd25519Signer({ privateKey: pair.privateKey, keyId: 'k1' })
		const registry = createKeyRegistry({ trustRoots: [{ keyId: 'k1', publicKey: pair.publicKey }] })
		const verifier = createEd25519Verifier({ resolver: registry })

		const payload = new Uint8Array([1, 2, 3, 4, 5])
		const sig = signer.sign(payload)
		expect(verifier.verify(payload, sig).valid).toBe(true)
	})

	it('rejects tampered payload', () => {
		const pair = generateEd25519KeyPair()
		const signer = createEd25519Signer({ privateKey: pair.privateKey, keyId: 'k1' })
		const registry = createKeyRegistry({ trustRoots: [{ keyId: 'k1', publicKey: pair.publicKey }] })
		const verifier = createEd25519Verifier({ resolver: registry })

		const sig = signer.sign('original payload')
		const result = verifier.verify('tampered payload', sig)
		expect(result.valid).toBe(false)
		expect(result.reason).toContain('does not match')
	})

	it('rejects signature from unknown keyId', () => {
		const pair = generateEd25519KeyPair()
		const signer = createEd25519Signer({ privateKey: pair.privateKey, keyId: 'k1' })
		const registry = createKeyRegistry()
		const verifier = createEd25519Verifier({ resolver: registry })

		const sig = signer.sign('payload')
		const result = verifier.verify('payload', sig)
		expect(result.valid).toBe(false)
		expect(result.reason).toContain('Unknown keyId')
	})

	it('rejects malformed signature encoding', () => {
		const pair = generateEd25519KeyPair()
		const registry = createKeyRegistry({ trustRoots: [{ keyId: 'k1', publicKey: pair.publicKey }] })
		const verifier = createEd25519Verifier({ resolver: registry })

		const result = verifier.verify('payload', {
			algorithm: 'Ed25519',
			keyId: 'k1',
			value: 'not-base64url-but-valid-chars',
		})
		expect(result.valid).toBe(false)
	})

	it('rejects unsupported algorithm', () => {
		const pair = generateEd25519KeyPair()
		const registry = createKeyRegistry({ trustRoots: [{ keyId: 'k1', publicKey: pair.publicKey }] })
		const verifier = createEd25519Verifier({ resolver: registry })

		const result = verifier.verify('payload', {
			algorithm: 'HS256' as 'Ed25519',
			keyId: 'k1',
			value: 'AAAA',
		})
		expect(result.valid).toBe(false)
		expect(result.reason).toContain('Unsupported algorithm')
	})
})

describe('Ed25519 signer config errors', () => {
	it('throws on empty keyId', () => {
		const pair = generateEd25519KeyPair()
		expect(() => createEd25519Signer({ privateKey: pair.privateKey, keyId: '' })).toThrow(
			ElsiumError,
		)
	})

	it('throws on invalid private key PEM', () => {
		expect(() => createEd25519Signer({ privateKey: 'not a key', keyId: 'k1' })).toThrow(
			'Invalid Ed25519 private key',
		)
	})

	it('throws when private key is RSA instead of Ed25519', () => {
		const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
		const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
		expect(() => createEd25519Signer({ privateKey: pem, keyId: 'k1' })).toThrow(/Expected Ed25519/)
	})

	it('parses private and public keys back from PEM', () => {
		const pair = generateEd25519KeyPair()
		const priv = privateKeyFromPem(pair.privateKey)
		const pub = publicKeyFromPem(pair.publicKey)
		expect(priv.asymmetricKeyType).toBe('ed25519')
		expect(pub.asymmetricKeyType).toBe('ed25519')
	})
})
