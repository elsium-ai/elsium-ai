import type { KeyRegistry } from '@elsium-ai/core'
import { verifyProof } from '../proof/recorder'
import type { ExecutionProof } from '../proof/types'

export interface RejectedTrace {
	proofId: string
	reason: string
	/** Event index where the hash chain broke, when that is the failure. */
	chainBrokenAt?: number
}

export interface VerifiedCorpus {
	/** Traces whose signature and hash chain both check out. */
	traces: readonly ExecutionProof[]
	/** Traces excluded, with why. */
	rejected: readonly RejectedTrace[]
	/** True when every trace passed. */
	complete: boolean
}

/**
 * Filter a corpus down to the runs that can be trusted as evidence.
 *
 * A simulation is only worth the history it runs on. Proofs are signed and
 * hash-chained precisely so nobody can quietly edit what happened — but that
 * guarantee is inert unless something checks it. Simulating over an unverified
 * corpus produces a plan that looks authoritative and is not: drop the three
 * runs where the policy would have fired, and the plan says the rule is safe
 * to ship.
 *
 * Rejections are returned rather than thrown. A corpus with tampered entries
 * is itself a finding, and hiding the rest of the history behind an exception
 * would help nobody.
 */
export function verifyCorpus(
	traces: readonly ExecutionProof[],
	registry: KeyRegistry,
): VerifiedCorpus {
	const verified: ExecutionProof[] = []
	const rejected: RejectedTrace[] = []

	for (const trace of traces) {
		const result = verifyProof(trace, registry)
		if (result.valid) {
			verified.push(trace)
			continue
		}

		rejected.push({
			proofId: trace.proofId,
			reason: result.reason ?? (result.chainValid ? 'invalid signature' : 'broken hash chain'),
			chainBrokenAt: result.chainBrokenAt,
		})
	}

	return { traces: verified, rejected, complete: rejected.length === 0 }
}
