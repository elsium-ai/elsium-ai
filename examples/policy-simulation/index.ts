/**
 * Example: policy simulation — what a rule would have done, before it decides
 * anything for real
 *
 * Usage:
 *   bun examples/policy-simulation/index.ts
 *
 * No API key needed. Builds a corpus of recorded runs, then asks a candidate
 * policy what it would have blocked — with traceIds, before shipping it.
 *
 * Why it matters: governance controls fail on adoption, not on design. Nobody
 * enables a security rule in production without knowing what it breaks, so
 * policies sit in monitor-only mode forever and protect nothing. This is the
 * missing answer to "what will this block?".
 */

import {
	createEd25519Signer,
	createFlowPolicy,
	createKeyRegistry,
	createLabel,
	generateEd25519KeyPair,
	lethalTrifectaRule,
} from '@elsium-ai/core'
import {
	type ExecutionProof,
	comparePolicies,
	createProofRecorder,
	flowPolicyProbe,
	formatComparison,
	formatSimulation,
	simulatePolicy,
} from '@elsium-ai/observe'

// ─── A corpus of recorded runs ──────────────────────────────────

const pair = generateEd25519KeyPair()
const recorder = createProofRecorder({
	signer: createEd25519Signer({ privateKey: pair.privateKey, keyId: 'k1' }),
})
const registry = createKeyRegistry({ trustRoots: [{ keyId: 'k1', publicKey: pair.publicKey }] })

async function record(
	id: string,
	build: (s: ReturnType<typeof recorder.startSession>) => void,
): Promise<ExecutionProof> {
	const session = recorder.startSession({ agentId: `support-agent-${id}` })
	build(session)
	return session.finalize()
}

const traces: ExecutionProof[] = []

// 97 ordinary runs: retrieve from the knowledge base, answer, look something up.
for (let i = 0; i < 97; i++) {
	traces.push(
		await record(`ok-${i}`, (s) => {
			s.recordRagRetrieve({ docs: [{ id: `kb-${i % 12}` }] })
			s.recordLLMCall({
				model: 'claude-sonnet-4-6',
				provider: 'anthropic',
				requestHash: 'a',
				responseHash: 'b',
			})
			s.recordToolCall({ tool: 'lookup_order', inputHash: 'c', outputHash: 'd' })
		}),
	)
}

// 3 runs where a retrieved document was attacker-controlled and the agent
// then reached for an outbound tool.
for (let i = 0; i < 3; i++) {
	traces.push(
		await record(`exfil-${i}`, (s) => {
			s.recordRagRetrieve({ docs: [{ id: `invoice-88${i}` }] })
			s.recordLLMCall({
				model: 'claude-sonnet-4-6',
				provider: 'anthropic',
				requestHash: 'a',
				responseHash: 'b',
			})
			s.recordToolCall({ tool: 'send_email', inputHash: 'c', outputHash: 'd' })
		}),
	)
}

console.log(`Corpus: ${traces.length} recorded runs\n`)
console.log('─'.repeat(68))

// ─── Attempt 1: the rule straight out of the box ────────────────

console.log('\n1. Candidate policy: lethalTrifectaRule() with defaults\n')

// The agent holds a deployment credential for the whole session.
const holdsSecret = createLabel({ classes: ['secret'], origin: 'trusted', source: 'vault' })

const naive = simulatePolicy(
	traces,
	flowPolicyProbe({ policy: createFlowPolicy([lethalTrifectaRule()]), initial: holdsSecret }),
)

console.log(formatSimulation(naive))
console.log('\n   → Shipping this would have broken every run. The default sink')
console.log('     list covers `tool:*`, so it blocks read-only tools too.\n')

console.log('─'.repeat(68))

// ─── Attempt 2: narrowed to genuine egress ──────────────────────

console.log('\n2. Candidate policy: narrowed to outbound sinks\n')

const narrowed = createFlowPolicy([
	lethalTrifectaRule({ sinks: ['network:*', 'tool:send_*', 'mcp:*'] }),
])

const refined = simulatePolicy(
	traces,
	flowPolicyProbe({ policy: narrowed, initial: holdsSecret }),
	{
		// Verify every signature and hash chain first: a plan computed over
		// unverified history looks exactly as authoritative as a real one.
		verifyWith: registry,
	},
)

console.log(formatSimulation(refined))

// ─── The plan: current vs candidate ─────────────────────────────

console.log(`\n${'─'.repeat(68)}`)
console.log('\n3. Plan — what changes if we enable it\n')

// Today: nothing is enforced.
const today = createFlowPolicy([
	{ name: 'monitor-only', sink: 'nothing:*', deny: { origin: ['untrusted'] } },
])

const plan = comparePolicies(traces, {
	baseline: flowPolicyProbe({ policy: today, initial: holdsSecret }),
	candidate: flowPolicyProbe({ policy: narrowed, initial: holdsSecret }),
})

console.log(formatComparison(plan))

// ─── A tampered corpus cannot buy a friendlier plan ─────────────

console.log(`\n${'─'.repeat(68)}`)
console.log('\n4. Someone edits history to make the rule look safe\n')

// Drop the offending tool from the three risky runs — the obvious way to make
// a plan say "nothing to see here".
const doctored = traces.map((t, i) =>
	i >= 97 ? { ...t, events: t.events.filter((e) => e.type !== 'tool.call') } : t,
)

const audited = simulatePolicy(
	doctored,
	flowPolicyProbe({ policy: narrowed, initial: holdsSecret }),
	{ verifyWith: registry },
)

console.log(formatSimulation(audited))
console.log('\n   → The edit breaks the hash chain, so those runs are rejected')
console.log('     rather than silently believed.\n')

console.log(`\n${'─'.repeat(68)}`)
console.log('\nThe point:\n')
console.log('  Attempt 1 looked correct and would have blocked 100% of traffic.')
console.log('  Attempt 2 blocks 3 runs out of 100 — and names them.')
console.log('\n  Same question every infrastructure team already asks before')
console.log('  applying a change: show me the plan first.')
