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
