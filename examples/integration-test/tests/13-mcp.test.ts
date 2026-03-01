import { createMCPClient, createMCPServer } from '@elsium-ai/mcp'
import { defineTool } from '@elsium-ai/tools'
/**
 * Test 13: MCP Server & Client
 * Verifies: createMCPServer (config shape), createMCPClient (config shape)
 *
 * Note: We test config acceptance and object creation, not actual
 * stdio transport (which requires a running subprocess).
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

describe('13 — MCP', () => {
	it('createMCPServer accepts config and returns server interface', () => {
		const tool = defineTool({
			name: 'echo',
			description: 'Echoes input',
			input: z.object({ text: z.string() }),
			handler: async (input) => input.text,
		})

		const server = createMCPServer({
			name: 'test-server',
			version: '1.0.0',
			tools: [tool],
		})

		expect(server).toBeDefined()
		expect(typeof server.start).toBe('function')
		expect(typeof server.stop).toBe('function')
		expect(server.running).toBe(false)
	})

	it('createMCPClient accepts config and returns client interface', () => {
		const client = createMCPClient({
			name: 'test-client',
			transport: 'stdio',
			command: 'echo',
			args: ['hello'],
			timeoutMs: 5000,
		})

		expect(client).toBeDefined()
		expect(typeof client.connect).toBe('function')
		expect(typeof client.disconnect).toBe('function')
		expect(typeof client.listTools).toBe('function')
		expect(typeof client.callTool).toBe('function')
		expect(typeof client.toElsiumTools).toBe('function')
		expect(client.connected).toBe(false)
	})

	it('MCPServer with multiple tools', () => {
		const tool1 = defineTool({
			name: 'tool-a',
			description: 'Tool A',
			input: z.object({ a: z.string() }),
			handler: async (input) => input.a,
		})

		const tool2 = defineTool({
			name: 'tool-b',
			description: 'Tool B',
			input: z.object({ b: z.number() }),
			handler: async (input) => input.b * 2,
		})

		const server = createMCPServer({
			name: 'multi-tool-server',
			tools: [tool1, tool2],
		})

		expect(server).toBeDefined()
		expect(server.running).toBe(false)
	})
})
