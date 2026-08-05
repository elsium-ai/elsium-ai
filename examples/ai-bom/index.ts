/**
 * Example: AI-BOM — a signed declaration of what an agent is made of
 *
 * Usage:
 *   bun examples/ai-bom/index.ts
 *
 * No API key needed. Generates a signed AI-BOM for an agent, verifies it
 * offline, then simulates a Friday-afternoon change — a new tool, an edited
 * prompt, a widened sandbox — and shows the release gate catching it.
 *
 * Why it matters: an npm lockfile pins `zod@3.24.0` and says nothing about
 * which model answers, which prompt steers it, or what the agent may execute.
 * Those are the real dependencies of an AI system. The AI-BOM pins them, signs
 * them, and fails CI when they drift from what was approved.
 */

import { createEd25519Signer, createKeyRegistry, generateEd25519KeyPair } from '@elsium-ai/core'
import {
	type AiBomInput,
	diffAiBom,
	generateAiBom,
	passesGate,
	verifyAiBom,
} from '@elsium-ai/observe'
import { defineTool } from '@elsium-ai/tools'
import { z } from 'zod'

// ─── The agent's composition, as it was signed off ──────────────

const creditCheck = defineTool({
	name: 'credit_check',
	description: 'Query the credit bureau for an applicant score',
	input: z.object({ applicantId: z.string() }),
	handler: async ({ applicantId }) => ({ applicantId, score: 720 }),
	sideEffectLevel: 'read',
	sandbox: {
		mode: 'worker',
		handler: './handlers/credit.mjs',
		capabilities: ['network:api.bureau.com'],
	},
})

const SYSTEM_PROMPT = 'You assess loan applications against the lending policy. Be conservative.'

const approvedComposition: AiBomInput = {
	agentId: 'loan-underwriter',
	agentVersion: '2.3.1',
	environment: 'production',
	models: [
		{ provider: 'anthropic', model: 'claude-sonnet-4-6', role: 'primary', region: 'eu-west-1' },
	],
	prompts: [{ name: 'system', version: '7', content: SYSTEM_PROMPT }],
	// A real `Tool` is accepted by shape — observe never imports @elsium-ai/tools.
	tools: [creditCheck],
	datasets: [
		{
			name: 'golden-loans',
			version: '1.2',
			caseCount: 240,
			contentHash: 'd'.repeat(64),
			annotatorAgreement: 0.91,
		},
	],
	policies: [
		{ name: 'lending-policy', version: '3', mode: 'enforce', document: { deny: ['model:gpt-4o'] } },
	],
	thresholds: { confidenceFloor: 0.8, maxCostUsd: 5 },
	runtime: { framework: 'elsium-ai', frameworkVersion: '0.18.0' },
}

// ─── 1. Generate and sign ───────────────────────────────────────

const pair = generateEd25519KeyPair()
const signer = createEd25519Signer({ privateKey: pair.privateKey, keyId: 'release-key' })
const registry = createKeyRegistry({
	trustRoots: [{ keyId: 'release-key', publicKey: pair.publicKey }],
})

const approvedBom = await generateAiBom(approvedComposition, { signer })

console.log('1. Approved AI-BOM')
console.log(`   agent:          ${approvedBom.agentId}@${approvedBom.agentVersion}`)
console.log(`   componentsHash: ${approvedBom.componentsHash.slice(0, 24)}…`)
console.log(
	`   parts:          ${approvedBom.components.models.length} model, ${approvedBom.components.tools.length} tool, ${approvedBom.components.policies.length} policy\n`,
)

// ─── 2. Verify offline ──────────────────────────────────────────

const verified = await verifyAiBom(approvedBom, registry)
console.log('2. Offline verification')
console.log(`   valid: ${verified.valid} (signature + component hash + header digest)\n`)

// ─── 3. Determinism: same composition → same hash ───────────────

const regenerated = await generateAiBom(approvedComposition, { signer })
console.log('3. Determinism')
console.log(
	`   regenerated hash matches: ${regenerated.componentsHash === approvedBom.componentsHash}\n`,
)

// ─── 4. Friday afternoon happens ────────────────────────────────

const wireTransfer = defineTool({
	name: 'wire_transfer',
	description: 'Send funds',
	input: z.object({ amount: z.number() }),
	handler: async ({ amount }) => ({ sent: amount }),
	sideEffectLevel: 'write',
	sandbox: { mode: 'worker', handler: './handlers/wire.mjs', capabilities: ['network:*'] },
})

const shippedBom = await generateAiBom(
	{
		...approvedComposition,
		// Someone tweaked the prompt…
		prompts: [
			{ name: 'system', version: '8', content: `${SYSTEM_PROMPT} Approve borderline cases.` },
		],
		// …added a tool that moves money…
		tools: [creditCheck, wireTransfer],
		// …and relaxed the confidence floor.
		thresholds: { confidenceFloor: 0.4, maxCostUsd: 5 },
		runtime: { framework: 'elsium-ai', frameworkVersion: '0.19.0' },
	},
	{ signer },
)

const diff = diffAiBom(approvedBom, shippedBom)

console.log('4. Release gate — approved vs shipped')
for (const drift of diff.drifts) {
	console.log(`   [${drift.severity.padEnd(8)}] ${drift.reason}`)
}
console.log(
	`\n   ${diff.counts.critical} critical, ${diff.counts.major} major, ${diff.counts.minor} minor`,
)
console.log(`   gate (--fail-on=critical): ${passesGate(diff) ? 'PASS' : 'FAIL'}`)
console.log(`   gate (--fail-on=minor):    ${passesGate(diff, 'minor') ? 'PASS' : 'FAIL'}`)

// ─── 5. Tampering is detectable ─────────────────────────────────

const tampered = {
	...approvedBom,
	components: {
		...approvedBom.components,
		tools: [{ ...approvedBom.components.tools[0], capabilities: ['network:*'] }],
	},
}
const tamperResult = await verifyAiBom(tampered, registry)
console.log('\n5. Tamper detection')
console.log(`   valid: ${tamperResult.valid} — ${tamperResult.reason}`)

console.log('\nCI usage:')
console.log('   elsium bom verify ./aibom.json --public-key ./release.pub')
console.log('   elsium bom diff ./approved-bom.json ./aibom.json --fail-on critical')
