/**
 * Example: askHuman — durable human-in-the-loop
 *
 * Usage:
 *   bun examples/ask-human/index.ts
 */

import { askHuman, createInMemoryAskHumanStore, resolveAskHuman } from '@elsium-ai/agents'

// ─── Responder mode — synchronous answer ────────────────────────

console.log('\n[1] responder mode — auto-approve')
const approved = await askHuman({
	question: 'Approve refund of $750 to customer #4421?',
	options: ['approve', 'deny'] as const,
	context: { amount: 750, customerId: 4421 },
	responder: async (req) => ({
		status: 'approved',
		option: 'approve',
		reason: `auto-approved by policy: amount ${(req.context as { amount: number }).amount} ≤ 1000`,
		decidedBy: 'policy-engine',
		decidedAt: Date.now(),
	}),
})
console.log('  →', approved)

console.log('\n[2] responder mode — auto-deny')
const denied = await askHuman({
	question: 'Approve refund of $5000?',
	options: ['approve', 'deny'] as const,
	responder: async () => ({
		status: 'rejected',
		option: 'deny',
		reason: 'exceeds auto-approve threshold',
		decidedBy: 'policy-engine',
		decidedAt: Date.now(),
	}),
})
console.log('  →', denied)

// ─── Store mode — durable, human responds later ─────────────────

console.log('\n[3] store mode — agent waits; human resolves out-of-band')
const store = createInMemoryAskHumanStore()

// Simulate a human reviewer answering after 100ms from a separate code path
const requestId = `req-${Date.now()}`
setTimeout(async () => {
	console.log('  [human]: I see the question — approving manually')
	await resolveAskHuman(store, requestId, {
		status: 'approved',
		option: 'approve',
		reason: 'reviewed customer history, looks legit',
		decidedBy: 'reviewer@example.com',
	})
}, 100)

const decision = await askHuman({
	requestId,
	question: 'Refund of $1200 — needs human review',
	options: ['approve', 'deny'] as const,
	context: { amount: 1200 },
	store,
	timeoutMs: '5s',
})
console.log('  →', decision)

// ─── Timeout behavior ───────────────────────────────────────────

console.log('\n[4] store mode — timeout (no human responds)')
const timeoutStore = createInMemoryAskHumanStore()
const timedOut = await askHuman({
	question: 'High-risk action — confirm?',
	options: ['confirm', 'cancel'] as const,
	store: timeoutStore,
	timeoutMs: 150,
	onTimeout: 'timeout',
})
console.log('  →', timedOut)
