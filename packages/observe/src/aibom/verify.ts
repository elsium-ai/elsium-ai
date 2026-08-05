import { type KeyRegistry, createEd25519Verifier } from '@elsium-ai/core'
import { hashCanonical } from './canonical'
import { bomSigningPayload } from './generate'
import { AIBOM_VERSION, type AiBom, type VerifyAiBomResult } from './types'

function digestInput(bom: AiBom): Record<string, unknown> {
	return {
		version: bom.version,
		bomId: bom.bomId,
		agentId: bom.agentId,
		agentVersion: bom.agentVersion,
		generatedAt: bom.generatedAt,
		environment: bom.environment,
		componentsHash: bom.componentsHash,
		metadata: bom.metadata,
	}
}

const FAILED = {
	valid: false,
	signatureValid: false,
	componentsHashValid: false,
	digestValid: false,
} as const

const NOTHING_CHECKED = { componentsHash: false, digest: false, signature: false } as const

/**
 * Verify an AI-BOM offline: components match their hash, the header matches
 * the digest, and the digest carries a signature from a trusted key.
 *
 * Checks run inner-to-outer so the failure reason names the innermost break —
 * a swapped tool reports as a component-hash mismatch, not a bad signature.
 */
export async function verifyAiBom(bom: AiBom, registry: KeyRegistry): Promise<VerifyAiBomResult> {
	if (bom?.version !== AIBOM_VERSION) {
		return {
			...FAILED,
			checked: { ...NOTHING_CHECKED },
			reason: `Unsupported AI-BOM version: ${String(bom?.version)}`,
		}
	}

	const recomputedComponents = await hashCanonical(bom.components)
	if (recomputedComponents !== bom.componentsHash) {
		return {
			...FAILED,
			checked: { ...NOTHING_CHECKED, componentsHash: true },
			reason: 'componentsHash does not match the declared components',
		}
	}

	const recomputedDigest = await hashCanonical(digestInput(bom))
	if (recomputedDigest !== bom.digest) {
		return {
			...FAILED,
			componentsHashValid: true,
			checked: { componentsHash: true, digest: true, signature: false },
			reason: 'digest does not match the BOM header',
		}
	}

	const verifier = createEd25519Verifier({ resolver: registry })
	const sigResult = verifier.verify(bomSigningPayload(bom.bomId, bom.digest), bom.signature)

	return {
		valid: sigResult.valid,
		signatureValid: sigResult.valid,
		componentsHashValid: true,
		digestValid: true,
		checked: { componentsHash: true, digest: true, signature: true },
		reason: sigResult.reason,
	}
}
