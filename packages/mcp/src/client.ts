import { type ChildProcess, spawn } from 'node:child_process'
import type { ToolDefinition } from '@elsium-ai/core'
import { ElsiumError, generateId } from '@elsium-ai/core'
import type { Tool, ToolContext, ToolExecutionResult } from '@elsium-ai/tools'

export interface MCPClientConfig {
	name: string
	transport: 'stdio'
	command: string
	args?: string[]
	env?: Record<string, string>
	timeoutMs?: number
}

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
	readonly connected: boolean
}

export function createMCPClient(config: MCPClientConfig): MCPClient {
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

	function handleData(data: string) {
		buffer += data
		const lines = buffer.split('\n')
		buffer = lines.pop() ?? ''

		for (const line of lines) {
			if (!line.trim()) continue
			try {
				const response = JSON.parse(line) as JSONRPCResponse
				const pending = pendingRequests.get(response.id)
				if (pending) {
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
			} catch {
				// skip malformed JSON
			}
		}
	}

	return {
		get connected() {
			return connected
		},

		async connect(): Promise<void> {
			if (connected) return

			process = spawn(config.command, config.args ?? [], {
				stdio: ['pipe', 'pipe', 'pipe'],
				env: { ...globalThis.process?.env, ...config.env },
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

			process.on('exit', () => {
				connected = false
			})

			// Initialize MCP protocol
			await sendRequest('initialize', {
				protocolVersion: '2024-11-05',
				capabilities: {},
				clientInfo: { name: `elsium-mcp-${config.name}`, version: '0.1.0' },
			})

			await sendRequest('notifications/initialized')
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

		async toElsiumTools(): Promise<Tool[]> {
			const mcpTools = await this.listTools()
			const client = this

			return mcpTools.map((mcpTool) => {
				const tool: Tool = {
					name: mcpTool.name,
					description: mcpTool.description,
					inputSchema: { _def: { typeName: 'ZodObject' } } as never,
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
