import { describe, expect, it } from 'vitest'
import { createAgentIdentity, createIdentityRegistry } from './identity'

describe('createAgentIdentity', () => {
	it('creates identity with agent ID and public key', () => {
		const identity = createAgentIdentity({ agentId: 'agent-1' })
		expect(identity.agentId).toBe('agent-1')
		expect(identity.publicKey).toMatch(/^[a-f0-9]{64}$/)
	})

	it('signs payload with HMAC-SHA256', () => {
		const identity = createAgentIdentity({ agentId: 'agent-1', secret: 'test-secret' })
		const signed = identity.sign({ action: 'tool_call', tool: 'search' })

		expect(signed.agentId).toBe('agent-1')
		expect(signed.signature).toMatch(/^[a-f0-9]{64}$/)
		expect(signed.nonce).toMatch(/^[a-f0-9]{32}$/)
		expect(signed.timestamp).toBeGreaterThan(0)
		expect(signed.payload).toEqual({ action: 'tool_call', tool: 'search' })
	})

	it('verifies valid signed payload', () => {
		const identity = createAgentIdentity({ agentId: 'agent-1', secret: 'test-secret' })
		const signed = identity.sign({ action: 'test' })
		const result = identity.verify(signed)

		expect(result.valid).toBe(true)
		expect(result.reason).toBeUndefined()
	})

	it('rejects tampered payload', () => {
		const identity = createAgentIdentity({ agentId: 'agent-1', secret: 'test-secret' })
		const signed = identity.sign({ action: 'test' })
		signed.payload = { action: 'tampered' }

		const result = identity.verify(signed)
		expect(result.valid).toBe(false)
		expect(result.reason).toBe('Invalid signature')
	})

	it('rejects wrong agent ID', () => {
		const identity = createAgentIdentity({ agentId: 'agent-1', secret: 'test-secret' })
		const signed = identity.sign({ action: 'test' })
		signed.agentId = 'agent-2'

		const result = identity.verify(signed)
		expect(result.valid).toBe(false)
		expect(result.reason).toBe('Agent ID mismatch')
	})

	it('rejects expired timestamp', () => {
		const identity = createAgentIdentity({
			agentId: 'agent-1',
			secret: 'test-secret',
			replayWindowMs: 1000,
		})
		const signed = identity.sign({ action: 'test' })
		signed.timestamp = Date.now() - 5000

		const expectedSig = signed.signature
		signed.signature = expectedSig

		const result = identity.verify(signed)
		expect(result.valid).toBe(false)
		expect(result.reason).toBe('Timestamp outside replay window')
	})

	it('detects replay attack (nonce reuse)', () => {
		const identity = createAgentIdentity({ agentId: 'agent-1', secret: 'test-secret' })
		const signed = identity.sign({ action: 'test' })

		const first = identity.verify(signed)
		expect(first.valid).toBe(true)

		const second = identity.verify(signed)
		expect(second.valid).toBe(false)
		expect(second.reason).toBe('Nonce already used (replay attack)')
	})

	it('produces deterministic public key from same secret', () => {
		const id1 = createAgentIdentity({ agentId: 'a', secret: 'same-secret' })
		const id2 = createAgentIdentity({ agentId: 'b', secret: 'same-secret' })
		expect(id1.publicKey).toBe(id2.publicKey)
	})

	it('produces different public keys for different secrets', () => {
		const id1 = createAgentIdentity({ agentId: 'a', secret: 'secret-1' })
		const id2 = createAgentIdentity({ agentId: 'a', secret: 'secret-2' })
		expect(id1.publicKey).not.toBe(id2.publicKey)
	})
})

describe('createIdentityRegistry', () => {
	it('registers and retrieves identities', () => {
		const registry = createIdentityRegistry()
		const id1 = createAgentIdentity({ agentId: 'agent-1' })
		const id2 = createAgentIdentity({ agentId: 'agent-2' })

		registry.register(id1)
		registry.register(id2)

		expect(registry.agents).toEqual(['agent-1', 'agent-2'])
		expect(registry.get('agent-1')).toBe(id1)
		expect(registry.get('agent-2')).toBe(id2)
		expect(registry.get('unknown')).toBeUndefined()
	})

	it('verifies signed payloads from registered agents', () => {
		const registry = createIdentityRegistry()
		const identity = createAgentIdentity({ agentId: 'agent-1', secret: 'secret' })
		registry.register(identity)

		const signed = identity.sign({ data: 'test' })
		const result = registry.verifySignedPayload(signed)
		expect(result.valid).toBe(true)
	})

	it('rejects payloads from unknown agents', () => {
		const registry = createIdentityRegistry()
		const identity = createAgentIdentity({ agentId: 'agent-1', secret: 'secret' })

		const signed = identity.sign({ data: 'test' })
		const result = registry.verifySignedPayload(signed)
		expect(result.valid).toBe(false)
		expect(result.reason).toBe('Unknown agent: agent-1')
	})

	it('rejects tampered payloads via registry', () => {
		const registry = createIdentityRegistry()
		const identity = createAgentIdentity({ agentId: 'agent-1', secret: 'secret' })
		registry.register(identity)

		const signed = identity.sign({ data: 'test' })
		signed.payload = { data: 'tampered' }
		const result = registry.verifySignedPayload(signed)
		expect(result.valid).toBe(false)
	})
})
