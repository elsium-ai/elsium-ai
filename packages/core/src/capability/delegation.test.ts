import { describe, expect, it } from 'vitest'
import { createEd25519Signer, createKeyRegistry, generateEd25519KeyPair } from '../crypto'
import { createCapabilityIssuer } from './issuer'
import { createCapabilityVerifier } from './verifier'

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

describe('delegate — strict subset enforcement', () => {
	it('mints a child token that inherits from parent', () => {
		const { issuer, verifier } = setup()
		const parent = issuer.mint({
			subject: { agent: 'support-bot' },
			capabilities: [
				{ kind: 'tool', name: 'db.read' },
				{ kind: 'llm', provider: 'anthropic', maxCost: 1.0 },
			],
		})

		const child = issuer.delegate(parent, {
			subject: { agent: 'support-bot:sub' },
			capabilities: [{ kind: 'llm', provider: 'anthropic', maxCost: 0.25 }],
		})

		expect(child.subject.parentToken).toBe(parent.tokenId)
		expect(child.validity.expiresAt).toBeLessThanOrEqual(parent.validity.expiresAt)
		expect(verifier.verifyToken(child).valid).toBe(true)
	})

	it('rejects child capability not present in parent', () => {
		const { issuer } = setup()
		const parent = issuer.mint({
			subject: { agent: 'a' },
			capabilities: [{ kind: 'tool', name: 'db.read' }],
		})
		expect(() =>
			issuer.delegate(parent, {
				subject: { agent: 'child' },
				capabilities: [{ kind: 'tool', name: 'db.write' }],
			}),
		).toThrow(/not in parent capabilities/)
	})

	it('rejects child LLM maxCost greater than parent', () => {
		const { issuer } = setup()
		const parent = issuer.mint({
			subject: { agent: 'a' },
			capabilities: [{ kind: 'llm', maxCost: 0.5 }],
		})
		expect(() =>
			issuer.delegate(parent, {
				subject: { agent: 'child' },
				capabilities: [{ kind: 'llm', maxCost: 1.0 }],
			}),
		).toThrow(/maxCost/)
	})

	it('rejects child tool dropping a denied field the parent imposed', () => {
		const { issuer } = setup()
		const parent = issuer.mint({
			subject: { agent: 'a' },
			capabilities: [
				{ kind: 'tool', name: 'customer.read', constraints: { deniedFields: ['ssn'] } },
			],
		})
		expect(() =>
			issuer.delegate(parent, {
				subject: { agent: 'child' },
				capabilities: [{ kind: 'tool', name: 'customer.read' }],
			}),
		).toThrow(/inherit all parent deniedFields/)
	})

	it('rejects child allowedFields not subset of parent', () => {
		const { issuer } = setup()
		const parent = issuer.mint({
			subject: { agent: 'a' },
			capabilities: [
				{
					kind: 'tool',
					name: 'customer.read',
					constraints: { allowedFields: ['name', 'email'] },
				},
			],
		})
		expect(() =>
			issuer.delegate(parent, {
				subject: { agent: 'child' },
				capabilities: [
					{
						kind: 'tool',
						name: 'customer.read',
						constraints: { allowedFields: ['name', 'salary'] },
					},
				],
			}),
		).toThrow(/subset of parent/)
	})

	it('rejects child MCP tools outside parent allowlist', () => {
		const { issuer } = setup()
		const parent = issuer.mint({
			subject: { agent: 'a' },
			capabilities: [{ kind: 'mcp', server: 'github', tools: ['issues.list'] }],
		})
		expect(() =>
			issuer.delegate(parent, {
				subject: { agent: 'child' },
				capabilities: [{ kind: 'mcp', server: 'github', tools: ['repos.delete'] }],
			}),
		).toThrow(/subset of parent/)
	})

	it('rejects child expiresAt beyond parent', () => {
		const { issuer } = setup()
		const parent = issuer.mint({
			subject: { agent: 'a' },
			capabilities: [{ kind: 'tool', name: 'db.read' }],
			ttlMs: 10_000,
		})
		expect(() =>
			issuer.delegate(parent, {
				subject: { agent: 'child' },
				capabilities: [{ kind: 'tool', name: 'db.read' }],
				expiresAt: parent.validity.expiresAt + 100_000,
			}),
		).toThrow(/cannot exceed parent/)
	})

	it('honors child budget tighter than parent', () => {
		const { issuer, verifier } = setup()
		const parent = issuer.mint({
			subject: { agent: 'a' },
			capabilities: [{ kind: 'tool', name: 'db.read' }],
			budget: { maxCost: 10, maxTokens: 100_000 },
		})
		const child = issuer.delegate(parent, {
			subject: { agent: 'child' },
			capabilities: [{ kind: 'tool', name: 'db.read' }],
			budget: { maxCost: 3, maxTokens: 50_000 },
		})
		expect(verifier.verifyToken(child).valid).toBe(true)
	})

	it('rejects child budget greater than parent', () => {
		const { issuer } = setup()
		const parent = issuer.mint({
			subject: { agent: 'a' },
			capabilities: [{ kind: 'tool', name: 'db.read' }],
			budget: { maxCost: 5 },
		})
		expect(() =>
			issuer.delegate(parent, {
				subject: { agent: 'child' },
				capabilities: [{ kind: 'tool', name: 'db.read' }],
				budget: { maxCost: 50 },
			}),
		).toThrow(/maxCost/)
	})

	it('rejects when parent has data class denies the child does not inherit', () => {
		const { issuer } = setup()
		const parent = issuer.mint({
			subject: { agent: 'a' },
			capabilities: [{ kind: 'tool', name: 'db.read' }],
			dataClasses: { denied: ['pii', 'financial'] },
		})
		expect(() =>
			issuer.delegate(parent, {
				subject: { agent: 'child' },
				capabilities: [{ kind: 'tool', name: 'db.read' }],
				dataClasses: { denied: ['pii'] },
			}),
		).toThrow(/inherit all parent denied/)
	})

	it('rejects an empty capabilities list', () => {
		const { issuer } = setup()
		const parent = issuer.mint({
			subject: { agent: 'a' },
			capabilities: [{ kind: 'tool', name: 'db.read' }],
		})
		expect(() =>
			issuer.delegate(parent, {
				subject: { agent: 'child' },
				capabilities: [],
			}),
		).toThrow(/at least one capability/)
	})
})
