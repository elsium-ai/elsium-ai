import { type ChildProcess, spawn } from 'node:child_process'
import type { ToolDefinition } from '@elsium-ai/core'
import { ElsiumError, generateId } from '@elsium-ai/core'
import type { Tool, ToolContext, ToolExecutionResult } from '@elsium-ai/tools'
import type { MCPPrompt, MCPPromptMessage, MCPResource, MCPResourceContent } from './types'

export interface MCPClientStdioConfig {
	name: string
	transport: 'stdio'
	command: string
	args?: string[]
	env?: Record<string, string>
	timeoutMs?: number
}

export interface MCPClientHttpConfig {
	name: string
	transport: 'http'
	url: string
	headers?: Record<string, string>
	timeoutMs?: number
}

export type MCPClientConfig = MCPClientStdioConfig | MCPClientHttpConfig

export interface MCPToolInfo {
	name: string
	description: string
	inputSchema: Record<string, unknown>
}

interface JSONRPCRequest {
	jsonrpc: '2.0'
	id: number
	method: string
	params?: Record<string, unknown>
}

interface JSONRPCResponse {
	jsonrpc: '2.0'
	id: number
	result?: unknown
	error?: { code: number; message: string; data?: unknown }
}

export interface MCPClient {
	connect(): Promise<void>
	disconnect(): Promise<void>
	listTools(): Promise<MCPToolInfo[]>
	callTool(name: string, args: Record<string, unknown>): Promise<unknown>
	toElsiumTools(): Promise<Tool[]>
	listResources(): Promise<MCPResource[]>
	readResource(uri: string): Promise<MCPResourceContent[]>
	listPrompts(): Promise<MCPPrompt[]>
	getPrompt(name: string, args?: Record<string, string>): Promise<MCPPromptMessage[]>
	readonly connected: boolean
}

export function createMCPClient(config: MCPClientConfig): MCPClient {
	if (config.transport === 'http') {
		return createHttpMCPClient(config)
	}
	return createStdioMCPClient(config)
}

function assertConnected(connected: boolean): void {
	if (!connected) {
		throw new ElsiumError({
			code: 'NETWORK_ERROR',
			message: 'MCP HTTP client not connected',
			retryable: false,
		})
	}
}

function parseHttpResponse(json: {
	result?: unknown
	error?: { code: number; message: string }
}): unknown {
	if (json.error) {
		throw new ElsiumError({
			code: 'PROVIDER_ERROR',
			message: `MCP error: ${json.error.message}`,
			retryable: false,
			metadata: { code: json.error.code },
		})
	}
	return json.result
}

function handleFetchError(error: unknown, timeoutMs: number): never {
	if (error instanceof ElsiumError) throw error
	if (error instanceof Error && error.name === 'AbortError') {
		throw new ElsiumError({
			code: 'TIMEOUT',
			message: `MCP HTTP request timed out after ${timeoutMs}ms`,
			retryable: true,
		})
	}
	throw error
}

function createHttpMCPClient(config: MCPClientHttpConfig): MCPClient {
	let connected = false
	let requestId = 0
	const timeoutMs = config.timeoutMs ?? 30_000

	async function sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
		assertConnected(connected)

		const id = ++requestId
		const body = {
			jsonrpc: '2.0',
			id,
			method,
			...(params ? { params } : {}),
		}

		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), timeoutMs)

		try {
			const response = await fetch(config.url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...(config.headers ?? {}),
				},
				body: JSON.stringify(body),
				signal: controller.signal,
			})

			if (!response.ok) {
				throw new ElsiumError({
					code: 'PROVIDER_ERROR',
					message: `MCP HTTP error: ${response.status}`,
					retryable: response.status >= 500,
				})
			}

			const json = (await response.json()) as {
				result?: unknown
				error?: { code: number; message: string }
			}

			return parseHttpResponse(json)
		} catch (error) {
			handleFetchError(error, timeoutMs)
		} finally {
			clearTimeout(timer)
		}
	}

	return {
		get connected() {
			return connected
		},

		async connect(): Promise<void> {
			if (connected) return
			await sendRequest
				.call({ connected: true } as never, 'initialize', {
					protocolVersion: '2024-11-05',
					capabilities: {},
					clientInfo: { name: `elsium-mcp-${config.name}`, version: '0.1.0' },
				})
				.catch(() => {
					// Initialize may fail, that's ok - set connected for retry
				})
			connected = true
			// Re-initialize now that connected flag is set
			await sendRequest('initialize', {
				protocolVersion: '2024-11-05',
				capabilities: {},
				clientInfo: { name: `elsium-mcp-${config.name}`, version: '0.1.0' },
			})
		},

		async disconnect(): Promise<void> {
			connected = false
		},

		async listTools(): Promise<MCPToolInfo[]> {
			const result = (await sendRequest('tools/list')) as {
				tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>
			}
			return result.tools ?? []
		},

		async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
			const result = (await sendRequest('tools/call', { name, arguments: args })) as {
				content: Array<{ type: string; text?: string }>
			}
			const textContent = result.content
				?.filter((c) => c.type === 'text')
				.map((c) => c.text)
				.join('\n')
			return textContent ?? result
		},

		async listResources(): Promise<MCPResource[]> {
			const result = (await sendRequest('resources/list')) as { resources: MCPResource[] }
			return result.resources ?? []
		},

		async readResource(uri: string): Promise<MCPResourceContent[]> {
			const result = (await sendRequest('resources/read', { uri })) as {
				contents: MCPResourceContent[]
			}
			return result.contents ?? []
		},

		async listPrompts(): Promise<MCPPrompt[]> {
			const result = (await sendRequest('prompts/list')) as { prompts: MCPPrompt[] }
			return result.prompts ?? []
		},

		async getPrompt(name: string, args?: Record<string, string>): Promise<MCPPromptMessage[]> {
			const params: Record<string, unknown> = { name }
			if (args) params.arguments = args
			const result = (await sendRequest('prompts/get', params)) as {
				messages: MCPPromptMessage[]
			}
			return result.messages ?? []
		},

		async toElsiumTools(): Promise<Tool[]> {
			const mcpTools = await this.listTools()
			const client = this

			return mcpTools.map((mcpTool) => {
				const tool: Tool = {
					name: mcpTool.name,
					description: mcpTool.description,
					inputSchema: { _def: { typeName: 'ZodObject' } } as never,
					rawSchema: mcpTool.inputSchema,
					timeoutMs,

					async execute(
						input: unknown,
						partialCtx?: Partial<ToolContext>,
					): Promise<ToolExecutionResult> {
						const toolCallId = partialCtx?.toolCallId ?? generateId('tc')
						const startTime = performance.now()

						try {
							const result = await client.callTool(
								mcpTool.name,
								(input as Record<string, unknown>) ?? {},
							)
							return {
								success: true,
								data: result,
								toolCallId,
								durationMs: Math.round(performance.now() - startTime),
							}
						} catch (error) {
							return {
								success: false,
								error: error instanceof Error ? error.message : String(error),
								toolCallId,
								durationMs: Math.round(performance.now() - startTime),
							}
						}
					},

					toDefinition(): ToolDefinition {
						return {
							name: mcpTool.name,
							description: mcpTool.description,
							inputSchema: mcpTool.inputSchema,
						}
					},
				}

				return tool
			})
		},
	}
}

function createStdioMCPClient(config: MCPClientStdioConfig): MCPClient {
	let process: ChildProcess | null = null
	let connected = false
	let requestId = 0
	const pendingRequests = new Map<
		number,
		{
			resolve: (value: unknown) => void
			reject: (error: Error) => void
		}
	>()
	let buffer = ''
	const timeoutMs = config.timeoutMs ?? 30_000

	function sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
		if (!process?.stdin) {
			return Promise.reject(
				new ElsiumError({
					code: 'NETWORK_ERROR',
					message: 'MCP client not connected',
					retryable: false,
				}),
			)
		}

		const id = ++requestId
		const request: JSONRPCRequest = {
			jsonrpc: '2.0',
			id,
			method,
			...(params ? { params } : {}),
		}

		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				pendingRequests.delete(id)
				reject(
					new ElsiumError({
						code: 'TIMEOUT',
						message: `MCP request timed out after ${timeoutMs}ms`,
						retryable: true,
					}),
				)
			}, timeoutMs)

			pendingRequests.set(id, {
				resolve: (value) => {
					clearTimeout(timer)
					resolve(value)
				},
				reject: (error) => {
					clearTimeout(timer)
					reject(error)
				},
			})

			const proc = process
			if (proc?.stdin) {
				proc.stdin.write(`${JSON.stringify(request)}\n`)
			}
		})
	}

	function sendNotification(method: string, params?: Record<string, unknown>): void {
		const proc = process
		if (!proc?.stdin) return

		const notification = {
			jsonrpc: '2.0',
			method,
			...(params ? { params } : {}),
		}
		proc.stdin.write(`${JSON.stringify(notification)}\n`)
	}

	const MAX_LINE_LENGTH = 1024 * 1024 // 1MB max line length

	function processResponseLine(line: string) {
		if (!line.trim()) return

		let response: JSONRPCResponse
		try {
			response = JSON.parse(line) as JSONRPCResponse
		} catch {
			return // skip malformed JSON
		}

		const pending = pendingRequests.get(response.id)
		if (!pending) return

		pendingRequests.delete(response.id)
		if (response.error) {
			pending.reject(
				new ElsiumError({
					code: 'PROVIDER_ERROR',
					message: `MCP error: ${response.error.message}`,
					retryable: false,
					metadata: { code: response.error.code },
				}),
			)
		} else {
			pending.resolve(response.result)
		}
	}

	function handleData(data: string) {
		buffer += data
		if (buffer.length > MAX_LINE_LENGTH) {
			buffer = ''
			return // Drop oversized lines to prevent memory exhaustion
		}
		const lines = buffer.split('\n')
		buffer = lines.pop() ?? ''

		for (const line of lines) {
			processResponseLine(line)
		}
	}

	return {
		get connected() {
			return connected
		},

		async connect(): Promise<void> {
			if (connected) return

			const childEnv: Record<string, string> = {
				PATH: globalThis.process?.env?.PATH ?? '',
				HOME: globalThis.process?.env?.HOME ?? '',
				...(config.env ?? {}),
			}

			process = spawn(config.command, config.args ?? [], {
				stdio: ['pipe', 'pipe', 'pipe'],
				env: childEnv,
			})

			process.stdout?.setEncoding('utf-8')
			process.stdout?.on('data', handleData)

			process.on('error', (err) => {
				connected = false
				for (const [, pending] of pendingRequests) {
					pending.reject(err)
				}
				pendingRequests.clear()
			})

			process.on('exit', (code) => {
				connected = false
				if (pendingRequests.size > 0) {
					const err = new Error(`MCP subprocess exited with code ${code}`)
					for (const [, pending] of pendingRequests) {
						pending.reject(err)
					}
					pendingRequests.clear()
				}
			})

			// Initialize MCP protocol
			await sendRequest('initialize', {
				protocolVersion: '2024-11-05',
				capabilities: {},
				clientInfo: { name: `elsium-mcp-${config.name}`, version: '0.1.0' },
			})

			// Send as notification (no id, no response expected per JSON-RPC 2.0)
			sendNotification('notifications/initialized')
			connected = true
		},

		async disconnect(): Promise<void> {
			if (!connected || !process) return

			try {
				process.stdin?.end()
				process.kill()
			} catch {
				// ignore cleanup errors
			}

			connected = false
			process = null
			for (const [, { reject }] of pendingRequests) {
				reject(new Error('MCP client disconnected'))
			}
			pendingRequests.clear()
		},

		async listTools(): Promise<MCPToolInfo[]> {
			const result = (await sendRequest('tools/list')) as {
				tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>
			}
			return result.tools ?? []
		},

		async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
			const result = (await sendRequest('tools/call', { name, arguments: args })) as {
				content: Array<{ type: string; text?: string }>
			}

			const textContent = result.content
				?.filter((c) => c.type === 'text')
				.map((c) => c.text)
				.join('\n')

			return textContent ?? result
		},

		async listResources(): Promise<MCPResource[]> {
			const result = (await sendRequest('resources/list')) as { resources: MCPResource[] }
			return result.resources ?? []
		},

		async readResource(uri: string): Promise<MCPResourceContent[]> {
			const result = (await sendRequest('resources/read', { uri })) as {
				contents: MCPResourceContent[]
			}
			return result.contents ?? []
		},

		async listPrompts(): Promise<MCPPrompt[]> {
			const result = (await sendRequest('prompts/list')) as { prompts: MCPPrompt[] }
			return result.prompts ?? []
		},

		async getPrompt(name: string, args?: Record<string, string>): Promise<MCPPromptMessage[]> {
			const params: Record<string, unknown> = { name }
			if (args) params.arguments = args
			const result = (await sendRequest('prompts/get', params)) as {
				messages: MCPPromptMessage[]
			}
			return result.messages ?? []
		},

		async toElsiumTools(): Promise<Tool[]> {
			const mcpTools = await this.listTools()
			const client = this

			return mcpTools.map((mcpTool) => {
				const tool: Tool = {
					name: mcpTool.name,
					description: mcpTool.description,
					inputSchema: { _def: { typeName: 'ZodObject' } } as never,
					rawSchema: mcpTool.inputSchema,
					timeoutMs,

					async execute(
						input: unknown,
						partialCtx?: Partial<ToolContext>,
					): Promise<ToolExecutionResult> {
						const toolCallId = partialCtx?.toolCallId ?? generateId('tc')
						const startTime = performance.now()

						try {
							const result = await client.callTool(
								mcpTool.name,
								(input as Record<string, unknown>) ?? {},
							)
							return {
								success: true,
								data: result,
								toolCallId,
								durationMs: Math.round(performance.now() - startTime),
							}
						} catch (error) {
							return {
								success: false,
								error: error instanceof Error ? error.message : String(error),
								toolCallId,
								durationMs: Math.round(performance.now() - startTime),
							}
						}
					},

					toDefinition(): ToolDefinition {
						return {
							name: mcpTool.name,
							description: mcpTool.description,
							inputSchema: mcpTool.inputSchema,
						}
					},
				}

				return tool
			})
		},
	}
}
