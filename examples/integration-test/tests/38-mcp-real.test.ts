import * as fs from 'node:fs'
import * as path from 'node:path'
import { createMCPClient } from '@elsium-ai/mcp'
import { defineTool } from '@elsium-ai/tools'
/**
 * Test 38: MCP Client-Server Real Communication
 * Verifies: real subprocess stdio transport, tool listing, tool execution, error handling
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

// Write a temporary MCP server script that the client will spawn
const SERVER_SCRIPT = `import { createMCPServer } from '@elsium-ai/mcp'
import { defineTool } from '@elsium-ai/tools'
import { z } from 'zod'

const echo = defineTool({
\tname: 'echo',
\tdescription: 'Echoes input text',
\tinput: z.object({ text: z.string() }),
\thandler: async (input) => input.text,
})

const add = defineTool({
\tname: 'add',
\tdescription: 'Adds two numbers',
\tinput: z.object({ a: z.number(), b: z.number() }),
\thandler: async (input) => String(input.a + input.b),
})

const server = createMCPServer({
\tname: 'test-mcp-server',
\tversion: '1.0.0',
\ttools: [echo, add],
})

server.start()
`

const SCRIPT_DIR = path.join(import.meta.dirname, '..', '.tmp')
const SCRIPT_PATH = path.join(SCRIPT_DIR, 'mcp-test-server.ts')

function ensureServerScript() {
	if (!fs.existsSync(SCRIPT_DIR)) {
		fs.mkdirSync(SCRIPT_DIR, { recursive: true })
	}
	fs.writeFileSync(SCRIPT_PATH, SERVER_SCRIPT)
}

describe('38 — MCP Real Communication', () => {
	it('client connects to server, lists tools, calls tool, disconnects', async () => {
		ensureServerScript()

		const client = createMCPClient({
			name: 'test-client',
			transport: 'stdio',
			command: 'bun',
			args: [SCRIPT_PATH],
			timeoutMs: 10_000,
		})

		expect(client.connected).toBe(false)

		await client.connect()
		expect(client.connected).toBe(true)

		// List tools
		const tools = await client.listTools()
		expect(tools.length).toBe(2)
		const toolNames = tools.map((t) => t.name).sort()
		expect(toolNames).toEqual(['add', 'echo'])

		// Call echo tool
		const echoResult = await client.callTool('echo', { text: 'hello world' })
		expect(echoResult).toBe('hello world')

		// Call add tool
		const addResult = await client.callTool('add', { a: 3, b: 7 })
		expect(addResult).toBe('10')

		await client.disconnect()
		expect(client.connected).toBe(false)
	})

	it('toElsiumTools converts MCP tools to ElsiumAI Tool interface', async () => {
		ensureServerScript()

		const client = createMCPClient({
			name: 'tool-convert-client',
			transport: 'stdio',
			command: 'bun',
			args: [SCRIPT_PATH],
			timeoutMs: 10_000,
		})

		await client.connect()

		const elsiumTools = await client.toElsiumTools()
		expect(elsiumTools).toHaveLength(2)

		const echoTool = elsiumTools.find((t) => t.name === 'echo')
		expect(echoTool).toBeDefined()
		expect(typeof echoTool?.execute).toBe('function')

		// Execute through ElsiumAI tool interface
		const result = await echoTool?.execute({ text: 'from elsium' })
		expect(result.success).toBe(true)
		expect(result.data).toBe('from elsium')
		expect(result.durationMs).toBeGreaterThanOrEqual(0)

		await client.disconnect()
	})

	it('calling non-existent tool returns error', async () => {
		ensureServerScript()

		const client = createMCPClient({
			name: 'error-client',
			transport: 'stdio',
			command: 'bun',
			args: [SCRIPT_PATH],
			timeoutMs: 10_000,
		})

		await client.connect()

		try {
			await client.callTool('nonexistent', {})
			expect.fail('Should have thrown')
		} catch (error: unknown) {
			const e = error as { message: string }
			expect(e.message).toContain('Unknown tool')
		}

		await client.disconnect()
	})

	it('client rejects when not connected', async () => {
		const client = createMCPClient({
			name: 'not-connected-client',
			transport: 'stdio',
			command: 'echo',
			args: ['hello'],
		})

		await expect(client.listTools()).rejects.toThrow('not connected')
	})
})
