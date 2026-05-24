import type { LLMResponse, MiddlewareContext } from '@elsium-ai/core'
import {
	createCapabilityIssuer,
	createCapabilityVerifier,
	createEd25519Signer,
	createKeyRegistry,
	generateEd25519KeyPair,
} from '@elsium-ai/core'
import { describe, expect, it } from 'vitest'
import { capabilityMiddleware } from './capability-middleware'

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

function mockResponse(): LLMResponse {
	return {
		id: 'r',
		message: { role: 'assistant', content: 'ok' },
		usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
		cost: { inputCost: 0, outputCost: 0, totalCost: 0, currency: 'USD' },
		model: 'm',
		provider: 'p',
		stopReason: 'end_turn',
		latencyMs: 1,
		traceId: 't',
	}
}

function makeCtx(overrides?: Partial<MiddlewareContext>): MiddlewareContext {
	return {
		request: { messages: [{ role: 'user', content: 'hello world' }] },
		provider: 'anthropic',
		model: 'claude-sonnet-4-6',
		traceId: 't1',
		startTime: 0,
		metadata: {},
		...overrides,
	}
}

describe('capabilityMiddleware', () => {
	it('passes through when LLM capability matches', async () => {
		const { issuer, verifier } = setup()
		const token = issuer.mint({
			subject: { agent: 'bot' },
			capabilities: [{ kind: 'llm', provider: 'anthropic', models: ['claude-sonnet-4-6'] }],
		})
		const mw = capabilityMiddleware({ token, verifier })
		const ctx = makeCtx()
		const response = await mw(ctx, async () => mockResponse())
		expect(response.id).toBe('r')
	})

	it('throws AUTH_ERROR when provider not allowed', async () => {
		const { issuer, verifier } = setup()
		const token = issuer.mint({
			subject: { agent: 'bot' },
			capabilities: [{ kind: 'llm', provider: 'openai' }],
		})
		const mw = capabilityMiddleware({ token, verifier })
		const ctx = makeCtx({ provider: 'anthropic' })
		await expect(mw(ctx, async () => mockResponse())).rejects.toThrow(/capability denied/)
	})

	it('throws when token is expired', async () => {
		const pair = generateEd25519KeyPair()
		const signer = createEd25519Signer({ privateKey: pair.privateKey, keyId: 'k1' })
		const registry = createKeyRegistry({
			trustRoots: [{ keyId: 'k1', publicKey: pair.publicKey }],
		})
		let now = 1_000_000
		const issuer = createCapabilityIssuer({ signer, orgId: 'org', clock: () => now })
		const verifier = createCapabilityVerifier({ resolver: registry, clock: () => now })
		const token = issuer.mint({
			subject: { agent: 'bot' },
			capabilities: [{ kind: 'llm' }],
			ttlMs: 1000,
		})
		now += 5000
		const mw = capabilityMiddleware({ token, verifier })
		await expect(mw(makeCtx(), async () => mockResponse())).rejects.toThrow(/expired/)
	})

	it('fires onDeny event with structured detail', async () => {
		const { issuer, verifier } = setup()
		const token = issuer.mint({
			subject: { agent: 'bot' },
			capabilities: [{ kind: 'llm', provider: 'openai' }],
		})
		const events: { reason: string | undefined }[] = []
		const mw = capabilityMiddleware({
			token,
			verifier,
			onDeny: (e) => events.push({ reason: e.reason }),
		})
		await expect(
			mw(makeCtx({ provider: 'anthropic' }), async () => mockResponse()),
		).rejects.toThrow()
		expect(events).toHaveLength(1)
		expect(events[0].reason).toBe('no-matching-capability')
	})

	it('blocks when estimated cost exceeds capability maxCost', async () => {
		const { issuer, verifier } = setup()
		const token = issuer.mint({
			subject: { agent: 'bot' },
			capabilities: [{ kind: 'llm', maxCost: 0.0000001 }],
		})
		const mw = capabilityMiddleware({ token, verifier })
		await expect(
			mw(
				makeCtx({
					request: {
						messages: [{ role: 'user', content: 'x'.repeat(10_000) }],
						maxTokens: 4096,
					},
				}),
				async () => mockResponse(),
			),
		).rejects.toThrow(/budget-exceeded/)
	})

	it('runs without a verifier (trusted-context mode)', async () => {
		const { issuer } = setup()
		const token = issuer.mint({
			subject: { agent: 'bot' },
			capabilities: [{ kind: 'llm', provider: 'anthropic' }],
		})
		const mw = capabilityMiddleware({ token })
		const response = await mw(makeCtx(), async () => mockResponse())
		expect(response.id).toBe('r')
	})
})
