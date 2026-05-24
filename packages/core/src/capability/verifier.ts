import { createEd25519Verifier } from '../crypto/signer'
import type { PublicKeyResolver } from '../crypto/signer'
import { tokenSigningPayload } from './issuer'
import type { RevocationStore } from './revocation'
import type { CapabilityCheckReason, CapabilityToken } from './types'
import { CAPABILITY_TOKEN_VERSION } from './types'

export interface TokenVerificationResult {
	valid: boolean
	signatureValid: boolean
	withinValidityWindow: boolean
	reason?: CapabilityCheckReason
	detail?: string
}

export interface CapabilityVerifierConfig {
	resolver: PublicKeyResolver
	clock?: () => number
	revocationStore?: RevocationStore
}

export interface CapabilityVerifier {
	verifyToken(token: CapabilityToken): TokenVerificationResult
	verifyTokenAsync(token: CapabilityToken): Promise<TokenVerificationResult>
}

function fail(
	reason: CapabilityCheckReason,
	detail?: string,
	overrides: Partial<TokenVerificationResult> = {},
): TokenVerificationResult {
	return {
		valid: false,
		signatureValid: false,
		withinValidityWindow: false,
		reason,
		detail,
		...overrides,
	}
}

function checkShape(token: CapabilityToken): TokenVerificationResult | null {
	if (!token || token.version !== CAPABILITY_TOKEN_VERSION) {
		return fail('malformed', `unsupported version: ${token?.version ?? 'undefined'}`)
	}
	if (!token.validity || !Number.isFinite(token.validity.expiresAt)) {
		return fail('malformed', 'missing validity window')
	}
	return null
}

function isWithinWindow(token: CapabilityToken, now: number): boolean {
	const { validity } = token
	const afterStart = validity.notBefore === undefined || now >= validity.notBefore
	return afterStart && now < validity.expiresAt
}

function expiryReason(token: CapabilityToken, now: number): CapabilityCheckReason {
	const nb = token.validity.notBefore
	return nb !== undefined && now < nb ? 'not-yet-valid' : 'expired'
}

export function createCapabilityVerifier(config: CapabilityVerifierConfig): CapabilityVerifier {
	const clock = config.clock ?? (() => Date.now())
	const cryptoVerifier = createEd25519Verifier({ resolver: config.resolver })

	const verifyToken = (token: CapabilityToken): TokenVerificationResult => {
		const shape = checkShape(token)
		if (shape) return shape

		const now = clock()
		const within = isWithinWindow(token, now)

		const { signature, ...unsigned } = token
		const sigResult = cryptoVerifier.verify(tokenSigningPayload(unsigned), signature)
		if (!sigResult.valid) {
			return {
				valid: false,
				signatureValid: false,
				withinValidityWindow: within,
				reason: sigResult.reason?.includes('Unknown keyId') ? 'unknown-key' : 'bad-signature',
				detail: sigResult.reason,
			}
		}

		if (!within) {
			return {
				valid: false,
				signatureValid: true,
				withinValidityWindow: false,
				reason: expiryReason(token, now),
				detail: `now=${now} notBefore=${token.validity.notBefore} expiresAt=${token.validity.expiresAt}`,
			}
		}

		return { valid: true, signatureValid: true, withinValidityWindow: true }
	}

	const verifyTokenAsync = async (token: CapabilityToken): Promise<TokenVerificationResult> => {
		const result = verifyToken(token)
		if (!result.valid) return result
		if (!config.revocationStore) return result

		const revoked = await config.revocationStore.isRevoked(token.tokenId)
		if (revoked) {
			const entry = await config.revocationStore.getEntry(token.tokenId)
			return {
				valid: false,
				signatureValid: true,
				withinValidityWindow: true,
				reason: 'revoked',
				detail: entry?.reason ?? `tokenId ${token.tokenId} is revoked`,
			}
		}
		return result
	}

	return { verifyToken, verifyTokenAsync }
}
