import type { StreamEvent } from '@elsium-ai/core'
import { parseSSEStream } from './sse-parser'

export interface ClientConfig {
	baseUrl: string
	apiKey?: string
	timeout?: number
}

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

export interface CompleteResponse {
	id: string
	message: string
	model: string
	usage: { inputTokens: number; outputTokens: number; totalTokens: number }
	cost: { inputCost: number; outputCost: number; totalCost: number; currency: string }
	traceId: string
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

export interface AgentInfo {
	name: string
	model: string
	tools: string[]
}

export interface ElsiumClient {
	chat(req: ChatRequest): Promise<ChatResponse>
	chatStream(req: ChatRequest): AsyncIterable<StreamEvent>
	complete(req: CompleteRequest): Promise<CompleteResponse>
	completeStream(req: CompleteRequest): AsyncIterable<StreamEvent>
	health(): Promise<HealthResponse>
	metrics(): Promise<MetricsResponse>
	agents(): Promise<{ agents: AgentInfo[] }>
}

export function createClient(config: ClientConfig): ElsiumClient {
	const { baseUrl, apiKey, timeout = 30_000 } = config

	function headers(): Record<string, string> {
		const h: Record<string, string> = {
			'Content-Type': 'application/json',
		}
		if (apiKey) {
			h.Authorization = `Bearer ${apiKey}`
		}
		return h
	}

	async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), timeout)

		try {
			const response = await fetch(`${baseUrl}${path}`, {
				method,
				headers: headers(),
				body: body ? JSON.stringify(body) : undefined,
				signal: controller.signal,
			})

			if (!response.ok) {
				const errorBody = await response.text().catch(() => 'Unknown error')
				throw new Error(`HTTP ${response.status}: ${errorBody}`)
			}

			return (await response.json()) as T
		} finally {
			clearTimeout(timer)
		}
	}

	async function streamRequest(path: string, body: unknown): Promise<Response> {
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), timeout)

		try {
			const response = await fetch(`${baseUrl}${path}`, {
				method: 'POST',
				headers: headers(),
				body: JSON.stringify(body),
				signal: controller.signal,
			})

			if (!response.ok) {
				const errorBody = await response.text().catch(() => 'Unknown error')
				clearTimeout(timer)
				throw new Error(`HTTP ${response.status}: ${errorBody}`)
			}

			// Don't clear timer here — let it run for the streaming duration
			return response
		} catch (err) {
			clearTimeout(timer)
			throw err
		}
	}

	return {
		async chat(req: ChatRequest): Promise<ChatResponse> {
			return request<ChatResponse>('POST', '/chat', { ...req, stream: false })
		},

		async *chatStream(req: ChatRequest): AsyncIterable<StreamEvent> {
			const response = await streamRequest('/chat', { ...req, stream: true })
			yield* parseSSEStream(response)
		},

		async complete(req: CompleteRequest): Promise<CompleteResponse> {
			return request<CompleteResponse>('POST', '/complete', { ...req, stream: false })
		},

		async *completeStream(req: CompleteRequest): AsyncIterable<StreamEvent> {
			const response = await streamRequest('/complete', { ...req, stream: true })
			yield* parseSSEStream(response)
		},

		async health(): Promise<HealthResponse> {
			return request<HealthResponse>('GET', '/health')
		},

		async metrics(): Promise<MetricsResponse> {
			return request<MetricsResponse>('GET', '/metrics')
		},

		async agents(): Promise<{ agents: AgentInfo[] }> {
			return request<{ agents: AgentInfo[] }>('GET', '/agents')
		},
	}
}
