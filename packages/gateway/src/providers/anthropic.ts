import {
	type CompletionRequest,
	ElsiumError,
	type ElsiumStream,
	type LLMResponse,
	type Message,
	type ProviderConfig,
	type StreamEvent,
	type TokenUsage,
	type ToolCall,
	type ToolDefinition,
	createStream,
	generateId,
	generateTraceId,
	retry,
} from '@elsium-ai/core'
import { calculateCost } from '../pricing'
import type { LLMProvider } from '../provider'

const DEFAULT_BASE_URL = 'https://api.anthropic.com'
const API_VERSION = '2023-06-01'
const DEFAULT_MAX_TOKENS = 4096

interface AnthropicMessage {
	role: 'user' | 'assistant'
	content: string | AnthropicContentBlock[]
}

interface AnthropicContentBlock {
	type: 'text' | 'image' | 'tool_use' | 'tool_result'
	text?: string
	id?: string
	name?: string
	input?: Record<string, unknown>
	tool_use_id?: string
	content?: string
	source?: { type: string; media_type: string; data: string }
}

interface AnthropicTool {
	name: string
	description: string
	input_schema: Record<string, unknown>
}

interface AnthropicResponse {
	id: string
	type: string
	role: string
	content: AnthropicContentBlock[]
	model: string
	stop_reason: string
	usage: {
		input_tokens: number
		output_tokens: number
		cache_read_input_tokens?: number
		cache_creation_input_tokens?: number
	}
}

export function createAnthropicProvider(config: ProviderConfig): LLMProvider {
	const { apiKey, baseUrl = DEFAULT_BASE_URL, timeout = 60_000, maxRetries = 2 } = config

	async function request(
		path: string,
		body: Record<string, unknown>,
		signal?: AbortSignal,
	): Promise<Response> {
		const url = `${baseUrl}/v1${path}`

		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': apiKey,
				'anthropic-version': API_VERSION,
			},
			body: JSON.stringify(body),
			signal,
		})

		if (!response.ok) {
			const errorBody = await response.text().catch(() => 'Unknown error')

			if (response.status === 401) throw ElsiumError.authError('anthropic')
			if (response.status === 429) {
				const retryAfter = response.headers.get('retry-after')
				throw ElsiumError.rateLimit(
					'anthropic',
					retryAfter ? Number.parseInt(retryAfter) * 1000 : undefined,
				)
			}

			throw ElsiumError.providerError(`Anthropic API error ${response.status}: ${errorBody}`, {
				provider: 'anthropic',
				statusCode: response.status,
				retryable: response.status >= 500,
			})
		}

		return response
	}

	function formatMessages(messages: Message[]): {
		system?: string
		messages: AnthropicMessage[]
	} {
		let system: string | undefined
		const formatted: AnthropicMessage[] = []

		for (const msg of messages) {
			if (msg.role === 'system') {
				system =
					typeof msg.content === 'string'
						? msg.content
						: msg.content
								.filter((p) => p.type === 'text')
								.map((p) => (p as { text: string }).text)
								.join('\n')
				continue
			}

			if (msg.role === 'tool') {
				const blocks: AnthropicContentBlock[] = (msg.toolResults ?? []).map((tr) => ({
					type: 'tool_result' as const,
					tool_use_id: tr.toolCallId,
					content: tr.content,
				}))
				formatted.push({ role: 'user', content: blocks })
				continue
			}

			const role = msg.role === 'assistant' ? 'assistant' : 'user'

			if (typeof msg.content === 'string') {
				const blocks: AnthropicContentBlock[] = [{ type: 'text', text: msg.content }]

				if (msg.toolCalls?.length) {
					for (const tc of msg.toolCalls) {
						blocks.push({
							type: 'tool_use',
							id: tc.id,
							name: tc.name,
							input: tc.arguments,
						})
					}
				}

				formatted.push({ role, content: blocks })
			} else {
				const blocks: AnthropicContentBlock[] = msg.content.map((part) => {
					if (part.type === 'text') return { type: 'text', text: part.text }
					if (part.type === 'image' && part.source.type === 'base64') {
						return {
							type: 'image',
							source: {
								type: 'base64',
								media_type: part.source.mediaType,
								data: part.source.data,
							},
						}
					}
					return { type: 'text', text: '[unsupported content]' }
				})
				formatted.push({ role, content: blocks })
			}
		}

		return { system, messages: formatted }
	}

	function formatTools(tools?: ToolDefinition[]): AnthropicTool[] | undefined {
		if (!tools?.length) return undefined
		return tools.map((t) => ({
			name: t.name,
			description: t.description,
			input_schema: t.inputSchema,
		}))
	}

	function parseResponse(raw: AnthropicResponse, latencyMs: number): LLMResponse {
		const traceId = generateTraceId()

		const toolCalls: ToolCall[] = []
		const textParts: string[] = []

		for (const block of raw.content) {
			if (block.type === 'text' && block.text) {
				textParts.push(block.text)
			} else if (block.type === 'tool_use' && block.id && block.name) {
				toolCalls.push({
					id: block.id,
					name: block.name,
					arguments: (block.input as Record<string, unknown>) ?? {},
				})
			}
		}

		const usage: TokenUsage = {
			inputTokens: raw.usage.input_tokens,
			outputTokens: raw.usage.output_tokens,
			totalTokens: raw.usage.input_tokens + raw.usage.output_tokens,
			cacheReadTokens: raw.usage.cache_read_input_tokens,
			cacheWriteTokens: raw.usage.cache_creation_input_tokens,
		}

		const stopReason =
			raw.stop_reason === 'end_turn'
				? 'end_turn'
				: raw.stop_reason === 'max_tokens'
					? 'max_tokens'
					: raw.stop_reason === 'tool_use'
						? 'tool_use'
						: 'end_turn'

		return {
			id: raw.id,
			message: {
				role: 'assistant',
				content: textParts.join(''),
				toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
			},
			usage,
			cost: calculateCost(raw.model, usage),
			model: raw.model,
			provider: 'anthropic',
			stopReason: stopReason as LLMResponse['stopReason'],
			latencyMs,
			traceId,
		}
	}

	return {
		name: 'anthropic',
		defaultModel: 'claude-sonnet-4-6',

		async complete(req: CompletionRequest): Promise<LLMResponse> {
			const { system, messages } = formatMessages(req.messages)
			const model = req.model ?? 'claude-sonnet-4-6'

			const body: Record<string, unknown> = {
				model,
				messages,
				max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
				...(system || req.system ? { system: req.system ?? system } : {}),
				...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
				...(req.topP !== undefined ? { top_p: req.topP } : {}),
				...(req.stopSequences?.length ? { stop_sequences: req.stopSequences } : {}),
			}

			const tools = formatTools(req.tools)
			if (tools) body.tools = tools

			const startTime = performance.now()

			const raw = await retry(
				async () => {
					const controller = new AbortController()
					const timer = setTimeout(() => controller.abort(), timeout)

					try {
						const resp = await request('/messages', body, controller.signal)
						return (await resp.json()) as AnthropicResponse
					} finally {
						clearTimeout(timer)
					}
				},
				{
					maxRetries,
					baseDelayMs: 1000,
					shouldRetry: (e) => e instanceof ElsiumError && e.retryable,
				},
			)

			const latencyMs = Math.round(performance.now() - startTime)
			return parseResponse(raw, latencyMs)
		},

		stream(req: CompletionRequest): ElsiumStream {
			const { system, messages } = formatMessages(req.messages)
			const model = req.model ?? 'claude-sonnet-4-6'

			const body: Record<string, unknown> = {
				model,
				messages,
				max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
				stream: true,
				...(system || req.system ? { system: req.system ?? system } : {}),
				...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
				...(req.topP !== undefined ? { top_p: req.topP } : {}),
				...(req.stopSequences?.length ? { stop_sequences: req.stopSequences } : {}),
			}

			const tools = formatTools(req.tools)
			if (tools) body.tools = tools

			return createStream(async (emit) => {
				const controller = new AbortController()
				const timer = setTimeout(() => controller.abort(), timeout)

				try {
					const resp = await request('/messages', body, controller.signal)

					if (!resp.body)
						throw new ElsiumError({
							code: 'STREAM_ERROR',
							message: 'Response body is null',
							provider: 'anthropic',
							retryable: false,
						})

					const reader = resp.body.getReader()
					const decoder = new TextDecoder()
					let buffer = ''

					while (true) {
						const { done, value } = await reader.read()
						if (done) break

						buffer += decoder.decode(value, { stream: true })
						const lines = buffer.split('\n')
						buffer = lines.pop() ?? ''

						for (const line of lines) {
							if (!line.startsWith('data: ')) continue
							const data = line.slice(6).trim()
							if (data === '[DONE]') continue

							try {
								const event = JSON.parse(data)
								const mapped = mapSSEEvent(event, model)
								if (mapped) emit(mapped)
							} catch {
								// skip malformed JSON
							}
						}
					}
				} finally {
					clearTimeout(timer)
				}
			})
		},

		async listModels(): Promise<string[]> {
			return ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001']
		},
	}
}

function mapSSEEvent(event: Record<string, unknown>, model: string): StreamEvent | null {
	switch (event.type) {
		case 'message_start': {
			const msg = event.message as { id: string } | undefined
			return {
				type: 'message_start',
				id: msg?.id ?? generateId('msg'),
				model,
			}
		}
		case 'content_block_start': {
			const block = event.content_block as { type: string; id?: string; name?: string }
			if (block?.type === 'tool_use') {
				return {
					type: 'tool_call_start',
					toolCall: { id: block.id ?? '', name: block.name ?? '' },
				}
			}
			return null
		}
		case 'content_block_delta': {
			const delta = event.delta as { type: string; text?: string; partial_json?: string }
			if (delta?.type === 'text_delta' && delta.text) {
				return { type: 'text_delta', text: delta.text }
			}
			if (delta?.type === 'input_json_delta' && delta.partial_json) {
				return {
					type: 'tool_call_delta',
					toolCallId: '',
					arguments: delta.partial_json,
				}
			}
			return null
		}
		case 'content_block_stop': {
			return null
		}
		case 'message_delta': {
			const delta = event.delta as { stop_reason?: string }
			const usage = event.usage as { output_tokens?: number } | undefined
			if (delta?.stop_reason) {
				return {
					type: 'message_end',
					usage: {
						inputTokens: 0,
						outputTokens: usage?.output_tokens ?? 0,
						totalTokens: usage?.output_tokens ?? 0,
					},
					stopReason: (delta.stop_reason === 'end_turn'
						? 'end_turn'
						: delta.stop_reason === 'max_tokens'
							? 'max_tokens'
							: delta.stop_reason === 'tool_use'
								? 'tool_use'
								: 'end_turn') as StreamEvent & { type: 'message_end' } extends {
						stopReason: infer R
					}
						? R
						: never,
				}
			}
			return null
		}
		default:
			return null
	}
}
