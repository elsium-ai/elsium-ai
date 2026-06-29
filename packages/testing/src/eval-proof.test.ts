import { createEd25519Signer, createKeyRegistry, generateEd25519KeyPair } from '@elsium-ai/core'
import { describe, expect, it } from 'vitest'
import type { EvalSuiteResult } from './eval'
import { proveEvalSuite, verifyEvalProof } from './eval-proof'

function sampleResult(): EvalSuiteResult {
	return {
		name: 'capital-quiz',
		total: 2,
		passed: 1,
		failed: 1,
		score: 0.5,
		durationMs: 10,
		results: [
			{ name: 'france', passed: true, score: 1, criteria: [], input: 'capital of France?' },
			{ name: 'germany', passed: false, score: 0, criteria: [], input: 'capital of Germany?' },
		],
	}
}

function setup() {
	const pair = generateEd25519KeyPair()
	const signer = createEd25519Signer({ privateKey: pair.privateKey, keyId: 'org-k1' })
	const registry = createKeyRegistry({
		trustRoots: [{ keyId: 'org-k1', publicKey: pair.publicKey }],
	})
	return { pair, signer, registry }
}

describe('eval proofs (Ed25519)', () => {
	it('signs an eval suite and verifies offline with only the public key', async () => {
		const { signer, registry } = setup()
		const proof = await proveEvalSuite(sampleResult(), { signer })

		const result = verifyEvalProof(proof, registry)
		expect(result.valid).toBe(true)
		expect(result.signatureValid).toBe(true)
		expect(result.chainValid).toBe(true)
		expect(proof.signature.algorithm).toBe('Ed25519')
	})

	it('records one chained event per eval case', async () => {
		const { signer, registry } = setup()
		const proof = await proveEvalSuite(sampleResult(), { signer })
		const caseEvents = proof.events.filter((e) => e.type === 'custom')
		expect(caseEvents.length).toBe(2)
		expect(verifyEvalProof(proof, registry).valid).toBe(true)
	})

	it('fails verification when an event is tampered', async () => {
		const { signer, registry } = setup()
		const proof = await proveEvalSuite(sampleResult(), { signer })
		// Tamper with a recorded case score after signing.
		const tampered = structuredClone(proof)
		const evt = tampered.events.find((e) => e.type === 'custom')
		if (evt) {
			const d = evt.data as { passed?: boolean }
			d.passed = !d.passed
		}

		expect(verifyEvalProof(tampered, registry).valid).toBe(false)
	})

	it('fails verification under an unknown key', async () => {
		const { signer } = setup()
		const proof = await proveEvalSuite(sampleResult(), { signer })
		const otherPair = generateEd25519KeyPair()
		const otherRegistry = createKeyRegistry({
			trustRoots: [{ keyId: 'org-k1', publicKey: otherPair.publicKey }],
		})
		expect(verifyEvalProof(proof, otherRegistry).valid).toBe(false)
	})
})
