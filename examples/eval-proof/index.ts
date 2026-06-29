/**
 * Example: signed eval proofs — third-party-verifiable eval results
 *
 * Usage:
 *   bun examples/eval-proof/index.ts
 *
 * No API key needed. Runs a tiny eval suite, signs the result as an Ed25519
 * ExecutionProof, and verifies it offline with only the public key — no shared
 * secret. The same proof verifies with the `elsium verify` CLI.
 *
 * Why it matters: "evals are proof, not opinion". An HMAC attestation only
 * convinces whoever holds the secret; an Ed25519 proof convinces anyone.
 */

import { createEd25519Signer, createKeyRegistry, generateEd25519KeyPair } from '@elsium-ai/core'
import { proveEvalSuite, runEvalSuite, verifyEvalProof } from '@elsium-ai/testing'

// 1. Run an eval suite (mock runner — no API key)
const suite = await runEvalSuite({
	name: 'capital-quiz',
	runner: async (input) => (input.includes('France') ? 'Paris' : 'Berlin'),
	cases: [
		{
			name: 'france',
			input: 'Capital of France?',
			criteria: [{ type: 'contains', value: 'Paris' }],
		},
		{
			name: 'germany',
			input: 'Capital of Germany?',
			criteria: [{ type: 'contains', value: 'Berlin' }],
		},
	],
})
console.log(
	`\n[1] suite "${suite.name}": ${suite.passed}/${suite.total} passed (score ${suite.score})`,
)

// 2. Sign the result as an Ed25519 proof
const pair = generateEd25519KeyPair()
const signer = createEd25519Signer({ privateKey: pair.privateKey, keyId: 'org-k1' })
const proof = await proveEvalSuite(suite, { signer })
console.log(
	`[2] signed proof ${proof.proofId} — ${proof.signature.algorithm}, key ${proof.signature.keyId}`,
)

// 3. A third party verifies offline with ONLY the public key
const registry = createKeyRegistry({
	trustRoots: [{ keyId: 'org-k1', publicKey: pair.publicKey, label: 'org' }],
})
const ok = verifyEvalProof(proof, registry)
console.log(
	`[3] verified offline → valid: ${ok.valid} (signature: ${ok.signatureValid}, chain: ${ok.chainValid})`,
)

// 4. Tampering is detected
const tampered = structuredClone(proof)
const evt = tampered.events.find((e) => e.type === 'custom')
if (evt) (evt.data as { passed?: boolean }).passed = false // flip a real pass to fail
console.log(
	`[4] tampered proof → valid: ${verifyEvalProof(tampered, registry).valid} (tampering detected)`,
)
