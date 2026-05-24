import { describe, expect, it } from 'vitest'
import { createEd25519Signer, createKeyRegistry, generateEd25519KeyPair } from '../crypto'
import { createCapabilityIssuer } from './issuer'
import { createInMemoryRevocationStore } from './revocation'
import { createCapabilityVerifier } from './verifier'

function setupAll() {
	const pair = generateEd25519KeyPair()
	const signer = createEd25519Signer({ privateKey: pair.privateKey, keyId: 'k1' })
	const registry = createKeyRegistry({
		trustRoots: [{ keyId: 'k1', publicKey: pair.publicKey }],
	})
	const issuer = createCapabilityIssuer({ signer, orgId: 'org' })
	const revocationStore = createInMemoryRevocationStore()
	const verifier = createCapabilityVerifier({
		resolver: registry,
		revocationStore,
	})
	return { issuer, revocationStore, verifier }
}

describe('createInMemoryRevocationStore', () => {
	it('records and reports revocation', async () => {
		const store = createInMemoryRevocationStore()
		expect(await store.isRevoked('cap_x')).toBe(false)

		const entry = await store.revoke('cap_x', { reason: 'key compromised', revokedBy: 'admin' })
		expect(entry.tokenId).toBe('cap_x')
		expect(entry.reason).toBe('key compromised')
		expect(await store.isRevoked('cap_x')).toBe(true)
	})

	it('returns the same entry for repeated revoke calls (idempotent)', async () => {
		const store = createInMemoryRevocationStore()
		const a = await store.revoke('cap_x', { reason: 'first' })
		const b = await store.revoke('cap_x', { reason: 'second' })
		expect(b).toEqual(a)
		expect(b.reason).toBe('first')
	})

	it('rejects an empty tokenId', async () => {
		const store = createInMemoryRevocationStore()
		await expect(store.revoke('')).rejects.toThrow(/non-empty/)
	})

	it('list yields all revocation entries', async () => {
		const store = createInMemoryRevocationStore()
		await store.revoke('cap_a')
		await store.revoke('cap_b')
		const ids: string[] = []
		for await (const e of store.list()) ids.push(e.tokenId)
		expect(ids.sort()).toEqual(['cap_a', 'cap_b'])
	})
})

describe('verifyTokenAsync — with revocation store', () => {
	it('accepts a token that is not revoked', async () => {
		const { issuer, verifier } = setupAll()
		const token = issuer.mint({
			subject: { agent: 'a' },
			capabilities: [{ kind: 'tool', name: 't' }],
		})
		const result = await verifier.verifyTokenAsync(token)
		expect(result.valid).toBe(true)
	})

	it('rejects a token after revocation', async () => {
		const { issuer, revocationStore, verifier } = setupAll()
		const token = issuer.mint({
			subject: { agent: 'a' },
			capabilities: [{ kind: 'tool', name: 't' }],
		})
		await revocationStore.revoke(token.tokenId, { reason: 'manual revoke' })
		const result = await verifier.verifyTokenAsync(token)
		expect(result.valid).toBe(false)
		expect(result.reason).toBe('revoked')
		expect(result.detail).toContain('manual revoke')
	})

	it('falls back to sync result when no revocation store is configured', async () => {
		const pair = generateEd25519KeyPair()
		const signer = createEd25519Signer({ privateKey: pair.privateKey, keyId: 'k1' })
		const registry = createKeyRegistry({
			trustRoots: [{ keyId: 'k1', publicKey: pair.publicKey }],
		})
		const issuer = createCapabilityIssuer({ signer, orgId: 'org' })
		const verifier = createCapabilityVerifier({ resolver: registry })
		const token = issuer.mint({
			subject: { agent: 'a' },
			capabilities: [{ kind: 'tool', name: 't' }],
		})
		const result = await verifier.verifyTokenAsync(token)
		expect(result.valid).toBe(true)
	})

	it('does not query revocation when token is already invalid (short-circuit)', async () => {
		const { issuer, verifier } = setupAll()
		const token = issuer.mint({
			subject: { agent: 'a' },
			capabilities: [{ kind: 'tool', name: 't' }],
		})
		const tampered = JSON.parse(JSON.stringify(token))
		tampered.capabilities.push({ kind: 'tool', name: 'unauthorized' })
		const result = await verifier.verifyTokenAsync(tampered)
		expect(result.valid).toBe(false)
		expect(result.reason).toBe('bad-signature')
	})
})
