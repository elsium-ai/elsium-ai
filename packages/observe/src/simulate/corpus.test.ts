import {
	type CapabilityToken,
	createEd25519Signer,
	createFlowPolicy,
	createKeyRegistry,
	generateEd25519KeyPair,
} from '@elsium-ai/core'
import { describe, expect, it } from 'vitest'
import { createProofRecorder } from '../proof/recorder'
import type { ExecutionProof } from '../proof/types'
import { capabilityProbe } from './capability-probe'
import { verifyCorpus } from './corpus'
import { flowPolicyProbe } from './flow-probe'
import { formatSimulation, simulatePolicy } from './simulate'

const PAIR = generateEd25519KeyPair()
const registry = createKeyRegistry({ trustRoots: [{ keyId: 'k1', publicKey: PAIR.publicKey }] })
const recorder = createProofRecorder({
	signer: createEd25519Signer({ privateKey: PAIR.privateKey, keyId: 'k1' }),
})

async function run(agentId: string, tool: string): Promise<ExecutionProof> {
	const session = recorder.startSession({ agentId })
	session.recordRagRetrieve({ store: 'kb', docs: [{ id: 'd1' }] })
	session.recordLLMCall({
		model: 'claude-sonnet-4-6',
		provider: 'anthropic',
		requestHash: 'a',
		responseHash: 'b',
		totalTokens: 900,
	})
	session.recordToolCall({ tool, inputHash: 'c', outputHash: 'd' })
	return session.finalize()
}

const anyFlow = flowPolicyProbe({
	policy: createFlowPolicy([{ name: 'noop', sink: 'never:*', deny: { origin: ['untrusted'] } }]),
})

describe('verifyCorpus', () => {
	it('keeps runs whose signature and chain hold', async () => {
		const corpus = verifyCorpus([await run('a', 'lookup'), await run('b', 'lookup')], registry)

		expect(corpus.traces).toHaveLength(2)
		expect(corpus.rejected).toEqual([])
		expect(corpus.complete).toBe(true)
	})

	it('rejects a run whose events were edited', async () => {
		const clean = await run('a', 'lookup')
		const tampered: ExecutionProof = {
			...clean,
			events: clean.events.map((e, i) =>
				i === 2 ? { ...e, data: { ...e.data, tool: 'send_email' } } : e,
			),
		}

		const corpus = verifyCorpus([tampered], registry)
		expect(corpus.traces).toEqual([])
		expect(corpus.rejected).toHaveLength(1)
		expect(corpus.complete).toBe(false)
	})

	it('rejects a run signed by an untrusted key', async () => {
		const stranger = generateEd25519KeyPair()
		const foreign = createProofRecorder({
			signer: createEd25519Signer({ privateKey: stranger.privateKey, keyId: 'k1' }),
		})
		const session = foreign.startSession({ agentId: 'outsider' })
		session.recordToolCall({ tool: 'send_email', inputHash: 'a', outputHash: 'b' })

		const corpus = verifyCorpus([await session.finalize()], registry)
		expect(corpus.rejected).toHaveLength(1)
	})

	it('reports rejections instead of throwing — a tampered corpus is itself a finding', async () => {
		const clean = await run('good', 'lookup')
		const broken: ExecutionProof = { ...clean, proofId: 'edited', chainHead: 'x'.repeat(64) }

		const corpus = verifyCorpus([clean, broken], registry)
		expect(corpus.traces).toHaveLength(1)
		expect(corpus.rejected[0].proofId).toBe('edited')
	})
})

describe('simulatePolicy with verification', () => {
	it('excludes unverifiable runs from the plan', async () => {
		const clean = await run('good', 'lookup')
		const tampered: ExecutionProof = { ...clean, proofId: 'tampered', chainHead: 'x'.repeat(64) }

		const result = simulatePolicy([clean, tampered], anyFlow, { verifyWith: registry })

		expect(result.traces).toBe(1)
		expect(result.evidence?.verified).toBe(1)
		expect(result.evidence?.rejected).toHaveLength(1)
	})

	it('omits evidence when verification was not requested', async () => {
		const result = simulatePolicy([await run('a', 'lookup')], anyFlow)
		expect(result.evidence).toBeUndefined()
	})

	it('says plainly when the plan rests on unverified history', async () => {
		const output = formatSimulation(simulatePolicy([await run('a', 'lookup')], anyFlow))
		expect(output).toMatch(/Evidence: UNVERIFIED/)
	})

	it('declares the evidence when verified', async () => {
		const output = formatSimulation(
			simulatePolicy([await run('a', 'lookup')], anyFlow, { verifyWith: registry }),
		)
		expect(output).toMatch(/Evidence: 1 verified run\(s\), all signatures and hash chains intact/)
	})

	it('flags rejected runs in the rendered plan', async () => {
		const clean = await run('good', 'lookup')
		const tampered: ExecutionProof = { ...clean, proofId: 'tampered', chainHead: 'x'.repeat(64) }
		const output = formatSimulation(
			simulatePolicy([clean, tampered], anyFlow, { verifyWith: registry }),
		)

		expect(output).toMatch(/1 REJECTED — plan computed without them/)
		expect(output).toMatch(/tampered/)
	})
})

describe('capabilityProbe', () => {
	function token(capabilities: CapabilityToken['capabilities']): CapabilityToken {
		return {
			version: 'elsium-cap/v1',
			tokenId: 'cap_1',
			subject: { kind: 'agent', id: 'assistant' },
			issuer: { id: 'issuer', keyId: 'k1' },
			validity: { issuedAt: 0, expiresAt: 9_999_999_999_999 },
			capabilities,
			signature: { algorithm: 'Ed25519', keyId: 'k1', value: 'sig' },
		}
	}

	const fullAccess = token([
		{ kind: 'tool', name: 'lookup' },
		{ kind: 'llm', provider: 'anthropic' },
		{ kind: 'rag', stores: ['kb'] },
	])

	it('allows what the token permits', async () => {
		const probe = capabilityProbe({ token: fullAccess })
		expect(simulatePolicy([await run('a', 'lookup')], probe).denied).toBe(0)
	})

	it('shows a token scoped too tightly for what the agent actually did', async () => {
		const probe = capabilityProbe({ token: fullAccess })

		// The run reaches for a tool the token never granted.
		const result = simulatePolicy([await run('a', 'send_email')], probe)
		expect(result.denied).toBe(1)
		expect(result.denials[0].subject).toBe('tool:send_email')
	})

	it('checks recorded token usage against the capability limit', async () => {
		const probe = capabilityProbe({
			token: token([
				{ kind: 'tool', name: 'lookup' },
				// The run used 900 tokens; this cap sits below that.
				{ kind: 'llm', provider: 'anthropic', maxTokens: 100 },
				{ kind: 'rag', stores: ['kb'] },
			]),
		})

		const result = simulatePolicy([await run('a', 'lookup')], probe)
		expect(result.denials.some((d) => d.subject.startsWith('llm:'))).toBe(true)
	})

	it('covers every decision point in the run, not just tools', async () => {
		const probe = capabilityProbe({ token: token([]) })
		const result = simulatePolicy([await run('a', 'lookup')], probe)

		// rag.retrieve + llm.call + tool.call
		expect(result.evaluated).toBe(3)
		expect(result.denied).toBe(3)
	})
})
