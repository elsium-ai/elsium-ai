import { createLogger, generateId } from '@elsium-ai/core'
import type { Tool } from '@elsium-ai/tools'
import type { JsonRpcRequest, JsonRpcResponse } from './types'

const log = createLogger()

export interface MCPServerConfig {
	name: string
	version?: string
	tools: Tool[]
}

interface JSONRPCRequest {
	jsonrpc: '2.0'
	id?: number
	method: string
	params?: Record<string, unknown>
}

interface JSONRPCResponse {
	jsonrpc: '2.0'
	id: number
	result?: unknown
	error?: { code: number; message: string }
}

export interface MCPServer {
	start(): Promise<void>
	stop(): void
	readonly running: boolean
}

export function createMCPServer(config: MCPServerConfig): MCPServer {
	let running = false
	const toolMap = new Map(config.tools.map((t) => [t.name, t]))

	function handleRequest(request: JSONRPCRequest): JSONRPCResponse | null {
		const id = request.id ?? 0

		switch (request.method) {
			case 'initialize': {
				return {
					jsonrpc: '2.0',
					id,
					result: {
						protocolVersion: '2024-11-05',
						capabilities: { tools: {} },
						serverInfo: {
							name: config.name,
							version: config.version ?? '0.1.0',
						},
					},
				}
			}

			case 'notifications/initialized': {
				// No response needed for notifications
				return null
			}

			case 'tools/list': {
				const tools = config.tools.map((t) => {
					const def = t.toDefinition()
					return {
						name: def.name,
						description: def.description,
						inputSchema: def.inputSchema,
					}
				})
				return {
					jsonrpc: '2.0',
					id,
					result: { tools },
				}
			}

			case 'tools/call': {
				// This will be handled async
				return null
			}

			default: {
				return {
					jsonrpc: '2.0',
					id,
					error: {
						code: -32601,
						message: `Method not found: ${request.method}`,
					},
				}
			}
		}
	}

	async function handleToolCall(request: JSONRPCRequest): Promise<JSONRPCResponse> {
		const id = request.id ?? 0
		const name = request.params?.name as string
		const args = (request.params?.arguments ?? {}) as Record<string, unknown>

		const tool = toolMap.get(name)
		if (!tool) {
			return {
				jsonrpc: '2.0',
				id,
				error: {
					code: -32602,
					message: `Unknown tool: ${name}`,
				},
			}
		}

		const result = await tool.execute(args, { toolCallId: generateId('tc') })

		if (result.success) {
			return {
				jsonrpc: '2.0',
				id,
				result: {
					content: [
						{
							type: 'text',
							text:
								typeof result.data === 'string'
									? result.data
									: JSON.stringify(result.data, null, 2),
						},
					],
				},
			}
		}

		return {
			jsonrpc: '2.0',
			id,
			result: {
				content: [{ type: 'text', text: result.error ?? 'Tool execution failed' }],
				isError: true,
			},
		}
	}

	function writeLine(data: unknown) {
		process.stdout.write(`${JSON.stringify(data)}\n`)
	}

	async function processRequestLine(line: string) {
		if (!line.trim()) return

		let request: JSONRPCRequest
		try {
			request = JSON.parse(line) as JSONRPCRequest
		} catch {
			return // skip malformed input
		}

		if (request.method === 'tools/call') {
			const response = await handleToolCall(request)
			writeLine(response)
			return
		}

		const response = handleRequest(request)
		if (response) {
			writeLine(response)
		}
	}

	return {
		get running() {
			return running
		},

		async start(): Promise<void> {
			if (running) return
			running = true

			const MAX_BUFFER_SIZE = 1024 * 1024 // 1MB
			process.stdin.setEncoding('utf-8')
			let buffer = ''
			let processing = false
			const pendingChunks: string[] = []

			async function drainPendingChunks() {
				while (pendingChunks.length > 0) {
					const chunk = pendingChunks[0]
					pendingChunks.shift()
					buffer += chunk

					if (buffer.length > MAX_BUFFER_SIZE) {
						log.error('MCP server: buffer size limit exceeded, resetting')
						buffer = ''
						continue
					}

					const lines = buffer.split('\n')
					buffer = lines.pop() ?? ''

					for (const line of lines) {
						await processRequestLine(line)
					}
				}
			}

			async function processQueue() {
				if (processing) return
				processing = true
				try {
					await drainPendingChunks()
				} finally {
					processing = false
				}
			}

			process.stdin.on('data', (chunk: string) => {
				pendingChunks.push(chunk)
				processQueue()
			})

			process.stdin.on('end', () => {
				running = false
			})
		},

		stop() {
			running = false
		},
	}
}

// ─── HTTP Handler ────────────────────────────────────────────────

export interface MCPHttpHandlerConfig {
	name: string
	version?: string
	tools: Tool[]
}

export type MCPHttpHandler = (request: Request) => Promise<Response>

export function createMCPHttpHandler(config: MCPHttpHandlerConfig): MCPHttpHandler {
	const toolMap = new Map(config.tools.map((t) => [t.name, t]))

	function handleSyncRequest(request: JsonRpcRequest): JsonRpcResponse | null {
		const id = request.id ?? 0

		switch (request.method) {
			case 'initialize':
				return {
					jsonrpc: '2.0',
					id,
					result: {
						protocolVersion: '2024-11-05',
						capabilities: { tools: {} },
						serverInfo: {
							name: config.name,
							version: config.version ?? '0.1.0',
						},
					},
				}

			case 'notifications/initialized':
				return null

			case 'tools/list':
				return {
					jsonrpc: '2.0',
					id,
					result: {
						tools: config.tools.map((t) => {
							const def = t.toDefinition()
							return {
								name: def.name,
								description: def.description,
								inputSchema: def.inputSchema,
							}
						}),
					},
				}

			default:
				return {
					jsonrpc: '2.0',
					id,
					error: {
						code: -32601,
						message: `Method not found: ${request.method}`,
					},
				}
		}
	}

	async function handleToolCall(request: JsonRpcRequest): Promise<JsonRpcResponse> {
		const id = request.id ?? 0
		const name = request.params?.name as string
		const args = (request.params?.arguments ?? {}) as Record<string, unknown>

		const tool = toolMap.get(name)
		if (!tool) {
			return {
				jsonrpc: '2.0',
				id,
				error: { code: -32602, message: `Unknown tool: ${name}` },
			}
		}

		const result = await tool.execute(args, { toolCallId: generateId('tc') })

		if (result.success) {
			return {
				jsonrpc: '2.0',
				id,
				result: {
					content: [
						{
							type: 'text',
							text:
								typeof result.data === 'string'
									? result.data
									: JSON.stringify(result.data, null, 2),
						},
					],
				},
			}
		}

		return {
			jsonrpc: '2.0',
			id,
			result: {
				content: [{ type: 'text', text: result.error ?? 'Tool execution failed' }],
				isError: true,
			},
		}
	}

	return async (request: Request): Promise<Response> => {
		if (request.method !== 'POST') {
			return new Response(JSON.stringify({ error: 'Method not allowed' }), {
				status: 405,
				headers: { 'Content-Type': 'application/json' },
			})
		}

		let body: JsonRpcRequest
		try {
			body = (await request.json()) as JsonRpcRequest
		} catch {
			return new Response(
				JSON.stringify({ jsonrpc: '2.0', id: 0, error: { code: -32700, message: 'Parse error' } }),
				{ status: 400, headers: { 'Content-Type': 'application/json' } },
			)
		}

		let response: JsonRpcResponse | null

		if (body.method === 'tools/call') {
			response = await handleToolCall(body)
		} else {
			response = handleSyncRequest(body)
		}

		if (!response) {
			return new Response(null, { status: 204 })
		}

		return new Response(JSON.stringify(response), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		})
	}
}
