import {
	createCapabilityIssuer,
	createCapabilityVerifier,
	createEd25519Signer,
	createKeyRegistry,
	generateEd25519KeyPair,
} from '@elsium-ai/core'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { type CapabilityDenialEvent, withCapability } from './capability-guard'
import { defineTool } from './define'

function setupIssuer() {
	const pair = generateEd25519KeyPair()
	const signer = createEd25519Signer({ privateKey: pair.privateKey, keyId: 'k1' })
	const registry = createKeyRegistry({
		trustRoots: [{ keyId: 'k1', publicKey: pair.publicKey }],
	})
	const issuer = createCapabilityIssuer({ signer, orgId: 'aperion' })
	const verifier = createCapabilityVerifier({ resolver: registry })
	return { issuer, verifier }
}

function makeEchoTool() {
	return defineTool({
		name: 'echo',
		description: 'echoes input',
		input: z.object({ msg: z.string(), ssn: z.string().optional() }),
		handler: async ({ msg }) => ({ echoed: msg }),
	})
}

describe('withCapability', () => {
	it('runs the inner tool when the token grants it', async () => {
		const { issuer, verifier } = setupIssuer()
		const token = issuer.mint({
			subject: { agent: 'a' },
			capabilities: [{ kind: 'tool', name: 'echo' }],
		})
		const guarded = withCapability(makeEchoTool(), { token, verifier })

		const result = await guarded.execute({ msg: 'hi' })
		expect(result.success).toBe(true)
		expect((result.data as { echoed: string }).echoed).toBe('hi')
	})

	it('refuses execution when the tool is not in capabilities', async () => {
		const { issuer, verifier } = setupIssuer()
		const token = issuer.mint({
			subject: { agent: 'a' },
			capabilities: [{ kind: 'tool', name: 'other-tool' }],
		})
		const denials: CapabilityDenialEvent[] = []
		const guarded = withCapability(makeEchoTool(), {
			token,
			verifier,
			onDeny: (e) => denials.push(e),
		})

		const result = await guarded.execute({ msg: 'hi' })
		expect(result.success).toBe(false)
		expect(result.error).toContain('no-matching-capability')
		expect(denials).toHaveLength(1)
		expect(denials[0].toolName).toBe('echo')
		expect(denials[0].subject).toBe('a')
		expect(denials[0].reason).toBe('no-matching-capability')
	})

	it('blocks denied fields from passing through', async () => {
		const { issuer, verifier } = setupIssuer()
		const token = issuer.mint({
			subject: { agent: 'a' },
			capabilities: [{ kind: 'tool', name: 'echo', constraints: { deniedFields: ['ssn'] } }],
		})
		const guarded = withCapability(makeEchoTool(), { token, verifier })

		const result = await guarded.execute({ msg: 'hi', ssn: '123-45-6789' })
		expect(result.success).toBe(false)
		expect(result.error).toContain('denied-field')
	})

	it('rejects when the token is expired', async () => {
		const pair = generateEd25519KeyPair()
		const signer = createEd25519Signer({ privateKey: pair.privateKey, keyId: 'k1' })
		const registry = createKeyRegistry({
			trustRoots: [{ keyId: 'k1', publicKey: pair.publicKey }],
		})
		let now = 1_000_000
		const issuer = createCapabilityIssuer({ signer, orgId: 'a', clock: () => now })
		const verifier = createCapabilityVerifier({ resolver: registry, clock: () => now })

		const token = issuer.mint({
			subject: { agent: 'a' },
			capabilities: [{ kind: 'tool', name: 'echo' }],
			ttlMs: 1_000,
		})

		now += 5_000
		const guarded = withCapability(makeEchoTool(), { token, verifier })
		const result = await guarded.execute({ msg: 'hi' })
		expect(result.success).toBe(false)
		expect(result.error).toContain('expired')
	})

	it('skips signature verification when no verifier is supplied (trusted-context mode)', async () => {
		const { issuer } = setupIssuer()
		const token = issuer.mint({
			subject: { agent: 'a' },
			capabilities: [{ kind: 'tool', name: 'echo' }],
		})
		const guarded = withCapability(makeEchoTool(), { token })
		const result = await guarded.execute({ msg: 'hi' })
		expect(result.success).toBe(true)
	})

	it('blocks denied data classes', async () => {
		const { issuer, verifier } = setupIssuer()
		const token = issuer.mint({
			subject: { agent: 'a' },
			capabilities: [{ kind: 'tool', name: 'echo' }],
			dataClasses: { denied: ['pii'] },
		})
		const guarded = withCapability(makeEchoTool(), {
			token,
			verifier,
			dataClasses: ['pii'],
		})
		const result = await guarded.execute({ msg: 'hi' })
		expect(result.success).toBe(false)
		expect(result.error).toContain('denied-data-class')
	})

	it('preserves tool metadata (name, description, schema, toDefinition)', () => {
		const { issuer, verifier } = setupIssuer()
		const token = issuer.mint({
			subject: { agent: 'a' },
			capabilities: [{ kind: 'tool', name: 'echo' }],
		})
		const inner = makeEchoTool()
		const guarded = withCapability(inner, { token, verifier })

		expect(guarded.name).toBe(inner.name)
		expect(guarded.description).toBe(inner.description)
		expect(guarded.inputSchema).toBe(inner.inputSchema)
		expect(guarded.toDefinition()).toEqual(inner.toDefinition())
	})
})
