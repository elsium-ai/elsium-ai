import { createHash } from 'node:crypto'
import { ElsiumError } from '@elsium-ai/core'
import type { MCPClient, MCPClientConfig, MCPToolInfo } from './client'
import { createMCPClient } from './client'

export interface MCPTrustConfig {
	allowedServers?: AllowedServer[]
	validateToolOutputs?: boolean
	auditLog?: MCPAuditLogger
	maxToolOutputSize?: number
}

export interface AllowedServer {
	name: string
	transport: 'stdio' | 'http'
	commandHash?: string
	urlPattern?: string
	allowedTools?: string[]
	deniedTools?: string[]
}

export interface MCPAuditLogger {
	log(event: MCPAuditEvent): void
}

export interface MCPAuditEvent {
	type: 'connection' | 'tool_list' | 'tool_call' | 'tool_result' | 'security_violation'
	serverName: string
	timestamp: number
	data: Record<string, unknown>
}

export interface MCPToolManifest {
	serverName: string
	tools: MCPToolManifestEntry[]
	generatedAt: number
	hash: string
}

export interface MCPToolManifestEntry {
	name: string
	description: string
	inputSchemaHash: string
}

export interface TrustedMCPClient extends MCPClient {
	readonly manifest: MCPToolManifest | null
	generateManifest(): Promise<MCPToolManifest>
	verifyManifest(manifest: MCPToolManifest): Promise<boolean>
}

function computeSchemaHash(schema: Record<string, unknown>): string {
	return createHash('sha256').update(JSON.stringify(schema)).digest('hex')
}

function computeManifestHash(tools: MCPToolManifestEntry[]): string {
	const content = tools.map((t) => `${t.name}:${t.inputSchemaHash}`).join('|')
	return createHash('sha256').update(content).digest('hex')
}

function matchesServer(config: MCPClientConfig, s: AllowedServer): boolean {
	if (s.name !== config.name) return false
	if (s.transport !== config.transport) return false

	if (config.transport === 'http' && s.urlPattern) {
		if (!new RegExp(s.urlPattern).test(config.url)) return false
	}

	if (config.transport === 'stdio' && s.commandHash) {
		const cmdHash = createHash('sha256')
			.update(`${config.command}:${(config.args ?? []).join(':')}`)
			.digest('hex')
		if (cmdHash !== s.commandHash) return false
	}

	return true
}

function isServerAllowed(config: MCPClientConfig, trust: MCPTrustConfig): boolean {
	if (!trust.allowedServers?.length) return true
	return trust.allowedServers.some((s) => matchesServer(config, s))
}

function isToolAllowed(toolName: string, serverName: string, trust: MCPTrustConfig): boolean {
	if (!trust.allowedServers?.length) return true

	const server = trust.allowedServers.find((s) => s.name === serverName)
	if (!server) return false
	if (server.deniedTools?.includes(toolName)) return false
	if (server.allowedTools && !server.allowedTools.includes(toolName)) return false
	return true
}

const MAX_TOOL_OUTPUT_SIZE = 1024 * 1024

export function createTrustedMCPClient(
	config: MCPClientConfig,
	trustConfig: MCPTrustConfig,
): TrustedMCPClient {
	if (!isServerAllowed(config, trustConfig)) {
		throw new ElsiumError({
			code: 'AUTH_ERROR',
			message: `MCP server "${config.name}" is not in the allowed servers list`,
			retryable: false,
		})
	}

	const inner = createMCPClient(config)
	let currentManifest: MCPToolManifest | null = null
	const maxOutputSize = trustConfig.maxToolOutputSize ?? MAX_TOOL_OUTPUT_SIZE

	function audit(event: Omit<MCPAuditEvent, 'timestamp'>): void {
		trustConfig.auditLog?.log({ ...event, timestamp: Date.now() })
	}

	return {
		get connected() {
			return inner.connected
		},

		get manifest() {
			return currentManifest
		},

		async connect(): Promise<void> {
			audit({ type: 'connection', serverName: config.name, data: { action: 'connect' } })
			await inner.connect()
		},

		async disconnect(): Promise<void> {
			audit({ type: 'connection', serverName: config.name, data: { action: 'disconnect' } })
			await inner.disconnect()
		},

		async listTools(): Promise<MCPToolInfo[]> {
			const tools = await inner.listTools()

			const filteredTools = tools.filter((t) => isToolAllowed(t.name, config.name, trustConfig))

			audit({
				type: 'tool_list',
				serverName: config.name,
				data: {
					totalTools: tools.length,
					allowedTools: filteredTools.length,
					toolNames: filteredTools.map((t) => t.name),
				},
			})

			return filteredTools
		},

		async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
			if (!isToolAllowed(name, config.name, trustConfig)) {
				audit({
					type: 'security_violation',
					serverName: config.name,
					data: { tool: name, reason: 'Tool not allowed' },
				})
				throw new ElsiumError({
					code: 'AUTH_ERROR',
					message: `Tool "${name}" is not allowed on server "${config.name}"`,
					retryable: false,
				})
			}

			audit({
				type: 'tool_call',
				serverName: config.name,
				data: { tool: name, argumentKeys: Object.keys(args) },
			})

			const result = await inner.callTool(name, args)

			const resultStr = typeof result === 'string' ? result : JSON.stringify(result)
			if (resultStr.length > maxOutputSize) {
				audit({
					type: 'security_violation',
					serverName: config.name,
					data: { tool: name, reason: 'Output exceeds size limit', size: resultStr.length },
				})
				throw new ElsiumError({
					code: 'VALIDATION_ERROR',
					message: `Tool "${name}" output exceeds maximum size (${resultStr.length} > ${maxOutputSize})`,
					retryable: false,
				})
			}

			audit({
				type: 'tool_result',
				serverName: config.name,
				data: { tool: name, outputSize: resultStr.length },
			})

			return result
		},

		listResources: inner.listResources.bind(inner),
		readResource: inner.readResource.bind(inner),
		listPrompts: inner.listPrompts.bind(inner),
		getPrompt: inner.getPrompt.bind(inner),
		toElsiumTools: inner.toElsiumTools.bind(inner),

		async generateManifest(): Promise<MCPToolManifest> {
			const tools = await inner.listTools()
			const entries: MCPToolManifestEntry[] = tools.map((t) => ({
				name: t.name,
				description: t.description,
				inputSchemaHash: computeSchemaHash(t.inputSchema),
			}))

			currentManifest = {
				serverName: config.name,
				tools: entries,
				generatedAt: Date.now(),
				hash: computeManifestHash(entries),
			}

			return currentManifest
		},

		async verifyManifest(manifest: MCPToolManifest): Promise<boolean> {
			const tools = await inner.listTools()
			const currentEntries: MCPToolManifestEntry[] = tools.map((t) => ({
				name: t.name,
				description: t.description,
				inputSchemaHash: computeSchemaHash(t.inputSchema),
			}))
			const currentHash = computeManifestHash(currentEntries)

			if (currentHash !== manifest.hash) {
				audit({
					type: 'security_violation',
					serverName: config.name,
					data: {
						reason: 'Manifest mismatch',
						expectedHash: manifest.hash,
						actualHash: currentHash,
					},
				})
				return false
			}

			return true
		},
	}
}
