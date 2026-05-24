import {
	createCapabilityIssuer,
	createCapabilityVerifier,
	createEd25519Signer,
	createKeyRegistry,
	generateEd25519KeyPair,
} from '@elsium-ai/core'
import type { Tool } from '@elsium-ai/tools'
import { describe, expect, it } from 'vitest'
import { createCapabilityGuardedMCPClient } from './capability-guard'
import type { MCPClient } from './client'

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

function fakeClient(
	callImpl?: (name: string, args: Record<string, unknown>) => unknown,
): MCPClient {
	let connected = true
	return {
		async connect() {
			connected = true
		},
		async disconnect() {
			connected = false
		},
		async listTools() {
			return []
		},
		async callTool(name, args) {
			return callImpl ? callImpl(name, args) : { ok: true, name }
		},
		async toElsiumTools() {
			return [] as Tool[]
		},
		async listResources() {
			return []
		},
		async readResource() {
			return []
		},
		async listPrompts() {
			return []
		},
		async getPrompt() {
			return []
		},
		get connected() {
			return connected
		},
	}
}

describe('createCapabilityGuardedMCPClient', () => {
	it('allows callTool when scoped to server and tool', async () => {
		const { issuer, verifier } = setup()
		const token = issuer.mint({
			subject: { agent: 'bot' },
			capabilities: [{ kind: 'mcp', server: 'github', tools: ['issues.list'] }],
		})
		const inner = fakeClient()
		const guarded = createCapabilityGuardedMCPClient(inner, {
			token,
			server: 'github',
			verifier,
		})
		const result = (await guarded.callTool('issues.list', {})) as { ok: boolean; name: string }
		expect(result.ok).toBe(true)
		expect(result.name).toBe('issues.list')
	})

	it('blocks callTool for a tool outside allowlist', async () => {
		const { issuer, verifier } = setup()
		const token = issuer.mint({
			subject: { agent: 'bot' },
			capabilities: [{ kind: 'mcp', server: 'github', tools: ['issues.list'] }],
		})
		const events: string[] = []
		const guarded = createCapabilityGuardedMCPClient(fakeClient(), {
			token,
			server: 'github',
			verifier,
			onDeny: (e) => events.push(`${e.server}/${e.tool}:${e.reason}`),
		})
		await expect(guarded.callTool('repos.delete', {})).rejects.toThrow(/capability denied/)
		expect(events[0]).toBe('github/repos.delete:no-matching-capability')
	})

	it('blocks callTool when server name does not match the wrapper', async () => {
		const { issuer, verifier } = setup()
		const token = issuer.mint({
			subject: { agent: 'bot' },
			capabilities: [{ kind: 'mcp', server: 'gitlab' }],
		})
		const guarded = createCapabilityGuardedMCPClient(fakeClient(), {
			token,
			server: 'github',
			verifier,
		})
		await expect(guarded.callTool('issues.list', {})).rejects.toThrow(/no-matching-capability/)
	})

	it('preserves other client methods', async () => {
		const { issuer } = setup()
		const token = issuer.mint({
			subject: { agent: 'bot' },
			capabilities: [{ kind: 'mcp', server: 'github' }],
		})
		const inner = fakeClient()
		const guarded = createCapabilityGuardedMCPClient(inner, { token, server: 'github' })
		expect(guarded.connected).toBe(true)
		await guarded.disconnect()
		expect(guarded.connected).toBe(false)
	})
})
