import { createEd25519Signer, createKeyRegistry, generateEd25519KeyPair } from '@elsium-ai/core'
import { describe, expect, it } from 'vitest'
import { compareProofs } from './compare'
import { createProofRecorder } from './recorder'

function setup() {
	const pair = generateEd25519KeyPair()
	const signer = createEd25519Signer({ privateKey: pair.privateKey, keyId: 'k1' })
	const registry = createKeyRegistry({
		trustRoots: [{ keyId: 'k1', publicKey: pair.publicKey }],
	})
	const recorder = createProofRecorder({ signer })
	return { recorder, registry }
}

describe('compareProofs — bit-exact', () => {
	it('matches identical proofs', async () => {
		const { recorder } = setup()
		const sessA = recorder.startSession({ agentId: 'a', clock: () => 1000 })
		sessA.recordToolCall({ tool: 't', inputHash: 'x', outputHash: 'y' })
		const a = await sessA.finalize()

		const sessB = recorder.startSession({ agentId: 'a', clock: () => 1000 })
		sessB.recordToolCall({ tool: 't', inputHash: 'x', outputHash: 'y' })
		const b = await sessB.finalize()

		const diff = compareProofs(a, b, { strategy: 'bit-exact' })
		expect(diff.matches).toBe(true)
		expect(diff.chainHeadMatch).toBe(true)
		expect(diff.deltas).toHaveLength(0)
	})

	it('flags hash-mismatch when data differs', async () => {
		const { recorder } = setup()
		const sessA = recorder.startSession({ agentId: 'a', clock: () => 1000 })
		sessA.recordToolCall({ tool: 't', inputHash: 'x', outputHash: 'y' })
		const a = await sessA.finalize()

		const sessB = recorder.startSession({ agentId: 'a', clock: () => 1000 })
		sessB.recordToolCall({ tool: 't', inputHash: 'x', outputHash: 'DIFFERENT' })
		const b = await sessB.finalize()

		const diff = compareProofs(a, b, { strategy: 'bit-exact' })
		expect(diff.matches).toBe(false)
		expect(diff.deltas[0].kind).toBe('hash-mismatch')
	})

	it('chainHead differs → matches is false in bit-exact even with no event deltas', async () => {
		const { recorder } = setup()
		const sessA = recorder.startSession({ agentId: 'a', clock: () => 1000 })
		const a = await sessA.finalize()

		const sessB = recorder.startSession({ agentId: 'a', clock: () => 1000 })
		const b = await sessB.finalize()

		expect(a.chainHead).toBe(b.chainHead)
		expect(compareProofs(a, b, { strategy: 'bit-exact' }).matches).toBe(true)
	})
})

describe('compareProofs — structural', () => {
	it('matches LLM calls with different responseHash but same model', async () => {
		const { recorder } = setup()
		const sessA = recorder.startSession({ agentId: 'a', clock: () => 1000 })
		sessA.recordLLMCall({
			model: 'claude-sonnet-4-6',
			provider: 'anthropic',
			requestHash: 'req',
			responseHash: 'res-a',
		})
		const a = await sessA.finalize()

		const sessB = recorder.startSession({ agentId: 'a', clock: () => 1000 })
		sessB.recordLLMCall({
			model: 'claude-sonnet-4-6',
			provider: 'anthropic',
			requestHash: 'req',
			responseHash: 'res-b',
		})
		const b = await sessB.finalize()

		const diff = compareProofs(a, b, { strategy: 'structural' })
		expect(diff.matches).toBe(true)
		expect(diff.chainHeadMatch).toBe(false)
	})

	it('flags llm.call when model differs', async () => {
		const { recorder } = setup()
		const sessA = recorder.startSession({ agentId: 'a', clock: () => 1000 })
		sessA.recordLLMCall({ model: 'claude-sonnet-4-6', requestHash: 'r', responseHash: 'x' })
		const a = await sessA.finalize()

		const sessB = recorder.startSession({ agentId: 'a', clock: () => 1000 })
		sessB.recordLLMCall({ model: 'gpt-4o', requestHash: 'r', responseHash: 'x' })
		const b = await sessB.finalize()

		const diff = compareProofs(a, b, { strategy: 'structural' })
		expect(diff.matches).toBe(false)
		expect(diff.deltas[0].kind).toBe('data-mismatch')
		expect(diff.deltas[0].detail).toContain('model or provider')
	})

	it('flags tool.call differences as data-mismatch (tools are deterministic)', async () => {
		const { recorder } = setup()
		const sessA = recorder.startSession({ agentId: 'a', clock: () => 1000 })
		sessA.recordToolCall({ tool: 't', inputHash: 'in', outputHash: 'out-a' })
		const a = await sessA.finalize()

		const sessB = recorder.startSession({ agentId: 'a', clock: () => 1000 })
		sessB.recordToolCall({ tool: 't', inputHash: 'in', outputHash: 'out-b' })
		const b = await sessB.finalize()

		const diff = compareProofs(a, b, { strategy: 'structural' })
		expect(diff.matches).toBe(false)
		expect(diff.deltas[0].kind).toBe('data-mismatch')
	})

	it('reports extra events on either side', async () => {
		const { recorder } = setup()
		const sessA = recorder.startSession({ agentId: 'a', clock: () => 1000 })
		sessA.recordCustom({ x: 1 })
		sessA.recordCustom({ y: 2 })
		const a = await sessA.finalize()

		const sessB = recorder.startSession({ agentId: 'a', clock: () => 1000 })
		sessB.recordCustom({ x: 1 })
		const b = await sessB.finalize()

		const diff = compareProofs(a, b, { strategy: 'structural' })
		expect(diff.matches).toBe(false)
		expect(diff.deltas[0].kind).toBe('missing-in-b')
		expect(diff.summary.extraInA).toBe(1)
		expect(diff.eventCountA).toBe(2)
		expect(diff.eventCountB).toBe(1)
	})

	it('flags type-mismatch when same-index events have different types', async () => {
		const { recorder } = setup()
		const sessA = recorder.startSession({ agentId: 'a', clock: () => 1000 })
		sessA.recordToolCall({ tool: 't', inputHash: 'i', outputHash: 'o' })
		const a = await sessA.finalize()

		const sessB = recorder.startSession({ agentId: 'a', clock: () => 1000 })
		sessB.recordPolicyDecision({ rule: 'r', result: 'allow' })
		const b = await sessB.finalize()

		const diff = compareProofs(a, b, { strategy: 'structural' })
		expect(diff.deltas[0].kind).toBe('type-mismatch')
	})

	it('reports agent identity mismatches without failing structural match', async () => {
		const { recorder } = setup()
		const sessA = recorder.startSession({ agentId: 'a', agentVersion: '1.0.0' })
		const a = await sessA.finalize()
		const sessB = recorder.startSession({ agentId: 'b', agentVersion: '2.0.0' })
		const b = await sessB.finalize()

		const diff = compareProofs(a, b, { strategy: 'structural' })
		expect(diff.agentIdMatch).toBe(false)
		expect(diff.agentVersionMatch).toBe(false)
		expect(diff.matches).toBe(true)
	})
})

describe('compareProofs — defaults', () => {
	it('defaults to structural strategy', async () => {
		const { recorder } = setup()
		const sessA = recorder.startSession({ agentId: 'a' })
		sessA.recordLLMCall({ model: 'm', requestHash: 'r', responseHash: 'x' })
		const a = await sessA.finalize()
		const sessB = recorder.startSession({ agentId: 'a' })
		sessB.recordLLMCall({ model: 'm', requestHash: 'r', responseHash: 'y' })
		const b = await sessB.finalize()

		const diff = compareProofs(a, b)
		expect(diff.strategy).toBe('structural')
		expect(diff.matches).toBe(true)
	})
})
