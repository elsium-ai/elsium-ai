import type { ToolDefinition } from '@elsium-ai/core'
import type { Tool, ToolContext, ToolExecutionResult } from '@elsium-ai/tools'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMCPClient } from './client'
import { createMCPHttpHandler } from './server'

// ─── Helpers ─────────────────────────────────────────────────────

function makeMockResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	})
}

function makeTool(name: string, description: string, returnValue: unknown): Tool {
	return {
		name,
		description,
		inputSchema: { _def: { typeName: 'ZodObject' } } as never,
		rawSchema: { type: 'object', properties: {} },
		timeoutMs: 5000,
		async execute(_input: unknown, ctx?: Partial<ToolContext>): Promise<ToolExecutionResult> {
			return {
				success: true,
				data: returnValue,
				toolCallId: ctx?.toolCallId ?? 'tc-test',
				durationMs: 0,
			}
		},
		toDefinition(): ToolDefinition {
			return { name, description, inputSchema: { type: 'object', properties: {} } }
		},
	}
}

// ─── HTTP Client ─────────────────────────────────────────────────

describe('MCP HTTP client', () => {
	let originalFetch: typeof fetch
	let mockFetch: ReturnType<typeof vi.fn>

	beforeEach(() => {
		originalFetch = globalThis.fetch
		mockFetch = vi.fn()
		vi.stubGlobal('fetch', mockFetch)
	})

	afterEach(() => {
		vi.stubGlobal('fetch', originalFetch)
	})

	describe('connect', () => {
		it('sets connected to true after a successful initialize', async () => {
			mockFetch.mockResolvedValue(
				makeMockResponse({
					jsonrpc: '2.0',
					id: 1,
					result: {
						protocolVersion: '2024-11-05',
						capabilities: { tools: {} },
						serverInfo: { name: 'test', version: '0.1.0' },
					},
				}),
			)

			const client = createMCPClient({
				name: 'test',
				transport: 'http',
				url: 'http://localhost:3000/mcp',
			})

			expect(client.connected).toBe(false)
			await client.connect()
			expect(client.connected).toBe(true)
		})

		it('does not send a second initialize request if already connected', async () => {
			mockFetch.mockResolvedValue(
				makeMockResponse({
					jsonrpc: '2.0',
					id: 1,
					result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: {} },
				}),
			)

			const client = createMCPClient({
				name: 'test',
				transport: 'http',
				url: 'http://localhost:3000/mcp',
			})

			await client.connect()
			const callsAfterFirstConnect = mockFetch.mock.calls.length

			await client.connect()
			// No additional calls made — connect() is idempotent
			expect(mockFetch.mock.calls.length).toBe(callsAfterFirstConnect)
		})
	})

	describe('disconnect', () => {
		it('sets connected to false', async () => {
			mockFetch.mockResolvedValue(
				makeMockResponse({
					jsonrpc: '2.0',
					id: 1,
					result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: {} },
				}),
			)

			const client = createMCPClient({
				name: 'test',
				transport: 'http',
				url: 'http://localhost:3000/mcp',
			})

			await client.connect()
			expect(client.connected).toBe(true)
			await client.disconnect()
			expect(client.connected).toBe(false)
		})
	})

	describe('listTools', () => {
		it('returns the tools list from the server', async () => {
			const toolsResponse = {
				jsonrpc: '2.0',
				id: 2,
				result: {
					tools: [
						{ name: 'search', description: 'Search the web', inputSchema: { type: 'object' } },
					],
				},
			}

			// First call is initialize, second is tools/list
			mockFetch
				.mockResolvedValueOnce(
					makeMockResponse({
						jsonrpc: '2.0',
						id: 1,
						result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: {} },
					}),
				)
				.mockResolvedValueOnce(makeMockResponse(toolsResponse))

			const client = createMCPClient({
				name: 'test',
				transport: 'http',
				url: 'http://localhost:3000/mcp',
			})

			await client.connect()
			const tools = await client.listTools()

			expect(tools).toHaveLength(1)
			expect(tools[0].name).toBe('search')
			expect(tools[0].description).toBe('Search the web')
		})

		it('throws when not connected', async () => {
			const client = createMCPClient({
				name: 'test',
				transport: 'http',
				url: 'http://localhost:3000/mcp',
			})

			await expect(client.listTools()).rejects.toThrow(/not connected/i)
		})
	})

	describe('callTool', () => {
		it('calls the tool and returns text content', async () => {
			const toolCallResponse = {
				jsonrpc: '2.0',
				id: 2,
				result: {
					content: [{ type: 'text', text: 'Result from tool' }],
				},
			}

			mockFetch
				.mockResolvedValueOnce(
					makeMockResponse({
						jsonrpc: '2.0',
						id: 1,
						result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: {} },
					}),
				)
				.mockResolvedValueOnce(makeMockResponse(toolCallResponse))

			const client = createMCPClient({
				name: 'test',
				transport: 'http',
				url: 'http://localhost:3000/mcp',
			})

			await client.connect()
			const result = await client.callTool('search', { query: 'hello' })

			expect(result).toBe('Result from tool')

			const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]
			const requestBody = JSON.parse(lastCall[1].body as string)
			expect(requestBody.method).toBe('tools/call')
			expect(requestBody.params.name).toBe('search')
			expect(requestBody.params.arguments).toEqual({ query: 'hello' })
		})

		it('throws an ElsiumError on HTTP error status', async () => {
			mockFetch
				.mockResolvedValueOnce(
					makeMockResponse({
						jsonrpc: '2.0',
						id: 1,
						result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: {} },
					}),
				)
				.mockResolvedValueOnce(new Response('Internal Server Error', { status: 500 }))

			const client = createMCPClient({
				name: 'test',
				transport: 'http',
				url: 'http://localhost:3000/mcp',
			})

			await client.connect()
			await expect(client.callTool('search', {})).rejects.toMatchObject({
				code: 'PROVIDER_ERROR',
			})
		})

		it('throws an ElsiumError on JSON-RPC error', async () => {
			mockFetch
				.mockResolvedValueOnce(
					makeMockResponse({
						jsonrpc: '2.0',
						id: 1,
						result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: {} },
					}),
				)
				.mockResolvedValueOnce(
					makeMockResponse({
						jsonrpc: '2.0',
						id: 2,
						error: { code: -32602, message: 'Unknown tool: missing' },
					}),
				)

			const client = createMCPClient({
				name: 'test',
				transport: 'http',
				url: 'http://localhost:3000/mcp',
			})

			await client.connect()
			await expect(client.callTool('missing', {})).rejects.toMatchObject({
				code: 'PROVIDER_ERROR',
			})
		})
	})
})

// ─── HTTP Handler ─────────────────────────────────────────────────

describe('createMCPHttpHandler', () => {
	function makeRequest(body: unknown, method = 'POST'): Request {
		return new Request('http://localhost/mcp', {
			method,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		})
	}

	it('returns 405 for non-POST requests', async () => {
		const handler = createMCPHttpHandler({ name: 'test', tools: [] })
		const response = await handler(new Request('http://localhost/mcp', { method: 'GET' }))
		expect(response.status).toBe(405)
	})

	it('returns 400 for malformed JSON body', async () => {
		const handler = createMCPHttpHandler({ name: 'test', tools: [] })
		const response = await handler(
			new Request('http://localhost/mcp', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: 'not-json{{{',
			}),
		)
		expect(response.status).toBe(400)
		const body = (await response.json()) as { error: { code: number } }
		expect(body.error.code).toBe(-32700)
	})

	describe('initialize', () => {
		it('responds with server info and protocol version', async () => {
			const handler = createMCPHttpHandler({ name: 'my-server', version: '1.2.3', tools: [] })
			const response = await handler(
				makeRequest({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
			)

			expect(response.status).toBe(200)
			const body = (await response.json()) as {
				result: { serverInfo: { name: string; version: string }; protocolVersion: string }
			}
			expect(body.result.serverInfo.name).toBe('my-server')
			expect(body.result.serverInfo.version).toBe('1.2.3')
			expect(body.result.protocolVersion).toBe('2024-11-05')
		})
	})

	describe('tools/list', () => {
		it('returns the registered tools', async () => {
			const tool = makeTool('greet', 'Greets the user', 'Hello!')
			const handler = createMCPHttpHandler({ name: 'test', tools: [tool] })

			const response = await handler(makeRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' }))

			expect(response.status).toBe(200)
			const body = (await response.json()) as {
				result: { tools: Array<{ name: string; description: string }> }
			}
			expect(body.result.tools).toHaveLength(1)
			expect(body.result.tools[0].name).toBe('greet')
			expect(body.result.tools[0].description).toBe('Greets the user')
		})

		it('returns an empty tools array when no tools are registered', async () => {
			const handler = createMCPHttpHandler({ name: 'test', tools: [] })
			const response = await handler(makeRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' }))
			const body = (await response.json()) as { result: { tools: unknown[] } }
			expect(body.result.tools).toHaveLength(0)
		})
	})

	describe('tools/call', () => {
		it('executes the named tool and returns text content', async () => {
			// Tool returns a string — server passes it through verbatim
			const tool = makeTool('greet', 'Greets the user', 'Hello, world!')
			const handler = createMCPHttpHandler({ name: 'test', tools: [tool] })

			const response = await handler(
				makeRequest({
					jsonrpc: '2.0',
					id: 3,
					method: 'tools/call',
					params: { name: 'greet', arguments: { name: 'world' } },
				}),
			)

			expect(response.status).toBe(200)
			const body = (await response.json()) as {
				result: { content: Array<{ type: string; text: string }> }
			}
			expect(body.result.content[0].type).toBe('text')
			// String data is passed through without JSON.stringify
			expect(body.result.content[0].text).toBe('Hello, world!')
		})

		it('executes the named tool and JSON-stringifies non-string data', async () => {
			const tool = makeTool('info', 'Returns structured info', { status: 'ok', count: 3 })
			const handler = createMCPHttpHandler({ name: 'test', tools: [tool] })

			const response = await handler(
				makeRequest({
					jsonrpc: '2.0',
					id: 3,
					method: 'tools/call',
					params: { name: 'info', arguments: {} },
				}),
			)

			expect(response.status).toBe(200)
			const body = (await response.json()) as {
				result: { content: Array<{ type: string; text: string }> }
			}
			expect(body.result.content[0].type).toBe('text')
			expect(body.result.content[0].text).toBe('{\n  "status": "ok",\n  "count": 3\n}')
		})

		it('returns an error result for an unknown tool', async () => {
			const handler = createMCPHttpHandler({ name: 'test', tools: [] })

			const response = await handler(
				makeRequest({
					jsonrpc: '2.0',
					id: 4,
					method: 'tools/call',
					params: { name: 'nonexistent', arguments: {} },
				}),
			)

			expect(response.status).toBe(200)
			const body = (await response.json()) as { error: { code: number; message: string } }
			expect(body.error.code).toBe(-32602)
			expect(body.error.message).toMatch(/unknown tool/i)
		})
	})

	describe('notifications/initialized', () => {
		it('returns 204 with no body', async () => {
			const handler = createMCPHttpHandler({ name: 'test', tools: [] })
			const response = await handler(
				makeRequest({ jsonrpc: '2.0', method: 'notifications/initialized' }),
			)
			expect(response.status).toBe(204)
		})
	})

	describe('unknown methods', () => {
		it('returns a method-not-found error', async () => {
			const handler = createMCPHttpHandler({ name: 'test', tools: [] })
			const response = await handler(makeRequest({ jsonrpc: '2.0', id: 5, method: 'some/unknown' }))

			expect(response.status).toBe(200)
			const body = (await response.json()) as { error: { code: number } }
			expect(body.error.code).toBe(-32601)
		})
	})
})
