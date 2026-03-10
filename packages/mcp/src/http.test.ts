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

	describe('listResources', () => {
		it('returns the resources list from the server', async () => {
			const resourcesResponse = {
				jsonrpc: '2.0',
				id: 2,
				result: {
					resources: [
						{
							uri: 'file:///docs/readme.md',
							name: 'readme',
							description: 'Project README',
							mimeType: 'text/markdown',
						},
					],
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
				.mockResolvedValueOnce(makeMockResponse(resourcesResponse))

			const client = createMCPClient({
				name: 'test',
				transport: 'http',
				url: 'http://localhost:3000/mcp',
			})

			await client.connect()
			const resources = await client.listResources()

			expect(resources).toHaveLength(1)
			expect(resources[0].uri).toBe('file:///docs/readme.md')
			expect(resources[0].name).toBe('readme')
			expect(resources[0].description).toBe('Project README')
			expect(resources[0].mimeType).toBe('text/markdown')
		})
	})

	describe('readResource', () => {
		it('reads a resource by URI and returns contents', async () => {
			const readResponse = {
				jsonrpc: '2.0',
				id: 2,
				result: {
					contents: [
						{
							uri: 'file:///docs/readme.md',
							mimeType: 'text/markdown',
							text: '# Hello World',
						},
					],
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
				.mockResolvedValueOnce(makeMockResponse(readResponse))

			const client = createMCPClient({
				name: 'test',
				transport: 'http',
				url: 'http://localhost:3000/mcp',
			})

			await client.connect()
			const contents = await client.readResource('file:///docs/readme.md')

			expect(contents).toHaveLength(1)
			expect(contents[0].uri).toBe('file:///docs/readme.md')
			expect(contents[0].text).toBe('# Hello World')
			expect(contents[0].mimeType).toBe('text/markdown')
		})

		it('sends the correct JSON-RPC method and params', async () => {
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
						result: { contents: [] },
					}),
				)

			const client = createMCPClient({
				name: 'test',
				transport: 'http',
				url: 'http://localhost:3000/mcp',
			})

			await client.connect()
			await client.readResource('file:///test.txt')

			const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]
			const requestBody = JSON.parse(lastCall[1].body as string)
			expect(requestBody.method).toBe('resources/read')
			expect(requestBody.params.uri).toBe('file:///test.txt')
		})
	})

	describe('listPrompts', () => {
		it('returns the prompts list from the server', async () => {
			const promptsResponse = {
				jsonrpc: '2.0',
				id: 2,
				result: {
					prompts: [
						{
							name: 'summarize',
							description: 'Summarize text',
							arguments: [{ name: 'text', required: true }],
						},
					],
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
				.mockResolvedValueOnce(makeMockResponse(promptsResponse))

			const client = createMCPClient({
				name: 'test',
				transport: 'http',
				url: 'http://localhost:3000/mcp',
			})

			await client.connect()
			const prompts = await client.listPrompts()

			expect(prompts).toHaveLength(1)
			expect(prompts[0].name).toBe('summarize')
			expect(prompts[0].description).toBe('Summarize text')
			expect(prompts[0].arguments).toHaveLength(1)
			expect(prompts[0].arguments?.[0].name).toBe('text')
		})
	})

	describe('getPrompt', () => {
		it('gets a prompt by name with arguments', async () => {
			const promptResponse = {
				jsonrpc: '2.0',
				id: 2,
				result: {
					messages: [{ role: 'user', content: { type: 'text', text: 'Hello, Alice!' } }],
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
				.mockResolvedValueOnce(makeMockResponse(promptResponse))

			const client = createMCPClient({
				name: 'test',
				transport: 'http',
				url: 'http://localhost:3000/mcp',
			})

			await client.connect()
			const messages = await client.getPrompt('greet', { name: 'Alice' })

			expect(messages).toHaveLength(1)
			expect(messages[0].role).toBe('user')
			expect(messages[0].content.text).toBe('Hello, Alice!')
		})

		it('sends the correct JSON-RPC method and params with arguments', async () => {
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
						result: { messages: [] },
					}),
				)

			const client = createMCPClient({
				name: 'test',
				transport: 'http',
				url: 'http://localhost:3000/mcp',
			})

			await client.connect()
			await client.getPrompt('greet', { name: 'Bob' })

			const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]
			const requestBody = JSON.parse(lastCall[1].body as string)
			expect(requestBody.method).toBe('prompts/get')
			expect(requestBody.params.name).toBe('greet')
			expect(requestBody.params.arguments).toEqual({ name: 'Bob' })
		})

		it('sends prompts/get without arguments when none provided', async () => {
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
						result: { messages: [] },
					}),
				)

			const client = createMCPClient({
				name: 'test',
				transport: 'http',
				url: 'http://localhost:3000/mcp',
			})

			await client.connect()
			await client.getPrompt('simple')

			const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]
			const requestBody = JSON.parse(lastCall[1].body as string)
			expect(requestBody.method).toBe('prompts/get')
			expect(requestBody.params.name).toBe('simple')
			expect(requestBody.params.arguments).toBeUndefined()
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

	describe('resources/list', () => {
		it('returns registered resources', async () => {
			const handler = createMCPHttpHandler({
				name: 'test',
				tools: [],
				resources: [
					{
						uri: 'file:///docs/readme.md',
						name: 'readme',
						description: 'Project README',
						mimeType: 'text/markdown',
						async read() {
							return '# Hello'
						},
					},
					{
						uri: 'file:///config.json',
						name: 'config',
						mimeType: 'application/json',
						async read() {
							return '{"key": "value"}'
						},
					},
				],
			})

			const response = await handler(
				makeRequest({ jsonrpc: '2.0', id: 10, method: 'resources/list' }),
			)

			expect(response.status).toBe(200)
			const body = (await response.json()) as {
				result: {
					resources: Array<{
						uri: string
						name: string
						description?: string
						mimeType?: string
					}>
				}
			}
			expect(body.result.resources).toHaveLength(2)
			expect(body.result.resources[0].uri).toBe('file:///docs/readme.md')
			expect(body.result.resources[0].name).toBe('readme')
			expect(body.result.resources[0].description).toBe('Project README')
			expect(body.result.resources[0].mimeType).toBe('text/markdown')
			expect(body.result.resources[1].uri).toBe('file:///config.json')
			expect(body.result.resources[1].name).toBe('config')
		})

		it('returns an empty array when no resources are registered', async () => {
			const handler = createMCPHttpHandler({ name: 'test', tools: [] })
			const response = await handler(
				makeRequest({ jsonrpc: '2.0', id: 10, method: 'resources/list' }),
			)
			const body = (await response.json()) as { result: { resources: unknown[] } }
			expect(body.result.resources).toHaveLength(0)
		})
	})

	describe('resources/read', () => {
		it('reads a resource by URI and returns text content', async () => {
			const handler = createMCPHttpHandler({
				name: 'test',
				tools: [],
				resources: [
					{
						uri: 'file:///docs/readme.md',
						name: 'readme',
						mimeType: 'text/markdown',
						async read() {
							return '# Hello World'
						},
					},
				],
			})

			const response = await handler(
				makeRequest({
					jsonrpc: '2.0',
					id: 11,
					method: 'resources/read',
					params: { uri: 'file:///docs/readme.md' },
				}),
			)

			expect(response.status).toBe(200)
			const body = (await response.json()) as {
				result: {
					contents: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }>
				}
			}
			expect(body.result.contents).toHaveLength(1)
			expect(body.result.contents[0].uri).toBe('file:///docs/readme.md')
			expect(body.result.contents[0].mimeType).toBe('text/markdown')
			expect(body.result.contents[0].text).toBe('# Hello World')
		})

		it('reads a resource that returns an object with blob', async () => {
			const handler = createMCPHttpHandler({
				name: 'test',
				tools: [],
				resources: [
					{
						uri: 'file:///image.png',
						name: 'image',
						mimeType: 'image/png',
						async read() {
							return { blob: 'base64encodeddata' }
						},
					},
				],
			})

			const response = await handler(
				makeRequest({
					jsonrpc: '2.0',
					id: 12,
					method: 'resources/read',
					params: { uri: 'file:///image.png' },
				}),
			)

			expect(response.status).toBe(200)
			const body = (await response.json()) as {
				result: {
					contents: Array<{ uri: string; mimeType?: string; blob?: string }>
				}
			}
			expect(body.result.contents[0].blob).toBe('base64encodeddata')
			expect(body.result.contents[0].uri).toBe('file:///image.png')
		})

		it('returns an error for an unknown resource URI', async () => {
			const handler = createMCPHttpHandler({ name: 'test', tools: [] })

			const response = await handler(
				makeRequest({
					jsonrpc: '2.0',
					id: 13,
					method: 'resources/read',
					params: { uri: 'file:///nonexistent' },
				}),
			)

			expect(response.status).toBe(200)
			const body = (await response.json()) as { error: { code: number; message: string } }
			expect(body.error.code).toBe(-32602)
			expect(body.error.message).toMatch(/unknown resource/i)
		})
	})

	describe('prompts/list', () => {
		it('returns registered prompts', async () => {
			const handler = createMCPHttpHandler({
				name: 'test',
				tools: [],
				prompts: [
					{
						name: 'summarize',
						description: 'Summarize text',
						arguments: [
							{ name: 'text', description: 'Text to summarize', required: true },
							{ name: 'maxLength', description: 'Max output length' },
						],
						async get() {
							return [{ role: 'user', content: { type: 'text', text: 'Summarize this' } }]
						},
					},
				],
			})

			const response = await handler(
				makeRequest({ jsonrpc: '2.0', id: 20, method: 'prompts/list' }),
			)

			expect(response.status).toBe(200)
			const body = (await response.json()) as {
				result: {
					prompts: Array<{
						name: string
						description?: string
						arguments?: Array<{ name: string; description?: string; required?: boolean }>
					}>
				}
			}
			expect(body.result.prompts).toHaveLength(1)
			expect(body.result.prompts[0].name).toBe('summarize')
			expect(body.result.prompts[0].description).toBe('Summarize text')
			expect(body.result.prompts[0].arguments).toHaveLength(2)
			expect(body.result.prompts[0].arguments?.[0].name).toBe('text')
			expect(body.result.prompts[0].arguments?.[0].required).toBe(true)
		})

		it('returns an empty array when no prompts are registered', async () => {
			const handler = createMCPHttpHandler({ name: 'test', tools: [] })
			const response = await handler(
				makeRequest({ jsonrpc: '2.0', id: 20, method: 'prompts/list' }),
			)
			const body = (await response.json()) as { result: { prompts: unknown[] } }
			expect(body.result.prompts).toHaveLength(0)
		})
	})

	describe('prompts/get', () => {
		it('gets a prompt by name with arguments', async () => {
			const handler = createMCPHttpHandler({
				name: 'test',
				tools: [],
				prompts: [
					{
						name: 'greet',
						arguments: [{ name: 'name', required: true }],
						async get(args) {
							return [
								{
									role: 'user',
									content: { type: 'text', text: `Hello, ${args?.name ?? 'world'}!` },
								},
							]
						},
					},
				],
			})

			const response = await handler(
				makeRequest({
					jsonrpc: '2.0',
					id: 30,
					method: 'prompts/get',
					params: { name: 'greet', arguments: { name: 'Alice' } },
				}),
			)

			expect(response.status).toBe(200)
			const body = (await response.json()) as {
				result: {
					messages: Array<{ role: string; content: { type: string; text: string } }>
				}
			}
			expect(body.result.messages).toHaveLength(1)
			expect(body.result.messages[0].role).toBe('user')
			expect(body.result.messages[0].content.text).toBe('Hello, Alice!')
		})

		it('gets a prompt without arguments', async () => {
			const handler = createMCPHttpHandler({
				name: 'test',
				tools: [],
				prompts: [
					{
						name: 'default-prompt',
						async get() {
							return [{ role: 'user', content: { type: 'text', text: 'Default prompt text' } }]
						},
					},
				],
			})

			const response = await handler(
				makeRequest({
					jsonrpc: '2.0',
					id: 31,
					method: 'prompts/get',
					params: { name: 'default-prompt' },
				}),
			)

			expect(response.status).toBe(200)
			const body = (await response.json()) as {
				result: {
					messages: Array<{ role: string; content: { type: string; text: string } }>
				}
			}
			expect(body.result.messages).toHaveLength(1)
			expect(body.result.messages[0].content.text).toBe('Default prompt text')
		})

		it('returns an error for an unknown prompt', async () => {
			const handler = createMCPHttpHandler({ name: 'test', tools: [] })

			const response = await handler(
				makeRequest({
					jsonrpc: '2.0',
					id: 32,
					method: 'prompts/get',
					params: { name: 'nonexistent' },
				}),
			)

			expect(response.status).toBe(200)
			const body = (await response.json()) as { error: { code: number; message: string } }
			expect(body.error.code).toBe(-32602)
			expect(body.error.message).toMatch(/unknown prompt/i)
		})
	})

	describe('initialize capabilities', () => {
		it('includes tools capability when tools are registered', async () => {
			const tool = makeTool('greet', 'Greets', 'Hello')
			const handler = createMCPHttpHandler({ name: 'test', tools: [tool] })

			const response = await handler(
				makeRequest({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
			)

			const body = (await response.json()) as {
				result: { capabilities: Record<string, unknown> }
			}
			expect(body.result.capabilities).toHaveProperty('tools')
			expect(body.result.capabilities).not.toHaveProperty('resources')
			expect(body.result.capabilities).not.toHaveProperty('prompts')
		})

		it('includes resources capability when resources are registered', async () => {
			const handler = createMCPHttpHandler({
				name: 'test',
				tools: [],
				resources: [
					{
						uri: 'file:///test',
						name: 'test',
						async read() {
							return 'test'
						},
					},
				],
			})

			const response = await handler(
				makeRequest({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
			)

			const body = (await response.json()) as {
				result: { capabilities: Record<string, unknown> }
			}
			expect(body.result.capabilities).toHaveProperty('resources')
			expect(body.result.capabilities).not.toHaveProperty('tools')
			expect(body.result.capabilities).not.toHaveProperty('prompts')
		})

		it('includes prompts capability when prompts are registered', async () => {
			const handler = createMCPHttpHandler({
				name: 'test',
				tools: [],
				prompts: [
					{
						name: 'test-prompt',
						async get() {
							return [{ role: 'user', content: { type: 'text', text: 'hi' } }]
						},
					},
				],
			})

			const response = await handler(
				makeRequest({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
			)

			const body = (await response.json()) as {
				result: { capabilities: Record<string, unknown> }
			}
			expect(body.result.capabilities).toHaveProperty('prompts')
			expect(body.result.capabilities).not.toHaveProperty('tools')
			expect(body.result.capabilities).not.toHaveProperty('resources')
		})

		it('includes all capabilities when tools, resources, and prompts are registered', async () => {
			const tool = makeTool('greet', 'Greets', 'Hello')
			const handler = createMCPHttpHandler({
				name: 'test',
				tools: [tool],
				resources: [
					{
						uri: 'file:///test',
						name: 'test',
						async read() {
							return 'test'
						},
					},
				],
				prompts: [
					{
						name: 'test-prompt',
						async get() {
							return [{ role: 'user', content: { type: 'text', text: 'hi' } }]
						},
					},
				],
			})

			const response = await handler(
				makeRequest({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
			)

			const body = (await response.json()) as {
				result: { capabilities: Record<string, unknown> }
			}
			expect(body.result.capabilities).toHaveProperty('tools')
			expect(body.result.capabilities).toHaveProperty('resources')
			expect(body.result.capabilities).toHaveProperty('prompts')
		})

		it('has no capabilities when nothing is registered', async () => {
			const handler = createMCPHttpHandler({ name: 'test', tools: [] })

			const response = await handler(
				makeRequest({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
			)

			const body = (await response.json()) as {
				result: { capabilities: Record<string, unknown> }
			}
			expect(body.result.capabilities).toEqual({})
		})
	})
})
