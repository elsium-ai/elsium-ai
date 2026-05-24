import {
	type KeyObject,
	createHash,
	createPrivateKey,
	createPublicKey,
	generateKeyPairSync,
	sign as nodeSign,
	verify as nodeVerify,
} from 'node:crypto'
import { ElsiumError } from '../errors'

export interface Signature {
	algorithm: 'Ed25519'
	keyId: string
	value: string
}

export interface VerifyResult {
	valid: boolean
	keyId?: string
	algorithm?: 'Ed25519'
	reason?: string
}

export interface Signer {
	readonly keyId: string
	readonly algorithm: 'Ed25519'
	readonly fingerprint: string
	sign(payload: string | Uint8Array): Signature
}

export interface PublicKeyResolver {
	resolve(keyId: string): KeyObject | undefined
}

export interface Verifier {
	verify(payload: string | Uint8Array, signature: Signature): VerifyResult
}

export interface Ed25519KeyPair {
	privateKey: string
	publicKey: string
	fingerprint: string
}

const ED25519_ASYM_KEY_TYPE = 'ed25519'

function toBuffer(payload: string | Uint8Array): Buffer {
	if (typeof payload === 'string') return Buffer.from(payload, 'utf8')
	if (payload instanceof Buffer) return payload
	return Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength)
}

function base64UrlEncode(buf: Buffer): string {
	return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function base64UrlDecode(value: string): Buffer {
	const pad = value.length % 4 === 0 ? '' : '='.repeat(4 - (value.length % 4))
	return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

export function computeKeyFingerprint(publicKey: KeyObject): string {
	const der = publicKey.export({ type: 'spki', format: 'der' })
	return createHash('sha256').update(der).digest('hex')
}

function parsePrivateKey(input: string | Uint8Array | KeyObject): KeyObject {
	if (typeof input === 'object' && 'asymmetricKeyType' in input) {
		return input as KeyObject
	}
	try {
		const keyInput =
			typeof input === 'string' ? input : Buffer.from(input as Uint8Array).toString('utf8')
		return createPrivateKey(keyInput)
	} catch (cause) {
		throw new ElsiumError({
			code: 'CONFIG_ERROR',
			message: 'Invalid Ed25519 private key (expected PKCS#8 PEM)',
			retryable: false,
			cause: cause instanceof Error ? cause : undefined,
		})
	}
}

function parsePublicKey(input: string | Uint8Array | KeyObject): KeyObject {
	if (typeof input === 'object' && 'asymmetricKeyType' in input) {
		return input as KeyObject
	}
	try {
		const keyInput =
			typeof input === 'string' ? input : Buffer.from(input as Uint8Array).toString('utf8')
		return createPublicKey(keyInput)
	} catch (cause) {
		throw new ElsiumError({
			code: 'CONFIG_ERROR',
			message: 'Invalid Ed25519 public key (expected SPKI PEM)',
			retryable: false,
			cause: cause instanceof Error ? cause : undefined,
		})
	}
}

function assertEd25519(key: KeyObject, role: 'private' | 'public'): void {
	if (key.asymmetricKeyType !== ED25519_ASYM_KEY_TYPE) {
		throw new ElsiumError({
			code: 'CONFIG_ERROR',
			message: `Expected Ed25519 ${role} key, got ${key.asymmetricKeyType ?? 'unknown'}`,
			retryable: false,
		})
	}
}

function assertNonEmptyKeyId(keyId: string): void {
	if (typeof keyId !== 'string' || keyId.trim() === '') {
		throw new ElsiumError({
			code: 'CONFIG_ERROR',
			message: 'keyId must be a non-empty string',
			retryable: false,
		})
	}
}

export function generateEd25519KeyPair(): Ed25519KeyPair {
	const { privateKey, publicKey } = generateKeyPairSync('ed25519')
	const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
	const publicPem = publicKey.export({ type: 'spki', format: 'pem' }) as string
	return {
		privateKey: privatePem,
		publicKey: publicPem,
		fingerprint: computeKeyFingerprint(publicKey),
	}
}

export function createEd25519Signer(opts: {
	privateKey: string | Uint8Array | KeyObject
	keyId: string
}): Signer {
	assertNonEmptyKeyId(opts.keyId)
	const key = parsePrivateKey(opts.privateKey)
	assertEd25519(key, 'private')

	const publicKey = createPublicKey(key)
	const fingerprint = computeKeyFingerprint(publicKey)

	return {
		keyId: opts.keyId,
		algorithm: 'Ed25519',
		fingerprint,
		sign(payload) {
			const buf = toBuffer(payload)
			const sig = nodeSign(null, buf, key)
			return {
				algorithm: 'Ed25519',
				keyId: opts.keyId,
				value: base64UrlEncode(sig),
			}
		},
	}
}

type VerifyPrep =
	| { kind: 'fail'; result: VerifyResult }
	| { kind: 'ok'; publicKey: KeyObject; sigBytes: Buffer }

function prepareVerify(signature: Signature, resolver: PublicKeyResolver): VerifyPrep {
	if (signature.algorithm !== 'Ed25519') {
		return {
			kind: 'fail',
			result: { valid: false, reason: `Unsupported algorithm: ${signature.algorithm}` },
		}
	}

	const publicKey = resolver.resolve(signature.keyId)
	if (!publicKey) {
		return { kind: 'fail', result: { valid: false, reason: `Unknown keyId: ${signature.keyId}` } }
	}

	if (publicKey.asymmetricKeyType !== ED25519_ASYM_KEY_TYPE) {
		return {
			kind: 'fail',
			result: {
				valid: false,
				reason: `Resolved key for "${signature.keyId}" is not Ed25519`,
			},
		}
	}

	let sigBytes: Buffer
	try {
		sigBytes = base64UrlDecode(signature.value)
	} catch {
		return { kind: 'fail', result: { valid: false, reason: 'Malformed signature encoding' } }
	}

	return { kind: 'ok', publicKey, sigBytes }
}

export function createEd25519Verifier(opts: { resolver: PublicKeyResolver }): Verifier {
	return {
		verify(payload, signature) {
			const prep = prepareVerify(signature, opts.resolver)
			if (prep.kind === 'fail') return prep.result

			const valid = nodeVerify(null, toBuffer(payload), prep.publicKey, prep.sigBytes)
			return {
				valid,
				keyId: valid ? signature.keyId : undefined,
				algorithm: valid ? 'Ed25519' : undefined,
				reason: valid ? undefined : 'Signature does not match payload',
			}
		},
	}
}

export function publicKeyFromPem(pem: string): KeyObject {
	const key = parsePublicKey(pem)
	assertEd25519(key, 'public')
	return key
}

export function privateKeyFromPem(pem: string): KeyObject {
	const key = parsePrivateKey(pem)
	assertEd25519(key, 'private')
	return key
}
