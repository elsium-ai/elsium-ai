import type { z } from 'zod'

// ─── Roles & Content ─────────────────────────────────────────────

export type Role = 'system' | 'user' | 'assistant' | 'tool'

export interface TextContent {
	type: 'text'
	text: string
}

export interface ImageContent {
	type: 'image'
	source: { type: 'base64'; mediaType: string; data: string } | { type: 'url'; url: string }
}

export type ContentPart = TextContent | ImageContent

// ─── Tool Calls ──────────────────────────────────────────────────

export interface ToolCall {
	id: string
	name: string
	arguments: Record<string, unknown>
}

export interface ToolResult {
	toolCallId: string
	content: string
	isError?: boolean
}

// ─── Messages ────────────────────────────────────────────────────

export interface Message {
	role: Role
	content: string | ContentPart[]
	name?: string
	toolCalls?: ToolCall[]
	toolResults?: ToolResult[]
	metadata?: Record<string, unknown>
}

// ─── Token Usage & Cost ──────────────────────────────────────────

export interface TokenUsage {
	inputTokens: number
	outputTokens: number
	totalTokens: number
	cacheReadTokens?: number
	cacheWriteTokens?: number
}

export interface CostBreakdown {
	inputCost: number
	outputCost: number
	totalCost: number
	currency: 'USD'
}

// ─── LLM Response ────────────────────────────────────────────────

export type StopReason = 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use'

export interface LLMResponse {
	id: string
	message: Message
	usage: TokenUsage
	cost: CostBreakdown
	model: string
	provider: string
	stopReason: StopReason
	latencyMs: number
	traceId: string
}

// ─── Streaming ───────────────────────────────────────────────────

export type StreamEvent =
	| { type: 'text_delta'; text: string }
	| { type: 'tool_call_start'; toolCall: { id: string; name: string } }
	| { type: 'tool_call_delta'; toolCallId: string; arguments: string }
	| { type: 'tool_call_end'; toolCallId: string }
	| { type: 'message_start'; id: string; model: string }
	| { type: 'message_end'; usage: TokenUsage; stopReason: StopReason }
	| { type: 'error'; error: Error }
	| { type: 'checkpoint'; checkpoint: StreamCheckpoint }
	| { type: 'recovery'; partialText: string; error: Error }

// ─── Provider Config ─────────────────────────────────────────────

export interface ProviderConfig {
	apiKey: string
	baseUrl?: string
	timeout?: number
	maxRetries?: number
}

export interface CompletionRequest {
	messages: Message[]
	model?: string
	system?: string
	maxTokens?: number
	temperature?: number
	seed?: number
	topP?: number
	stopSequences?: string[]
	tools?: ToolDefinition[]
	schema?: z.ZodType
	stream?: boolean
	metadata?: Record<string, unknown>
	signal?: AbortSignal
}

export interface ToolDefinition {
	name: string
	description: string
	inputSchema: Record<string, unknown>
}

// ─── X-Ray Data ─────────────────────────────────────────────────

export interface XRayData {
	traceId: string
	timestamp: number
	provider: string
	model: string
	latencyMs: number
	request: {
		url: string
		method: string
		headers: Record<string, string>
		body: Record<string, unknown>
	}
	response: {
		status: number
		headers: Record<string, string>
		body: Record<string, unknown>
	}
	usage: TokenUsage
	cost: CostBreakdown
}

// ─── Stream Checkpoint ──────────────────────────────────────────

export interface StreamCheckpoint {
	id: string
	timestamp: number
	text: string
	tokensSoFar: number
	eventIndex: number
}

// ─── Middleware ───────────────────────────────────────────────────

export interface MiddlewareContext {
	request: CompletionRequest
	provider: string
	model: string
	traceId: string
	startTime: number
	metadata: Record<string, unknown>
}

export type MiddlewareNext = (ctx: MiddlewareContext) => Promise<LLMResponse>

export type Middleware = (ctx: MiddlewareContext, next: MiddlewareNext) => Promise<LLMResponse>
