import type { Agent } from '@elsium-ai/agents'
import type { RAGPipeline } from '@elsium-ai/rag'
import type { ServerAdapter, ServerInstance } from './adapter'
import type { HonoServerInstance } from './hono/adapter'
import type { HonoServerConfig } from './hono/types'

/**
 * Defaults `S` to {@link HonoServerInstance} — matching `createApp`'s own
 * default — so that annotating a config object as `AppConfig` (with no
 * explicit type argument) doesn't erase the `.hono` property that the bare
 * {@link HonoServerConfig} shorthand actually produces at runtime.
 */
export interface AppConfig<S extends ServerInstance = HonoServerInstance> {
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
	/**
	 * Server adapter that owns the HTTP layer. Use `createServer({...})` (the
	 * built-in Hono adapter) or any other {@link ServerAdapter} implementation —
	 * a hand-rolled Express adapter, for instance, needs no knowledge of the
	 * Hono adapter's {@link HonoServerConfig} (or its `cors`/`auth`/`rateLimit`
	 * shapes) and can define its own config type entirely. A bare
	 * {@link HonoServerConfig} object is also accepted here and wrapped in the
	 * default Hono adapter, purely as a convenience for callers who don't need
	 * a different adapter.
	 */
	server?: ServerAdapter<S> | HonoServerConfig
	version?: string
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
