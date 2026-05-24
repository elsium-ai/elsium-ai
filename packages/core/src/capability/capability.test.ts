import { describe, expect, it } from 'vitest'
import { createEd25519Signer, createKeyRegistry, generateEd25519KeyPair } from '../crypto'
import { ElsiumError } from '../errors'
import { canCallLLM, canCallTool, canQueryRag, canUseMcp, checkDataClass } from './checks'
import { createCapabilityIssuer } from './issuer'
import { createCapabilityVerifier } from './verifier'

function setup() {
	const pair = generateEd25519KeyPair()
	const signer = createEd25519Signer({ privateKey: pair.privateKey, keyId: 'k1' })
	const registry = createKeyRegistry({
		trustRoots: [{ keyId: 'k1', publicKey: pair.publicKey }],
	})
	const issuer = createCapabilityIssuer({ signer, orgId: 'aperion-gaming' })
	const verifier = createCapabilityVerifier({ resolver: registry })
	return { issuer, verifier, pair, registry }
}

describe('createCapabilityIssuer', () => {
	it('mints a signed token with default 1h TTL', () => {
		const { issuer } = setup()
		const token = issuer.mint({
			subject: { agent: 'support-bot' },
			capabilities: [{ kind: 'tool', name: 'db.read' }],
		})

		expect(token.version).toBe('elsium-cap/v1')
		expect(token.tokenId).toMatch(/^cap_/)
		expect(token.issuer.orgId).toBe('aperion-gaming')
		expect(token.issuer.keyId).toBe('k1')
		expect(token.signature.algorithm).toBe('Ed25519')
		expect(token.validity.expiresAt - token.validity.issuedAt).toBe(60 * 60 * 1000)
	})

	it('rejects empty capabilities list', () => {
		const { issuer } = setup()
		expect(() => issuer.mint({ subject: { agent: 'a' }, capabilities: [] })).toThrow(
			/at least one capability/,
		)
	})

	it('rejects malformed capability entries', () => {
		const { issuer } = setup()
		expect(() =>
			issuer.mint({
				subject: { agent: 'a' },
				// biome-ignore lint/suspicious/noExplicitAny: testing malformed input
				capabilities: [{} as any],
			}),
		).toThrow(/must be an object with a "kind"/)
	})

	it('rejects empty subject.agent', () => {
		const { issuer } = setup()
		expect(() =>
			issuer.mint({ subject: { agent: '' }, capabilities: [{ kind: 'tool', name: 't' }] }),
		).toThrow(ElsiumError)
	})

	it('honors explicit ttlMs', () => {
		const { issuer } = setup()
		const token = issuer.mint({
			subject: { agent: 'a' },
			capabilities: [{ kind: 'tool', name: 't' }],
			ttlMs: 5_000,
		})
		expect(token.validity.expiresAt - token.validity.issuedAt).toBe(5_000)
	})

	it('rejects past expiresAt', () => {
		const { issuer } = setup()
		expect(() =>
			issuer.mint({
				subject: { agent: 'a' },
				capabilities: [{ kind: 'tool', name: 't' }],
				expiresAt: Date.now() - 1000,
			}),
		).toThrow(/in the future/)
	})

	it('rejects notBefore >= expiresAt', () => {
		const { issuer } = setup()
		const now = Date.now()
		expect(() =>
			issuer.mint({
				subject: { agent: 'a' },
				capabilities: [{ kind: 'tool', name: 't' }],
				notBefore: now + 10_000,
				expiresAt: now + 5_000,
			}),
		).toThrow(/less than expiresAt/)
	})
})

describe('createCapabilityVerifier — verifyToken', () => {
	it('accepts a freshly minted token', () => {
		const { issuer, verifier } = setup()
		const token = issuer.mint({
			subject: { agent: 'a' },
			capabilities: [{ kind: 'tool', name: 't' }],
		})
		const result = verifier.verifyToken(token)
		expect(result.valid).toBe(true)
		expect(result.signatureValid).toBe(true)
		expect(result.withinValidityWindow).toBe(true)
	})

	it('rejects an expired token', () => {
		const pair = generateEd25519KeyPair()
		const signer = createEd25519Signer({ privateKey: pair.privateKey, keyId: 'k1' })
		const registry = createKeyRegistry({
			trustRoots: [{ keyId: 'k1', publicKey: pair.publicKey }],
		})
		let now = 1_000_000
		const issuer = createCapabilityIssuer({ signer, orgId: 'org', clock: () => now })
		const verifier = createCapabilityVerifier({ resolver: registry, clock: () => now })

		const token = issuer.mint({
			subject: { agent: 'a' },
			capabilities: [{ kind: 'tool', name: 't' }],
			ttlMs: 1_000,
		})

		now += 5_000
		const result = verifier.verifyToken(token)
		expect(result.valid).toBe(false)
		expect(result.signatureValid).toBe(true)
		expect(result.reason).toBe('expired')
	})

	it('rejects a token before its notBefore', () => {
		const pair = generateEd25519KeyPair()
		const signer = createEd25519Signer({ privateKey: pair.privateKey, keyId: 'k1' })
		const registry = createKeyRegistry({
			trustRoots: [{ keyId: 'k1', publicKey: pair.publicKey }],
		})
		const now = 1_000_000
		const issuer = createCapabilityIssuer({ signer, orgId: 'org', clock: () => now })
		const verifier = createCapabilityVerifier({ resolver: registry, clock: () => now })

		const token = issuer.mint({
			subject: { agent: 'a' },
			capabilities: [{ kind: 'tool', name: 't' }],
			notBefore: now + 10_000,
			expiresAt: now + 20_000,
		})

		const result = verifier.verifyToken(token)
		expect(result.valid).toBe(false)
		expect(result.reason).toBe('not-yet-valid')
	})

	it('rejects a token whose signature does not verify (tamper)', () => {
		const { issuer, verifier } = setup()
		const token = issuer.mint({
			subject: { agent: 'a' },
			capabilities: [{ kind: 'tool', name: 't' }],
		})
		const tampered = JSON.parse(JSON.stringify(token))
		tampered.capabilities.push({ kind: 'tool', name: 'unauthorized' })
		const result = verifier.verifyToken(tampered)
		expect(result.valid).toBe(false)
		expect(result.reason).toBe('bad-signature')
	})

	it('rejects a token signed by an unknown key', () => {
		const { issuer } = setup()
		const otherRegistry = createKeyRegistry()
		const otherVerifier = createCapabilityVerifier({ resolver: otherRegistry })
		const token = issuer.mint({
			subject: { agent: 'a' },
			capabilities: [{ kind: 'tool', name: 't' }],
		})
		const result = otherVerifier.verifyToken(token)
		expect(result.valid).toBe(false)
		expect(result.reason).toBe('unknown-key')
	})

	it('rejects an unsupported token version', () => {
		const { verifier } = setup()
		const result = verifier.verifyToken({
			version: 'elsium-cap/v0',
			// biome-ignore lint/suspicious/noExplicitAny: test fixture
		} as any)
		expect(result.valid).toBe(false)
		expect(result.reason).toBe('malformed')
	})
})

describe('canCallTool', () => {
	it('allows a tool listed in capabilities', () => {
		const { issuer } = setup()
		const token = issuer.mint({
			subject: { agent: 'a' },
			capabilities: [{ kind: 'tool', name: 'db.read' }],
		})
		expect(canCallTool(token, 'db.read').allowed).toBe(true)
	})

	it('denies a tool not in capabilities', () => {
		const { issuer } = setup()
		const token = issuer.mint({
			subject: { agent: 'a' },
			capabilities: [{ kind: 'tool', name: 'db.read' }],
		})
		const result = canCallTool(token, 'db.write')
		expect(result.allowed).toBe(false)
		expect(result.reason).toBe('no-matching-capability')
	})

	it('denies a tool when a denied field is in input', () => {
		const { issuer } = setup()
		const token = issuer.mint({
			subject: { agent: 'a' },
			capabilities: [
				{ kind: 'tool', name: 'customer.read', constraints: { deniedFields: ['ssn'] } },
			],
		})
		const result = canCallTool(token, 'customer.read', { input: { name: 'Ana', ssn: '...' } })
		expect(result.allowed).toBe(false)
		expect(result.reason).toBe('denied-field')
	})

	it('denies fields outside allowedFields whitelist', () => {
		const { issuer } = setup()
		const token = issuer.mint({
			subject: { agent: 'a' },
			capabilities: [
				{
					kind: 'tool',
					name: 'customer.read',
					constraints: { allowedFields: ['name', 'email'] },
				},
			],
		})
		const result = canCallTool(token, 'customer.read', { input: { name: 'Ana', salary: 100 } })
		expect(result.allowed).toBe(false)
		expect(result.reason).toBe('allowed-fields-violation')
	})

	it('denies a tool when input data class is denied', () => {
		const { issuer } = setup()
		const token = issuer.mint({
			subject: { agent: 'a' },
			capabilities: [{ kind: 'tool', name: 't' }],
			dataClasses: { denied: ['pii'] },
		})
		const result = canCallTool(token, 't', { dataClasses: ['pii'] })
		expect(result.allowed).toBe(false)
		expect(result.reason).toBe('denied-data-class')
	})

	it('denies data classes outside allowed list', () => {
		const { issuer } = setup()
		const token = issuer.mint({
			subject: { agent: 'a' },
			capabilities: [{ kind: 'tool', name: 't' }],
			dataClasses: { allowed: ['public'] },
		})
		const result = canCallTool(token, 't', { dataClasses: ['internal'] })
		expect(result.allowed).toBe(false)
		expect(result.reason).toBe('denied-data-class')
	})
})

describe('canCallLLM', () => {
	it('allows when provider and model match', () => {
		const { issuer } = setup()
		const token = issuer.mint({
			subject: { agent: 'a' },
			capabilities: [{ kind: 'llm', provider: 'anthropic', models: ['claude-sonnet-4-6'] }],
		})
		expect(canCallLLM(token, { provider: 'anthropic', model: 'claude-sonnet-4-6' }).allowed).toBe(
			true,
		)
	})

	it('denies wrong provider', () => {
		const { issuer } = setup()
		const token = issuer.mint({
			subject: { agent: 'a' },
			capabilities: [{ kind: 'llm', provider: 'anthropic' }],
		})
		const result = canCallLLM(token, { provider: 'openai', model: 'gpt-4o' })
		expect(result.allowed).toBe(false)
		expect(result.reason).toBe('no-matching-capability')
	})

	it('denies when estimatedCost exceeds capability maxCost', () => {
		const { issuer } = setup()
		const token = issuer.mint({
			subject: { agent: 'a' },
			capabilities: [{ kind: 'llm', maxCost: 0.5 }],
		})
		const result = canCallLLM(token, { estimatedCost: 1.25 })
		expect(result.allowed).toBe(false)
		expect(result.reason).toBe('budget-exceeded')
	})

	it('denies when estimatedTokens exceeds capability maxTokens', () => {
		const { issuer } = setup()
		const token = issuer.mint({
			subject: { agent: 'a' },
			capabilities: [{ kind: 'llm', maxTokens: 1000 }],
		})
		const result = canCallLLM(token, { estimatedTokens: 2000 })
		expect(result.allowed).toBe(false)
		expect(result.reason).toBe('budget-exceeded')
	})

	it('denies when token has no LLM capability at all', () => {
		const { issuer } = setup()
		const token = issuer.mint({
			subject: { agent: 'a' },
			capabilities: [{ kind: 'tool', name: 't' }],
		})
		expect(canCallLLM(token, { provider: 'anthropic' }).allowed).toBe(false)
	})
})

describe('canQueryRag', () => {
	it('allows a query against a whitelisted store', () => {
		const { issuer } = setup()
		const token = issuer.mint({
			subject: { agent: 'a' },
			capabilities: [{ kind: 'rag', stores: ['kb-public'], maxResults: 10 }],
		})
		expect(canQueryRag(token, { store: 'kb-public', resultCount: 5 }).allowed).toBe(true)
	})

	it('denies a query that exceeds maxResults', () => {
		const { issuer } = setup()
		const token = issuer.mint({
			subject: { agent: 'a' },
			capabilities: [{ kind: 'rag', maxResults: 5 }],
		})
		const result = canQueryRag(token, { resultCount: 20 })
		expect(result.allowed).toBe(false)
		expect(result.reason).toBe('budget-exceeded')
	})
})

describe('canUseMcp', () => {
	it('allows when server + tool are both whitelisted', () => {
		const { issuer } = setup()
		const token = issuer.mint({
			subject: { agent: 'a' },
			capabilities: [{ kind: 'mcp', server: 'github', tools: ['issues.list'] }],
		})
		expect(canUseMcp(token, { server: 'github', tool: 'issues.list' }).allowed).toBe(true)
	})

	it('denies when server matches but tool is not in allowlist', () => {
		const { issuer } = setup()
		const token = issuer.mint({
			subject: { agent: 'a' },
			capabilities: [{ kind: 'mcp', server: 'github', tools: ['issues.list'] }],
		})
		const result = canUseMcp(token, { server: 'github', tool: 'repos.delete' })
		expect(result.allowed).toBe(false)
	})
})

describe('checkDataClass', () => {
	it('denies a denied class', () => {
		const { issuer } = setup()
		const token = issuer.mint({
			subject: { agent: 'a' },
			capabilities: [{ kind: 'tool', name: 't' }],
			dataClasses: { denied: ['pii'] },
		})
		const result = checkDataClass(token, 'pii')
		expect(result.allowed).toBe(false)
	})
})
