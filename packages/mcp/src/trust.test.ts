import { describe, expect, it } from 'vitest'
import type { MCPAuditEvent, MCPAuditLogger } from './trust'
import { createTrustedMCPClient } from './trust'

function createMockMCPConfig(name = 'test-server') {
	return {
		name,
		transport: 'http' as const,
		url: 'http://localhost:3001/mcp',
	}
}

function createMockAuditLogger(): MCPAuditLogger & { events: MCPAuditEvent[] } {
	const events: MCPAuditEvent[] = []
	return {
		events,
		log(event: MCPAuditEvent) {
			events.push(event)
		},
	}
}

describe('createTrustedMCPClient', () => {
	it('rejects server not in allowlist', () => {
		expect(() =>
			createTrustedMCPClient(createMockMCPConfig(), {
				allowedServers: [{ name: 'other-server', transport: 'http' }],
			}),
		).toThrow(/not in the allowed servers list/)
	})

	it('allows server when no allowlist configured', () => {
		const client = createTrustedMCPClient(createMockMCPConfig(), {})
		expect(client.connected).toBe(false)
	})

	it('allows server matching allowlist', () => {
		const client = createTrustedMCPClient(createMockMCPConfig(), {
			allowedServers: [{ name: 'test-server', transport: 'http' }],
		})
		expect(client.connected).toBe(false)
	})

	it('rejects server with wrong transport', () => {
		expect(() =>
			createTrustedMCPClient(createMockMCPConfig(), {
				allowedServers: [{ name: 'test-server', transport: 'stdio' }],
			}),
		).toThrow(/not in the allowed servers list/)
	})

	it('validates URL pattern for HTTP servers', () => {
		expect(() =>
			createTrustedMCPClient(createMockMCPConfig(), {
				allowedServers: [
					{
						name: 'test-server',
						transport: 'http',
						urlPattern: '^https://trusted\\.example\\.com',
					},
				],
			}),
		).toThrow(/not in the allowed servers list/)

		const client = createTrustedMCPClient(createMockMCPConfig(), {
			allowedServers: [
				{
					name: 'test-server',
					transport: 'http',
					urlPattern: '^http://localhost',
				},
			],
		})
		expect(client.connected).toBe(false)
	})

	it('logs audit events', () => {
		const logger = createMockAuditLogger()
		createTrustedMCPClient(createMockMCPConfig(), {
			auditLog: logger,
		})
		expect(logger.events).toHaveLength(0)
	})

	it('manifest starts as null', () => {
		const client = createTrustedMCPClient(createMockMCPConfig(), {})
		expect(client.manifest).toBeNull()
	})
})
