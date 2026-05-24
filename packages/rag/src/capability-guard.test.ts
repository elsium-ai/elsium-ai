import {
	createCapabilityIssuer,
	createCapabilityVerifier,
	createEd25519Signer,
	createKeyRegistry,
	generateEd25519KeyPair,
} from '@elsium-ai/core'
import { describe, expect, it } from 'vitest'
import { withRagCapability } from './capability-guard'
import type { RAGPipeline } from './pipeline'

function setup() {
	const pair = generateEd25519KeyPair()
	const signer = createEd25519Signer({ privateKey: pair.privateKey, keyId: 'k1' })
	const registry = createKeyRegistry({
		trustRoots: [{ keyId: 'k1', publicKey: pair.publicKey }],
	})
	const issuer = createCapabilityIssuer({ signer, orgId: 'org' })
	const verifier = createCapabilityVerifier({ resolver: registry })
	return { issuer, verifier }
}

function fakePipeline(): RAGPipeline {
	return {
		async ingest() {
			return { documentId: 'd', chunksCreated: 0, tokensProcessed: 0 }
		},
		async ingestDocument() {
			return { documentId: 'd', chunksCreated: 0, tokensProcessed: 0 }
		},
		async query() {
			return [{ chunk: { id: 'c', documentId: 'd', text: 'x', metadata: {} }, score: 1 }]
		},
		async clear() {},
		async count() {
			return 0
		},
		embeddingProvider: { dimensions: 1, embed: async () => [0], embedBatch: async () => [[0]] },
		vectorStore: {
			upsert: async () => {},
			query: async () => [],
			delete: async () => {},
			clear: async () => {},
			count: async () => 0,
		},
	} as unknown as RAGPipeline
}

describe('withRagCapability', () => {
	it('allows query against a whitelisted store', async () => {
		const { issuer, verifier } = setup()
		const token = issuer.mint({
			subject: { agent: 'bot' },
			capabilities: [{ kind: 'rag', stores: ['kb-public'], maxResults: 10 }],
		})
		const guarded = withRagCapability(fakePipeline(), {
			token,
			verifier,
			store: 'kb-public',
		})
		const results = await guarded.query('hello', { topK: 5 })
		expect(results).toHaveLength(1)
	})

	it('blocks query against a store outside whitelist', async () => {
		const { issuer, verifier } = setup()
		const token = issuer.mint({
			subject: { agent: 'bot' },
			capabilities: [{ kind: 'rag', stores: ['kb-public'] }],
		})
		const guarded = withRagCapability(fakePipeline(), {
			token,
			verifier,
			store: 'kb-pii',
		})
		await expect(guarded.query('q')).rejects.toThrow(/capability denied/)
	})

	it('blocks when topK exceeds capability maxResults', async () => {
		const { issuer, verifier } = setup()
		const token = issuer.mint({
			subject: { agent: 'bot' },
			capabilities: [{ kind: 'rag', maxResults: 5 }],
		})
		const guarded = withRagCapability(fakePipeline(), { token, verifier })
		await expect(guarded.query('q', { topK: 20 })).rejects.toThrow(/budget-exceeded/)
	})

	it('preserves non-query pipeline methods', async () => {
		const { issuer } = setup()
		const token = issuer.mint({
			subject: { agent: 'bot' },
			capabilities: [{ kind: 'rag', stores: ['kb'] }],
		})
		const guarded = withRagCapability(fakePipeline(), { token, store: 'kb' })
		expect(await guarded.count()).toBe(0)
		await guarded.clear()
	})

	it('fires onDeny event with structured detail', async () => {
		const { issuer, verifier } = setup()
		const token = issuer.mint({
			subject: { agent: 'bot' },
			capabilities: [{ kind: 'rag', stores: ['kb-public'] }],
		})
		const events: { store?: string; reason: string | undefined }[] = []
		const guarded = withRagCapability(fakePipeline(), {
			token,
			verifier,
			store: 'kb-pii',
			onDeny: (e) => events.push({ store: e.store, reason: e.reason }),
		})
		await expect(guarded.query('q')).rejects.toThrow()
		expect(events).toEqual([{ store: 'kb-pii', reason: 'no-matching-capability' }])
	})
})
