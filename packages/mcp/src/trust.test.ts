import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { MCPClient, MCPClientConfig, MCPToolInfo } from './client'
import type { MCPAuditEvent, MCPAuditLogger } from './trust'
import { createTrustedMCPClient } from './trust'

vi.mock('./client', () => {
	function createMockClient(): MCPClient {
		const tools: MCPToolInfo[] = [
			{ name: 'read-file', description: 'Read a file', inputSchema: { type: 'object' } },
			{ name: 'write-file', description: 'Write a file', inputSchema: { type: 'object' } },
			{ name: 'delete-file', description: 'Delete a file', inputSchema: { type: 'object' } },
		]
		return {
			connected: false,
			connect: vi.fn(),
			disconnect: vi.fn(),
			listTools: vi.fn().mockResolvedValue(tools),
			callTool: vi.fn().mockResolvedValue({ success: true }),
			toElsiumTools: vi.fn().mockResolvedValue([]),
			listResources: vi.fn().mockResolvedValue([]),
			readResource: vi.fn().mockResolvedValue([]),
			listPrompts: vi.fn().mockResolvedValue([]),
			getPrompt: vi.fn().mockResolvedValue([]),
		}
	}
	return { createMCPClient: vi.fn(createMockClient) }
})

function createMockMCPConfig(name = 'test-server'): MCPClientConfig {
	return {
		name,
		transport: 'http',
		url: 'http://localhost:3001/mcp',
	}
}

function createStdioConfig(name = 'test-server'): MCPClientConfig {
	return {
		name,
		transport: 'stdio',
		command: 'node',
		args: ['server.js'],
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

describe('createTrustedMCPClient — server allowlist', () => {
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

	it('rejects when name matches but URL pattern does not', () => {
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
	})

	it('accepts when URL pattern matches', () => {
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

	it('matches stdio server with correct command hash', () => {
		const config = createStdioConfig()
		const cmdHash = createHash('sha256')
			.update(`${config.command}:${(config as { args?: string[] }).args?.join(':') ?? ''}`)
			.digest('hex')
		const client = createTrustedMCPClient(config, {
			allowedServers: [
				{
					name: 'test-server',
					transport: 'stdio',
					commandHash: cmdHash,
				},
			],
		})
		expect(client.connected).toBe(false)
	})

	it('rejects stdio server with mismatched command hash', () => {
		const config = createStdioConfig()
		const wrongHash = createHash('sha256').update('wrong:args').digest('hex')
		expect(() =>
			createTrustedMCPClient(config, {
				allowedServers: [
					{
						name: 'test-server',
						transport: 'stdio',
						commandHash: wrongHash,
					},
				],
			}),
		).toThrow(/not in the allowed servers list/)
	})

	it('accepts server matching first entry in multi-entry allowlist', () => {
		const client = createTrustedMCPClient(createMockMCPConfig(), {
			allowedServers: [
				{ name: 'other', transport: 'http' },
				{ name: 'test-server', transport: 'http' },
			],
		})
		expect(client.connected).toBe(false)
	})

	it('rejects when allowlist has entries but none match', () => {
		expect(() =>
			createTrustedMCPClient(createMockMCPConfig(), {
				allowedServers: [
					{ name: 'alpha', transport: 'http' },
					{ name: 'beta', transport: 'http' },
				],
			}),
		).toThrow(/not in the allowed servers list/)
	})

	it('allows server when allowlist is empty array (no restrictions)', () => {
		const client = createTrustedMCPClient(createMockMCPConfig(), {
			allowedServers: [],
		})
		expect(client.connected).toBe(false)
	})
})

describe('connect / disconnect', () => {
	it('connect delegates to inner client and audits', async () => {
		const logger = createMockAuditLogger()
		const client = createTrustedMCPClient(createMockMCPConfig(), { auditLog: logger })
		await client.connect()
		expect(logger.events).toHaveLength(1)
		expect(logger.events[0].type).toBe('connection')
		expect(logger.events[0].serverName).toBe('test-server')
		expect(logger.events[0].data).toEqual({ action: 'connect' })
	})

	it('disconnect delegates to inner client and audits', async () => {
		const logger = createMockAuditLogger()
		const client = createTrustedMCPClient(createMockMCPConfig(), { auditLog: logger })
		await client.disconnect()
		expect(logger.events).toHaveLength(1)
		expect(logger.events[0].type).toBe('connection')
		expect(logger.events[0].serverName).toBe('test-server')
		expect(logger.events[0].data).toEqual({ action: 'disconnect' })
	})

	it('does not throw when no audit logger configured', async () => {
		const client = createTrustedMCPClient(createMockMCPConfig(), {})
		await expect(client.connect()).resolves.toBeUndefined()
		await expect(client.disconnect()).resolves.toBeUndefined()
	})
})

describe('listTools — filtering', () => {
	it('returns all tools when no allowlist configured', async () => {
		const client = createTrustedMCPClient(createMockMCPConfig(), {})
		const tools = await client.listTools()
		expect(tools).toHaveLength(3)
		expect(tools.map((t) => t.name)).toEqual(['read-file', 'write-file', 'delete-file'])
	})

	it('filters out denied tools', async () => {
		const client = createTrustedMCPClient(createMockMCPConfig(), {
			allowedServers: [
				{
					name: 'test-server',
					transport: 'http',
					deniedTools: ['delete-file'],
				},
			],
		})
		const tools = await client.listTools()
		expect(tools).toHaveLength(2)
		expect(tools.map((t) => t.name)).toEqual(['read-file', 'write-file'])
	})

	it('only returns tools in the allowed list', async () => {
		const client = createTrustedMCPClient(createMockMCPConfig(), {
			allowedServers: [
				{
					name: 'test-server',
					transport: 'http',
					allowedTools: ['read-file'],
				},
			],
		})
		const tools = await client.listTools()
		expect(tools).toHaveLength(1)
		expect(tools[0].name).toBe('read-file')
	})

	it('returns empty list when no tools are allowed', async () => {
		const client = createTrustedMCPClient(createMockMCPConfig(), {
			allowedServers: [
				{
					name: 'test-server',
					transport: 'http',
					allowedTools: [],
				},
			],
		})
		const tools = await client.listTools()
		expect(tools).toHaveLength(0)
	})

	it('filters out all tools when all are denied', async () => {
		const client = createTrustedMCPClient(createMockMCPConfig(), {
			allowedServers: [
				{
					name: 'test-server',
					transport: 'http',
					deniedTools: ['read-file', 'write-file', 'delete-file'],
				},
			],
		})
		const tools = await client.listTools()
		expect(tools).toHaveLength(0)
	})

	it('audits tool_list event with counts', async () => {
		const logger = createMockAuditLogger()
		const client = createTrustedMCPClient(createMockMCPConfig(), {
			auditLog: logger,
			allowedServers: [
				{
					name: 'test-server',
					transport: 'http',
					deniedTools: ['delete-file'],
				},
			],
		})
		await client.listTools()
		const event = logger.events.find((e) => e.type === 'tool_list')
		expect(event).toBeDefined()
		expect(event?.data).toMatchObject({
			totalTools: 3,
			allowedTools: 2,
		})
	})
})

describe('callTool', () => {
	it('calls allowed tool and returns result', async () => {
		const client = createTrustedMCPClient(createMockMCPConfig(), {})
		const result = await client.callTool('read-file', { path: '/tmp/test' })
		expect(result).toEqual({ success: true })
	})

	it('throws for denied tool', async () => {
		const client = createTrustedMCPClient(createMockMCPConfig(), {
			allowedServers: [
				{
					name: 'test-server',
					transport: 'http',
					deniedTools: ['delete-file'],
				},
			],
		})
		await expect(client.callTool('delete-file', {})).rejects.toThrow(/not allowed/)
	})

	it('throws for tool not in allowed list', async () => {
		const client = createTrustedMCPClient(createMockMCPConfig(), {
			allowedServers: [
				{
					name: 'test-server',
					transport: 'http',
					allowedTools: ['read-file'],
				},
			],
		})
		await expect(client.callTool('write-file', {})).rejects.toThrow(/not allowed/)
	})

	it('throws when output exceeds default size limit', async () => {
		const { createMCPClient } = await import('./client')
		const bigResult = { data: 'x'.repeat(2 * 1024 * 1024) }
		;(createMCPClient as ReturnType<typeof vi.fn>).mockReturnValueOnce({
			connected: false,
			connect: vi.fn(),
			disconnect: vi.fn(),
			listTools: vi.fn().mockResolvedValue([]),
			callTool: vi.fn().mockResolvedValue(bigResult),
			toElsiumTools: vi.fn().mockResolvedValue([]),
			listResources: vi.fn().mockResolvedValue([]),
			readResource: vi.fn().mockResolvedValue([]),
			listPrompts: vi.fn().mockResolvedValue([]),
			getPrompt: vi.fn().mockResolvedValue([]),
		})
		const client = createTrustedMCPClient(createMockMCPConfig(), {})
		await expect(client.callTool('read-file', {})).rejects.toThrow(/exceeds maximum size/)
	})

	it('throws when output exceeds custom size limit', async () => {
		const { createMCPClient } = await import('./client')
		const result = { data: 'x'.repeat(100) }
		;(createMCPClient as ReturnType<typeof vi.fn>).mockReturnValueOnce({
			connected: false,
			connect: vi.fn(),
			disconnect: vi.fn(),
			listTools: vi.fn().mockResolvedValue([]),
			callTool: vi.fn().mockResolvedValue(result),
			toElsiumTools: vi.fn().mockResolvedValue([]),
			listResources: vi.fn().mockResolvedValue([]),
			readResource: vi.fn().mockResolvedValue([]),
			listPrompts: vi.fn().mockResolvedValue([]),
			getPrompt: vi.fn().mockResolvedValue([]),
		})
		const client = createTrustedMCPClient(createMockMCPConfig(), {
			maxToolOutputSize: 50,
		})
		await expect(client.callTool('read-file', {})).rejects.toThrow(/exceeds maximum size/)
	})

	it('handles string output for size check', async () => {
		const { createMCPClient } = await import('./client')
		;(createMCPClient as ReturnType<typeof vi.fn>).mockReturnValueOnce({
			connected: false,
			connect: vi.fn(),
			disconnect: vi.fn(),
			listTools: vi.fn().mockResolvedValue([]),
			callTool: vi.fn().mockResolvedValue('x'.repeat(2 * 1024 * 1024)),
			toElsiumTools: vi.fn().mockResolvedValue([]),
			listResources: vi.fn().mockResolvedValue([]),
			readResource: vi.fn().mockResolvedValue([]),
			listPrompts: vi.fn().mockResolvedValue([]),
			getPrompt: vi.fn().mockResolvedValue([]),
		})
		const client = createTrustedMCPClient(createMockMCPConfig(), {})
		await expect(client.callTool('read-file', {})).rejects.toThrow(/exceeds maximum size/)
	})

	it('audits tool_call and tool_result events on success', async () => {
		const logger = createMockAuditLogger()
		const client = createTrustedMCPClient(createMockMCPConfig(), {
			auditLog: logger,
		})
		await client.callTool('read-file', { path: '/tmp/test' })
		const callEvent = logger.events.find((e) => e.type === 'tool_call')
		expect(callEvent).toBeDefined()
		expect(callEvent?.data).toMatchObject({
			tool: 'read-file',
			argumentKeys: ['path'],
		})
		const resultEvent = logger.events.find((e) => e.type === 'tool_result')
		expect(resultEvent).toBeDefined()
		expect(resultEvent?.data).toMatchObject({
			tool: 'read-file',
			outputSize: expect.any(Number),
		})
	})

	it('audits security_violation on denied tool call', async () => {
		const logger = createMockAuditLogger()
		const client = createTrustedMCPClient(createMockMCPConfig(), {
			auditLog: logger,
			allowedServers: [
				{
					name: 'test-server',
					transport: 'http',
					deniedTools: ['delete-file'],
				},
			],
		})
		await expect(client.callTool('delete-file', {})).rejects.toThrow()
		const violation = logger.events.find((e) => e.type === 'security_violation')
		expect(violation).toBeDefined()
		expect(violation?.data).toMatchObject({
			tool: 'delete-file',
			reason: 'Tool not allowed',
		})
	})

	it('audits security_violation on oversized output', async () => {
		const { createMCPClient } = await import('./client')
		;(createMCPClient as ReturnType<typeof vi.fn>).mockReturnValueOnce({
			connected: false,
			connect: vi.fn(),
			disconnect: vi.fn(),
			listTools: vi.fn().mockResolvedValue([]),
			callTool: vi.fn().mockResolvedValue({ data: 'x'.repeat(2 * 1024 * 1024) }),
			toElsiumTools: vi.fn().mockResolvedValue([]),
			listResources: vi.fn().mockResolvedValue([]),
			readResource: vi.fn().mockResolvedValue([]),
			listPrompts: vi.fn().mockResolvedValue([]),
			getPrompt: vi.fn().mockResolvedValue([]),
		})
		const logger = createMockAuditLogger()
		const client = createTrustedMCPClient(createMockMCPConfig(), {
			auditLog: logger,
		})
		await expect(client.callTool('read-file', {})).rejects.toThrow()
		const violation = logger.events.find((e) => e.type === 'security_violation')
		expect(violation).toBeDefined()
		expect(violation?.data).toMatchObject({
			tool: 'read-file',
			reason: 'Output exceeds size limit',
		})
	})

	it('does not throw for server not in allowlist when allowlist is empty', async () => {
		const client = createTrustedMCPClient(createMockMCPConfig(), {
			allowedServers: [{ name: 'test-server', transport: 'http' }],
		})
		const result = await client.callTool('read-file', {})
		expect(result).toEqual({ success: true })
	})
})

describe('generateManifest', () => {
	it('generates manifest with correct structure', async () => {
		const client = createTrustedMCPClient(createMockMCPConfig(), {})
		const manifest = await client.generateManifest()
		expect(manifest.serverName).toBe('test-server')
		expect(manifest.tools).toHaveLength(3)
		expect(manifest.tools[0]).toMatchObject({
			name: 'read-file',
			description: 'Read a file',
		})
		expect(manifest.tools[0].inputSchemaHash).toBeTruthy()
		expect(manifest.generatedAt).toBeGreaterThan(0)
		expect(manifest.hash).toBeTruthy()
	})

	it('updates the currentManifest getter', async () => {
		const client = createTrustedMCPClient(createMockMCPConfig(), {})
		expect(client.manifest).toBeNull()
		const manifest = await client.generateManifest()
		expect(client.manifest).toBe(manifest)
	})

	it('generates stable hashes for same tools', async () => {
		const client = createTrustedMCPClient(createMockMCPConfig(), {})
		const m1 = await client.generateManifest()
		const m2 = await client.generateManifest()
		expect(m1.hash).toBe(m2.hash)
	})

	it('hash changes when tools differ', async () => {
		const { createMCPClient } = await import('./client')
		;(createMCPClient as ReturnType<typeof vi.fn>).mockReturnValueOnce({
			connected: false,
			connect: vi.fn(),
			disconnect: vi.fn(),
			listTools: vi
				.fn()
				.mockResolvedValue([{ name: 'tool-a', description: 'A', inputSchema: { type: 'object' } }]),
			callTool: vi.fn(),
			toElsiumTools: vi.fn().mockResolvedValue([]),
			listResources: vi.fn().mockResolvedValue([]),
			readResource: vi.fn().mockResolvedValue([]),
			listPrompts: vi.fn().mockResolvedValue([]),
			getPrompt: vi.fn().mockResolvedValue([]),
		})
		const clientA = createTrustedMCPClient(createMockMCPConfig(), {})
		const mA = await clientA.generateManifest()
		;(createMCPClient as ReturnType<typeof vi.fn>).mockReturnValueOnce({
			connected: false,
			connect: vi.fn(),
			disconnect: vi.fn(),
			listTools: vi
				.fn()
				.mockResolvedValue([{ name: 'tool-b', description: 'B', inputSchema: { type: 'object' } }]),
			callTool: vi.fn(),
			toElsiumTools: vi.fn().mockResolvedValue([]),
			listResources: vi.fn().mockResolvedValue([]),
			readResource: vi.fn().mockResolvedValue([]),
			listPrompts: vi.fn().mockResolvedValue([]),
			getPrompt: vi.fn().mockResolvedValue([]),
		})
		const clientB = createTrustedMCPClient(createMockMCPConfig(), {})
		const mB = await clientB.generateManifest()
		expect(mA.hash).not.toBe(mB.hash)
	})
})

describe('verifyManifest', () => {
	it('returns true when hashes match', async () => {
		const client = createTrustedMCPClient(createMockMCPConfig(), {})
		const manifest = await client.generateManifest()
		const result = await client.verifyManifest(manifest)
		expect(result).toBe(true)
	})

	it('returns false when hashes differ', async () => {
		const { createMCPClient } = await import('./client')
		const manifest = {
			serverName: 'test-server',
			tools: [{ name: 'read-file', description: 'Read', inputSchemaHash: 'abc' }],
			generatedAt: Date.now(),
			hash: 'different-hash-value',
		}
		const result = await createTrustedMCPClient(createMockMCPConfig(), {}).verifyManifest(manifest)
		expect(result).toBe(false)
	})

	it('audits security_violation on mismatch', async () => {
		const logger = createMockAuditLogger()
		const manifest = {
			serverName: 'test-server',
			tools: [{ name: 'read-file', description: 'Read', inputSchemaHash: 'abc' }],
			generatedAt: Date.now(),
			hash: 'fake-hash',
		}
		await createTrustedMCPClient(createMockMCPConfig(), {
			auditLog: logger,
		}).verifyManifest(manifest)
		const violation = logger.events.find(
			(e) => e.type === 'security_violation' && e.data.reason === 'Manifest mismatch',
		)
		expect(violation).toBeDefined()
		expect(violation?.data).toMatchObject({
			expectedHash: 'fake-hash',
			actualHash: expect.any(String),
		})
	})
})

describe('passthrough methods', () => {
	it('delegates toElsiumTools to inner client', async () => {
		const { createMCPClient } = await import('./client')
		const client = createTrustedMCPClient(createMockMCPConfig(), {})
		const result = await client.toElsiumTools()
		expect(createMCPClient).toHaveBeenCalled()
		expect(result).toEqual([])
	})

	it('delegates listResources to inner client', async () => {
		const client = createTrustedMCPClient(createMockMCPConfig(), {})
		const result = await client.listResources()
		expect(result).toEqual([])
	})

	it('delegates readResource to inner client', async () => {
		const client = createTrustedMCPClient(createMockMCPConfig(), {})
		const result = await client.readResource('test://uri')
		expect(result).toEqual([])
	})

	it('delegates listPrompts to inner client', async () => {
		const client = createTrustedMCPClient(createMockMCPConfig(), {})
		const result = await client.listPrompts()
		expect(result).toEqual([])
	})

	it('delegates getPrompt to inner client', async () => {
		const client = createTrustedMCPClient(createMockMCPConfig(), {})
		const result = await client.getPrompt('test-prompt')
		expect(result).toEqual([])
	})

	it('returns connected status from inner client', () => {
		const client = createTrustedMCPClient(createMockMCPConfig(), {})
		expect(client.connected).toBe(false)
	})
})
