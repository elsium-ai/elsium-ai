/**
 * Example: Verifiable Agent Execution (α-1 + α-2)
 *
 * Captures an agent run as a signed ExecutionProof, persists it to disk,
 * and verifies offline using only the public key.
 *
 * Usage:
 *   export ANTHROPIC_API_KEY=your-key
 *   bun examples/verifiable-agent-execution/index.ts
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
	createEd25519Signer,
	createFileWriteOnceStore,
	createKeyRegistry,
	env,
	generateEd25519KeyPair,
} from '@elsium-ai/core'
import { gateway } from '@elsium-ai/gateway'
import { PROOF_SESSION_METADATA_KEY, createProofRecorder, verifyProof } from '@elsium-ai/observe'

const OUT_DIR = './examples/verifiable-agent-execution/proofs'
mkdirSync(OUT_DIR, { recursive: true })

// 1. Mint an Ed25519 keypair for the organization
const pair = generateEd25519KeyPair()
writeFileSync(join(OUT_DIR, 'org.pub'), pair.publicKey)
console.log('🔑 Public key written to', join(OUT_DIR, 'org.pub'))

const signer = createEd25519Signer({
	privateKey: pair.privateKey,
	keyId: 'org-example-k1',
})

// 2. Create the proof recorder + start a session for an agent run
const recorder = createProofRecorder({ signer })
const session = recorder.startSession({
	agentId: 'invoice-extractor',
	agentVersion: '1.0.0',
	inputs: { messages: [{ role: 'user', content: 'Extract invoice from raw text…' }] },
})

// 3. Wire the gateway middleware so LLM calls are auto-recorded
const llm = gateway({
	provider: 'anthropic',
	apiKey: env('ANTHROPIC_API_KEY'),
	middleware: [recorder.middleware()],
})

const response = await llm.complete({
	messages: [
		{
			role: 'user',
			content: 'Return JSON: { "total": 1234, "vendor": "Acme" }. Reply only JSON.',
		},
	],
	metadata: { [PROOF_SESSION_METADATA_KEY]: session.proofId },
})
console.log('💬 LLM response captured:', response.message.content)

// 4. Record domain-specific events
session.recordToolCall({ tool: 'parse_invoice', inputHash: 'in_h', outputHash: 'out_h' })
session.recordPolicyDecision({ rule: 'pii-allowed', result: 'allow' })

// 5. Finalize → persist signed proof to a tamper-evident store (O_EXCL on POSIX)
const store = createFileWriteOnceStore({ dir: OUT_DIR })
const proof = await session.finalize({
	finalOutput: { total: 1234, vendor: 'Acme' },
	store,
})
console.log(`📝 Proof saved: ${OUT_DIR}/${proof.proofId}.json`)
console.log(`   chainHead: ${proof.chainHead.slice(0, 16)}…`)
console.log(`   events:    ${proof.events.length}`)
console.log(`   signature: ${proof.signature.keyId}`)

// 6. Verify offline using only the public key (no API keys, no network)
const registry = createKeyRegistry({
	trustRoots: [{ keyId: 'org-example-k1', publicKey: pair.publicKey, label: 'org example' }],
})
const result = verifyProof(proof, registry)
console.log('\n✅ verifyProof:', result)
console.log('\nTip — verify from the CLI on another machine:')
console.log(`  elsium verify ${OUT_DIR}/${proof.proofId}.json --public-key ${OUT_DIR}/org.pub`)
