import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LLMResponse, Middleware, MiddlewareContext } from '@elsium-ai/core'
import {
	createEd25519Signer,
	createFileWriteOnceStore,
	createInMemoryWriteOnceStore,
	createKeyRegistry,
	generateEd25519KeyPair,
} from '@elsium-ai/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PROOF_SESSION_METADATA_KEY, PROOF_VERSION, createProofRecorder } from './recorder'
import type { ExecutionProof } from './types'

function setupRecorder() {
	const pair = generateEd25519KeyPair()
	const signer = createEd25519Signer({ privateKey: pair.privateKey, keyId: 'k1' })
	const registry = createKeyRegistry({ trustRoots: [{ keyId: 'k1', publicKey: pair.publicKey }] })
	const recorder = createProofRecorder({ signer })
	return { recorder, registry, pair }
}

describe('ProofSession', () => {
	it('records events into a hash chain and finalizes with a signature', async () => {
		const { recorder, registry } = setupRecorder()
		const session = recorder.startSession({ agentId: 'invoice-extractor' })

		session.recordToolCall({ tool: 'extract', inputHash: 'a', outputHash: 'b' })
		session.recordRagRetrieve({ docs: [{ id: 'd1', score: 0.9 }] })
		session.recordPolicyDecision({ rule: 'pii-allowed', result: 'allow' })

		const proof = await session.finalize({ finalOutput: { invoiceTotal: 123 } })

		expect(proof.version).toBe(PROOF_VERSION)
		expect(proof.proofId).toMatch(/^proof_/)
		expect(proof.agentId).toBe('invoice-extractor')
		expect(proof.events).toHaveLength(4)
		expect(proof.events[0].type).toBe('tool.call')
		expect(proof.events[3].type).toBe('agent.output')
		expect(proof.chainHead).toBe(proof.events[3].hashSelf)
		expect(proof.signature.algorithm).toBe('Ed25519')

		const result = recorder.verify(proof, registry)
		expect(result.valid).toBe(true)
		expect(result.signatureValid).toBe(true)
		expect(result.chainValid).toBe(true)
	})

	it('produces ZERO_HASH chainHead when there are no events', async () => {
		const { recorder, registry } = setupRecorder()
		const session = recorder.startSession({ agentId: 'empty' })
		const proof = await session.finalize()
		expect(proof.events).toHaveLength(0)
		expect(proof.chainHead).toBe('0'.repeat(64))
		expect(recorder.verify(proof, registry).valid).toBe(true)
	})

	it('rejects recording after finalize', async () => {
		const { recorder } = setupRecorder()
		const session = recorder.startSession({ agentId: 'x' })
		session.recordCustom({ note: 'hi' })
		await session.finalize()
		expect(() => session.recordCustom({ note: 'too late' })).toThrow(/finalized/)
	})

	it('rejects double finalize', async () => {
		const { recorder } = setupRecorder()
		const session = recorder.startSession({ agentId: 'x' })
		await session.finalize()
		await expect(session.finalize()).rejects.toThrow(/already finalized/)
	})

	it('persists to WriteOnceStore when one is provided', async () => {
		const { recorder, registry } = setupRecorder()
		const store = createInMemoryWriteOnceStore()
		const session = recorder.startSession({ agentId: 'persister' })
		session.recordCustom({ event: 'one' })
		const proof = await session.finalize({ store })

		const raw = await store.get(`${proof.proofId}.json`)
		expect(raw).not.toBeNull()
		const reread = JSON.parse(new TextDecoder().decode(raw as Uint8Array)) as ExecutionProof
		expect(reread.proofId).toBe(proof.proofId)
		const result = recorder.verify(reread, registry)
		expect(result.valid).toBe(true)
	})

	it('records agent.input event when inputs are passed to startSession', async () => {
		const { recorder } = setupRecorder()
		const session = recorder.startSession({
			agentId: 'with-inputs',
			inputs: { messages: [{ role: 'user', content: 'hi' }] },
		})
		const proof = await session.finalize()
		expect(proof.events[0].type).toBe('agent.input')
		expect(proof.events[0].data.messages).toBeDefined()
	})

	it('rejects startSession with empty agentId', () => {
		const { recorder } = setupRecorder()
		expect(() => recorder.startSession({ agentId: '' })).toThrow(/agentId/)
	})

	it('uses injected clock for timestamps', async () => {
		const { recorder } = setupRecorder()
		let now = 1000
		const session = recorder.startSession({ agentId: 'tick', clock: () => now })
		session.recordCustom({ at: 'first' })
		now = 2000
		session.recordCustom({ at: 'second' })
		const proof = await session.finalize()
		expect(proof.events[0].timestamp).toBe(1000)
		expect(proof.events[1].timestamp).toBe(2000)
	})
})

describe('verify', () => {
	it('detects a tampered event payload', async () => {
		const { recorder, registry } = setupRecorder()
		const session = recorder.startSession({ agentId: 'a' })
		session.recordCustom({ note: 'original' })
		session.recordCustom({ note: 'second' })
		const proof = await session.finalize()

		const tampered: ExecutionProof = JSON.parse(JSON.stringify(proof))
		tampered.events[0].data = { note: 'mutated' }

		const result = recorder.verify(tampered, registry)
		expect(result.valid).toBe(false)
		expect(result.chainValid).toBe(false)
		expect(result.chainBrokenAt).toBe(0)
	})

	it('detects a broken hashPrev link', async () => {
		const { recorder, registry } = setupRecorder()
		const session = recorder.startSession({ agentId: 'a' })
		session.recordCustom({ a: 1 })
		session.recordCustom({ b: 2 })
		const proof = await session.finalize()

		const tampered: ExecutionProof = JSON.parse(JSON.stringify(proof))
		tampered.events[1].hashPrev = '0'.repeat(64)

		const result = recorder.verify(tampered, registry)
		expect(result.valid).toBe(false)
		expect(result.chainBrokenAt).toBe(1)
	})

	it('rejects signature from unknown key', async () => {
		const { recorder } = setupRecorder()
		const otherRegistry = createKeyRegistry()
		const session = recorder.startSession({ agentId: 'a' })
		session.recordCustom({ x: 1 })
		const proof = await session.finalize()

		const result = recorder.verify(proof, otherRegistry)
		expect(result.signatureValid).toBe(false)
		expect(result.reason).toContain('Unknown keyId')
	})

	it('detects signature tampering of chainHead', async () => {
		const { recorder, registry } = setupRecorder()
		const session = recorder.startSession({ agentId: 'a' })
		session.recordCustom({ x: 1 })
		const proof = await session.finalize()

		const tampered: ExecutionProof = JSON.parse(JSON.stringify(proof))
		tampered.chainHead = '0'.repeat(64)

		const result = recorder.verify(tampered, registry)
		expect(result.valid).toBe(false)
		expect(result.reason).toContain('chainHead')
	})

	it('rejects unsupported proof version', () => {
		const { recorder, registry } = setupRecorder()
		const proof = {
			version: 'elsium-proof/v0',
			proofId: 'x',
			agentId: 'y',
			startedAt: '',
			endedAt: '',
			events: [],
			chainHead: '0',
			signature: { algorithm: 'Ed25519' as const, keyId: 'k1', value: 'AAA' },
		}
		const result = recorder.verify(proof as ExecutionProof, registry)
		expect(result.valid).toBe(false)
		expect(result.reason).toContain('Unsupported proof version')
	})
})

describe('proof middleware', () => {
	it('auto-records llm.call events when proofSessionId is in metadata', async () => {
		const { recorder, registry } = setupRecorder()
		const session = recorder.startSession({ agentId: 'mw-agent' })
		const mw: Middleware = recorder.middleware()

		const mockResponse: LLMResponse = {
			id: 'r1',
			message: { role: 'assistant', content: 'hello' },
			usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
			cost: { inputCost: 0, outputCost: 0, totalCost: 0, currency: 'USD' },
			model: 'mock-model',
			provider: 'mock',
			stopReason: 'end_turn',
			latencyMs: 33,
			traceId: 'trc_1',
		}

		const ctx: MiddlewareContext = {
			request: { messages: [{ role: 'user', content: 'hi' }] },
			provider: 'mock',
			model: 'mock-model',
			traceId: 'trc_1',
			startTime: 0,
			metadata: { [PROOF_SESSION_METADATA_KEY]: session.proofId },
		}

		await mw(ctx, async () => mockResponse)

		const proof = await session.finalize()
		expect(proof.events).toHaveLength(1)
		expect(proof.events[0].type).toBe('llm.call')
		expect(proof.events[0].data.model).toBe('mock-model')
		expect(proof.events[0].data.totalTokens).toBe(14)
		expect(recorder.verify(proof, registry).valid).toBe(true)
	})

	it('does nothing when proofSessionId is missing from metadata', async () => {
		const { recorder } = setupRecorder()
		const session = recorder.startSession({ agentId: 'mw-agent' })
		const mw: Middleware = recorder.middleware()

		const mockResponse: LLMResponse = {
			id: 'r1',
			message: { role: 'assistant', content: 'x' },
			usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
			cost: { inputCost: 0, outputCost: 0, totalCost: 0, currency: 'USD' },
			model: 'm',
			provider: 'p',
			stopReason: 'end_turn',
			latencyMs: 1,
			traceId: 't',
		}

		const ctx: MiddlewareContext = {
			request: { messages: [] },
			provider: 'p',
			model: 'm',
			traceId: 't',
			startTime: 0,
			metadata: {},
		}

		await mw(ctx, async () => mockResponse)

		const proof = await session.finalize()
		expect(proof.events).toHaveLength(0)
	})

	it('ignores stale proofSessionId after finalize', async () => {
		const { recorder } = setupRecorder()
		const session = recorder.startSession({ agentId: 'mw-agent' })
		await session.finalize()

		const mw: Middleware = recorder.middleware()
		const mockResponse: LLMResponse = {
			id: 'r1',
			message: { role: 'assistant', content: 'x' },
			usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
			cost: { inputCost: 0, outputCost: 0, totalCost: 0, currency: 'USD' },
			model: 'm',
			provider: 'p',
			stopReason: 'end_turn',
			latencyMs: 1,
			traceId: 't',
		}

		const ctx: MiddlewareContext = {
			request: { messages: [] },
			provider: 'p',
			model: 'm',
			traceId: 't',
			startTime: 0,
			metadata: { [PROOF_SESSION_METADATA_KEY]: session.proofId },
		}

		await expect(mw(ctx, async () => mockResponse)).resolves.toBe(mockResponse)
	})
})

describe('proof persisted to file store', () => {
	let dir: string

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'elsium-proof-'))
	})

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true })
	})

	it('writes a verifiable proof to disk', async () => {
		const { recorder, registry } = setupRecorder()
		const store = createFileWriteOnceStore({ dir, fsync: false })

		const session = recorder.startSession({
			agentId: 'invoice-extractor',
			agentVersion: '1.2.3',
			reproducibility: { modelVersions: { 'claude-sonnet-4-6': 'snap-2026-05-24' } },
		})
		session.recordToolCall({ tool: 'parse', inputHash: 'in', outputHash: 'out' })
		const proof = await session.finalize({
			finalOutput: { total: 42 },
			store,
		})

		const filePath = join(dir, `${proof.proofId}.json`)
		const raw = await readFile(filePath, 'utf8')
		const reread = JSON.parse(raw) as ExecutionProof
		expect(reread.agentVersion).toBe('1.2.3')
		expect(reread.reproducibility?.modelVersions?.['claude-sonnet-4-6']).toBe('snap-2026-05-24')
		expect(recorder.verify(reread, registry).valid).toBe(true)
	})
})
