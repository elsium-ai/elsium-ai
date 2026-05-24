/**
 * Example: Capability Tokens (β-1 + β-2)
 *
 * Demonstrates the full surface: mint → tool guard → delegate → revoke.
 * Uses mock providers so it runs without API keys.
 *
 * Usage:
 *   bun examples/capability-tokens/index.ts
 */

import {
	createCapabilityIssuer,
	createCapabilityVerifier,
	createEd25519Signer,
	createInMemoryRevocationStore,
	createKeyRegistry,
	generateEd25519KeyPair,
} from '@elsium-ai/core'
import { defineTool, withCapability } from '@elsium-ai/tools'
import { z } from 'zod'

// ─── 1. Set up issuer + verifier ──────────────────────────────

const pair = generateEd25519KeyPair()
const signer = createEd25519Signer({ privateKey: pair.privateKey, keyId: 'org-aperion-k7' })
const registry = createKeyRegistry({
	trustRoots: [{ keyId: 'org-aperion-k7', publicKey: pair.publicKey, label: 'main' }],
})
const revocationStore = createInMemoryRevocationStore()
const verifier = createCapabilityVerifier({ resolver: registry, revocationStore })
const issuer = createCapabilityIssuer({ signer, orgId: 'aperion-gaming' })

// ─── 2. Mint a token for an agent run ─────────────────────────

const token = issuer.mint({
	subject: { agent: 'support-bot-v3', runId: 'run_xyz' },
	capabilities: [
		{
			kind: 'tool',
			name: 'customer.read',
			constraints: { allowedFields: ['name', 'email'] },
		},
		{ kind: 'llm', provider: 'anthropic', maxCost: 0.5 },
	],
	dataClasses: { allowed: ['public', 'internal'], denied: ['pii', 'financial'] },
	ttlMs: 60 * 60 * 1000,
})
console.log('🎫 Minted token', token.tokenId)

// ─── 3. Guard a tool ──────────────────────────────────────────

const customerReadTool = defineTool({
	name: 'customer.read',
	description: 'Read customer fields',
	input: z.object({ id: z.string(), name: z.string().optional(), email: z.string().optional() }),
	handler: async (input) => ({ found: true, ...input }),
})

const guardedTool = withCapability(customerReadTool, {
	token,
	verifier,
	onDeny: (e) => console.log(`  ⛔ deny: ${e.toolName} → ${e.reason} (${e.detail ?? 'no detail'})`),
})

console.log('\n[allowed call — name + email]')
const ok = await guardedTool.execute({ id: 'c1', name: 'Ana', email: 'ana@x.com' })
console.log('  result:', ok.success ? 'OK' : ok.error)

console.log('\n[denied call — extra field "salary" not in allowedFields]')
const blocked = await guardedTool.execute({
	id: 'c1',
	name: 'Ana',
	email: 'ana@x.com',
	salary: 10000,
} as never)
console.log('  result:', blocked.success ? 'OK' : blocked.error)

// ─── 4. Delegate a strict-subset child token ──────────────────

const child = issuer.delegate(token, {
	subject: { agent: 'support-bot-v3:translator-sub' },
	capabilities: [
		{
			kind: 'tool',
			name: 'customer.read',
			constraints: { allowedFields: ['name'] },
		},
		{ kind: 'llm', provider: 'anthropic', maxCost: 0.1 },
	],
})
console.log('\n🌳 Delegated child token', child.tokenId)
console.log('   parent:', child.subject.parentToken)
console.log('   capabilities tighter:', JSON.stringify(child.capabilities, null, 2))

// ─── 5. Revoke and verify async ────────────────────────────────

await revocationStore.revoke(token.tokenId, { reason: 'manual revoke', revokedBy: 'admin' })

const result = await verifier.verifyTokenAsync(token)
console.log('\n🚫 After revoke — verifyTokenAsync:', {
	valid: result.valid,
	reason: result.reason,
	detail: result.detail,
})
