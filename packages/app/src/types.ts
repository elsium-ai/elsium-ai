import type { Agent } from '@elsium-ai/agents'
import type { RAGPipeline } from '@elsium-ai/rag'

export interface AppConfig {
	gateway: {
		providers: Record<string, { apiKey: string; baseUrl?: string; model?: string }>
		defaultModel?: string
		strategy?: 'fallback' | 'cost-optimized' | 'latency-optimized' | 'capability-aware'
	}
	agents?: Agent[]
	rag?: RAGPipeline
	observe?: {
		tracing?: boolean
		costTracking?: boolean
		export?: string
	}
	server?: ServerConfig
	version?: string
}

export interface ServerConfig {
	port?: number
	hostname?: string
	cors?: boolean | CorsConfig
	auth?: AuthConfig
	rateLimit?: RateLimitConfig
	gracefulShutdown?: boolean | { drainTimeoutMs?: number }
}

export interface CorsConfig {
	origin?: string | string[]
	methods?: string[]
	headers?: string[]
	credentials?: boolean
}

export interface AuthConfig {
	type: 'bearer'
	token: string
}

export interface RateLimitConfig {
	windowMs: number
	maxRequests: number
}

// ─── API Types ───────────────────────────────────────────────────

export interface ChatRequest {
	message: string
	agent?: string
	stream?: boolean
}

export interface ChatResponse {
	message: string
	usage: {
		inputTokens: number
		outputTokens: number
		totalTokens: number
		cost: number
	}
	model: string
	traceId: string
}

export interface CompleteRequest {
	messages: Array<{ role: string; content: string }>
	model?: string
	system?: string
	maxTokens?: number
	temperature?: number
	stream?: boolean
}

export interface HealthResponse {
	status: 'ok' | 'degraded'
	version: string
	uptime: number
	providers: string[]
}

export interface MetricsResponse {
	uptime: number
	totalRequests: number
	totalTokens: number
	totalCost: number
	byModel: Record<string, { requests: number; tokens: number; cost: number }>
}

// ─── Stream Types ────────────────────────────────────────────────

export interface StreamChatEvent {
	type: 'text_delta' | 'message_end' | 'error'
	text?: string
	usage?: { inputTokens: number; outputTokens: number; totalTokens: number }
	error?: string
}

export interface StreamCompleteEvent {
	type: 'text_delta' | 'tool_call_start' | 'tool_call_delta' | 'message_end' | 'error'
	text?: string
	toolCall?: { id: string; name: string }
	toolCallId?: string
	arguments?: string
	usage?: { inputTokens: number; outputTokens: number; totalTokens: number }
	error?: string
}
