import { describe, expect, it } from 'vitest'
import { createAgentIdentity, createIdentityRegistry } from './identity'

describe('createAgentIdentity', () => {
	it('creates identity with agent ID and public key', async () => {
		const identity = await createAgentIdentity({ agentId: 'agent-1' })
		expect(identity.agentId).toBe('agent-1')
		expect(identity.publicKey).toMatch(/^[a-f0-9]{64}$/)
	})

	it('signs payload with HMAC-SHA256', async () => {
		const identity = await createAgentIdentity({ agentId: 'agent-1', secret: 'test-secret' })
		const signed = await identity.sign({ action: 'tool_call', tool: 'search' })

		expect(signed.agentId).toBe('agent-1')
		expect(signed.signature).toMatch(/^[a-f0-9]{64}$/)
		expect(signed.nonce).toMatch(/^[a-f0-9]{32}$/)
		expect(signed.timestamp).toBeGreaterThan(0)
		expect(signed.payload).toEqual({ action: 'tool_call', tool: 'search' })
	})

	it('verifies valid signed payload', async () => {
		const identity = await createAgentIdentity({ agentId: 'agent-1', secret: 'test-secret' })
		const signed = await identity.sign({ action: 'test' })
		const result = await identity.verify(signed)

		expect(result.valid).toBe(true)
		expect(result.reason).toBeUndefined()
	})

	it('rejects tampered payload', async () => {
		const identity = await createAgentIdentity({ agentId: 'agent-1', secret: 'test-secret' })
		const signed = await identity.sign({ action: 'test' })
		signed.payload = { action: 'tampered' }

		const result = await identity.verify(signed)
		expect(result.valid).toBe(false)
		expect(result.reason).toBe('Invalid signature')
	})

	it('rejects wrong agent ID', async () => {
		const identity = await createAgentIdentity({ agentId: 'agent-1', secret: 'test-secret' })
		const signed = await identity.sign({ action: 'test' })
		signed.agentId = 'agent-2'

		const result = await identity.verify(signed)
		expect(result.valid).toBe(false)
		expect(result.reason).toBe('Agent ID mismatch')
	})

	it('rejects expired timestamp', async () => {
		const identity = await createAgentIdentity({
			agentId: 'agent-1',
			secret: 'test-secret',
			replayWindowMs: 1000,
		})
		const signed = await identity.sign({ action: 'test' })
		signed.timestamp = Date.now() - 5000

		const result = await identity.verify(signed)
		expect(result.valid).toBe(false)
		expect(result.reason).toBe('Timestamp outside replay window')
	})

	it('detects replay attack (nonce reuse)', async () => {
		const identity = await createAgentIdentity({ agentId: 'agent-1', secret: 'test-secret' })
		const signed = await identity.sign({ action: 'test' })

		const first = await identity.verify(signed)
		expect(first.valid).toBe(true)

		const second = await identity.verify(signed)
		expect(second.valid).toBe(false)
		expect(second.reason).toBe('Nonce already used (replay attack)')
	})

	it('produces deterministic public key from same secret', async () => {
		const id1 = await createAgentIdentity({ agentId: 'a', secret: 'same-secret' })
		const id2 = await createAgentIdentity({ agentId: 'b', secret: 'same-secret' })
		expect(id1.publicKey).toBe(id2.publicKey)
	})

	it('produces different public keys for different secrets', async () => {
		const id1 = await createAgentIdentity({ agentId: 'a', secret: 'secret-1' })
		const id2 = await createAgentIdentity({ agentId: 'a', secret: 'secret-2' })
		expect(id1.publicKey).not.toBe(id2.publicKey)
	})
})

describe('createIdentityRegistry', () => {
	it('registers and retrieves identities', async () => {
		const registry = createIdentityRegistry()
		const id1 = await createAgentIdentity({ agentId: 'agent-1' })
		const id2 = await createAgentIdentity({ agentId: 'agent-2' })

		registry.register(id1)
		registry.register(id2)

		expect(registry.agents).toEqual(['agent-1', 'agent-2'])
		expect(registry.get('agent-1')).toBe(id1)
		expect(registry.get('agent-2')).toBe(id2)
		expect(registry.get('unknown')).toBeUndefined()
	})

	it('verifies signed payloads from registered agents', async () => {
		const registry = createIdentityRegistry()
		const identity = await createAgentIdentity({ agentId: 'agent-1', secret: 'secret' })
		registry.register(identity)

		const signed = await identity.sign({ data: 'test' })
		const result = await registry.verifySignedPayload(signed)
		expect(result.valid).toBe(true)
	})

	it('rejects payloads from unknown agents', async () => {
		const registry = createIdentityRegistry()
		const identity = await createAgentIdentity({ agentId: 'agent-1', secret: 'secret' })

		const signed = await identity.sign({ data: 'test' })
		const result = await registry.verifySignedPayload(signed)
		expect(result.valid).toBe(false)
		expect(result.reason).toBe('Unknown agent: agent-1')
	})

	it('rejects tampered payloads via registry', async () => {
		const registry = createIdentityRegistry()
		const identity = await createAgentIdentity({ agentId: 'agent-1', secret: 'secret' })
		registry.register(identity)

		const signed = await identity.sign({ data: 'test' })
		signed.payload = { data: 'tampered' }
		const result = await registry.verifySignedPayload(signed)
		expect(result.valid).toBe(false)
	})
})
