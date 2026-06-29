import type { KeyRegistry, Signer } from '@elsium-ai/core'
import type { ExecutionProof, VerifyProofResult } from '@elsium-ai/observe'
import { createProofRecorder, verifyProof } from '@elsium-ai/observe'
import type { EvalSuiteResult } from './eval'

/**
 * Eval proofs — turn eval results into third-party-verifiable evidence.
 *
 * `attestEvalSuite` (HMAC-SHA256) proves integrity only to whoever holds the
 * shared secret. An eval *proof* is signed with Ed25519 and emitted as a standard
 * `ExecutionProof`, so anyone can verify it offline with just the public key — no
 * secret shared — using `verifyEvalProof` or the existing `elsium verify` CLI.
 *
 * This bridges the two previously separate worlds: eval results and the
 * Ed25519-signed proof chain in `@elsium-ai/observe`.
 */

export interface EvalProofOptions {
	/** Ed25519 signer, e.g. from `createEd25519Signer` in `@elsium-ai/core`. */
	signer: Signer
	/** Logical id for the suite (defaults to the suite name). */
	suiteId?: string
	/** Injected clock for deterministic tests. */
	clock?: () => number
}

/**
 * Sign an eval suite result as an Ed25519 `ExecutionProof`. Each case becomes a
 * hash-chained event; the chain head is signed once. Returns a proof that
 * verifies offline with only the public key.
 */
export async function proveEvalSuite(
	result: EvalSuiteResult,
	options: EvalProofOptions,
): Promise<ExecutionProof> {
	const recorder = createProofRecorder({ signer: options.signer, clock: options.clock })
	const session = recorder.startSession({
		agentId: options.suiteId ?? result.name,
		inputs: { constraints: { suite: result.name, total: result.total } },
	})

	for (const r of result.results) {
		session.recordCustom({
			type: 'eval.case',
			name: r.name,
			passed: r.passed,
			score: r.score,
		})
	}

	return session.finalize({
		finalOutput: {
			suite: result.name,
			total: result.total,
			passed: result.passed,
			failed: result.failed,
			score: result.score,
		},
	})
}

/**
 * Verify an eval proof offline using a key registry of trusted public keys.
 * Re-derives the hash chain and checks the Ed25519 signature — no secret needed.
 */
export function verifyEvalProof(proof: ExecutionProof, registry: KeyRegistry): VerifyProofResult {
	return verifyProof(proof, registry)
}
