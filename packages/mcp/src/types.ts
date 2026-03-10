export interface JsonRpcRequest {
	jsonrpc: '2.0'
	id?: number
	method: string
	params?: Record<string, unknown>
}

export interface JsonRpcResponse {
	jsonrpc: '2.0'
	id: number
	result?: unknown
	error?: { code: number; message: string; data?: unknown }
}

export type MCPTransport = 'stdio' | 'http'

export interface MCPResource {
	uri: string
	name: string
	description?: string
	mimeType?: string
}

export interface MCPResourceContent {
	uri: string
	mimeType?: string
	text?: string
	blob?: string
}

export interface MCPPrompt {
	name: string
	description?: string
	arguments?: MCPPromptArgument[]
}

export interface MCPPromptArgument {
	name: string
	description?: string
	required?: boolean
}

export interface MCPPromptMessage {
	role: 'user' | 'assistant'
	content: { type: 'text'; text: string }
}
