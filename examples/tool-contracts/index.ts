/**
 * Example: tool contracts (sideEffectLevel + idempotency + preconditions + dry-run)
 *
 * Usage:
 *   bun examples/tool-contracts/index.ts
 */

import { createInMemoryIdempotencyStore, defineTool } from '@elsium-ai/tools'
import { z } from 'zod'

// ─── Fake bank state ────────────────────────────────────────────

const balances = new Map<string, number>([
	['alice', 1000],
	['bob', 0],
])
const kycVerified = new Set(['alice', 'bob'])
const ledger: { txId: string; from: string; to: string; amount: number }[] = []

// ─── Tool with full contracts ───────────────────────────────────

const idempotencyStore = createInMemoryIdempotencyStore()

const transferTool = defineTool({
	name: 'transferFunds',
	description: 'Move money between accounts',
	input: z.object({
		txId: z.string(),
		from: z.string(),
		to: z.string(),
		amount: z.number().positive(),
	}),
	sideEffectLevel: 'destructive',
	idempotencyKey: (input) => input.txId,
	idempotencyStore,
	preconditions: [
		{
			name: 'hasBalance',
			check: async (i) => ({
				ok: (balances.get(i.from) ?? 0) >= i.amount,
				reason: `insufficient balance (have ${balances.get(i.from) ?? 0}, need ${i.amount})`,
			}),
		},
		{
			name: 'kycVerified',
			check: async (i) => ({
				ok: kycVerified.has(i.to),
				reason: `KYC not verified for "${i.to}"`,
			}),
		},
	],
	dryRunHandler: (input) => ({
		ok: true,
		ref: `PREVIEW:${input.txId}`,
		willTransfer: input.amount,
		from: input.from,
		to: input.to,
	}),
	handler: async (input) => {
		balances.set(input.from, (balances.get(input.from) ?? 0) - input.amount)
		balances.set(input.to, (balances.get(input.to) ?? 0) + input.amount)
		ledger.push(input)
		return { ok: true, ref: input.txId, newBalance: balances.get(input.from) }
	},
})

// ─── 1. Dry-run — skips destructive handler ─────────────────────

console.log('\n[1] dry-run — handler must NOT execute')
const dry = await transferTool.execute(
	{ txId: 'tx-1', from: 'alice', to: 'bob', amount: 50 },
	{ dryRun: true },
)
console.log('  success:', dry.success)
console.log('  dryRun:', dry.dryRun)
console.log('  data:', dry.data)
console.log('  alice balance after dry-run:', balances.get('alice'), '(unchanged)')

// ─── 2. Real transfer ───────────────────────────────────────────

console.log('\n[2] real transfer')
const r1 = await transferTool.execute({ txId: 'tx-1', from: 'alice', to: 'bob', amount: 50 })
console.log('  data:', r1.data)
console.log('  ledger entries:', ledger.length)

// ─── 3. Same txId — cache hit, handler skipped ──────────────────

console.log('\n[3] retry with same txId — idempotent cache hit')
const r2 = await transferTool.execute({ txId: 'tx-1', from: 'alice', to: 'bob', amount: 50 })
console.log('  idempotent:', r2.idempotent)
console.log('  ledger entries (unchanged):', ledger.length)
console.log('  alice balance (unchanged):', balances.get('alice'))

// ─── 4. Precondition failure ────────────────────────────────────

console.log('\n[4] over-budget transfer — precondition denies')
const r3 = await transferTool.execute({
	txId: 'tx-2',
	from: 'alice',
	to: 'bob',
	amount: 9_999_999,
})
console.log('  success:', r3.success)
console.log('  error:', r3.error)
console.log('  preconditionFailures:', r3.preconditionFailures)

// ─── 5. KYC failure on unknown recipient ────────────────────────

console.log('\n[5] unknown recipient — KYC precondition denies')
const r4 = await transferTool.execute({
	txId: 'tx-3',
	from: 'alice',
	to: 'unknown-acct',
	amount: 10,
})
console.log('  preconditionFailures:', r4.preconditionFailures)
