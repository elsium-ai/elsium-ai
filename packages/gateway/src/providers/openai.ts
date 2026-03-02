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

const DEFAULT_BASE_URL = 'https://api.openai.com'
const DEFAULT_MAX_TOKENS = 4096

type OpenAIContentPart =
	| { type: 'text'; text: string }
	| { type: 'image_url'; image_url: { url: string } }

interface OpenAIMessage {
	role: 'system' | 'user' | 'assistant' | 'tool'
	content: string | OpenAIContentPart[] | null
	name?: string
	tool_calls?: OpenAIToolCall[]
	tool_call_id?: string
}

interface OpenAIToolCall {
	id: string
	type: 'function'
	function: { name: string; arguments: string }
}

interface OpenAITool {
	type: 'function'
	function: {
		name: string
		description: string
		parameters: Record<string, unknown>
	}
}

interface OpenAIResponse {
	id: string
	object: string
	model: string
	choices: Array<{
		index: number
		message: {
			role: string
			content: string | null
			tool_calls?: OpenAIToolCall[]
		}
		finish_reason: string
	}>
	usage: {
		prompt_tokens: number
		completion_tokens: number
		total_tokens: number
	}
}

export function createOpenAIProvider(config: ProviderConfig): LLMProvider {
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
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify(body),
			signal,
		})

		if (!response.ok) {
			const errorBody = await response.text().catch(() => 'Unknown error')

			if (response.status === 401) throw ElsiumError.authError('openai')
			if (response.status === 429) {
				const retryAfter = response.headers.get('retry-after')
				throw ElsiumError.rateLimit(
					'openai',
					retryAfter ? Number.parseInt(retryAfter) * 1000 : undefined,
				)
			}

			throw ElsiumError.providerError(`OpenAI API error ${response.status}: ${errorBody}`, {
				provider: 'openai',
				statusCode: response.status,
				retryable: response.status >= 500,
			})
		}

		return response
	}

	function extractTextContent(msg: Message): string {
		if (typeof msg.content === 'string') return msg.content
		return msg.content
			.filter((p) => p.type === 'text')
			.map((p) => (p as { text: string }).text)
			.join('\n')
	}

	function formatSystemMessage(msg: Message): OpenAIMessage {
		return { role: 'system', content: extractTextContent(msg) }
	}

	function formatToolMessages(msg: Message): OpenAIMessage[] {
		return (msg.toolResults ?? []).map((tr) => ({
			role: 'tool' as const,
			content: tr.content,
			tool_call_id: tr.toolCallId,
		}))
	}

	function formatAssistantMessage(msg: Message): OpenAIMessage {
		const content = extractTextContent(msg)
		const openaiMsg: OpenAIMessage = { role: 'assistant', content: content || null }

		if (msg.toolCalls?.length) {
			openaiMsg.tool_calls = msg.toolCalls.map((tc) => ({
				id: tc.id,
				type: 'function' as const,
				function: {
					name: tc.name,
					arguments: JSON.stringify(tc.arguments),
				},
			}))
		}

		return openaiMsg
	}

	function formatUserContent(msg: Message): string | OpenAIContentPart[] {
		if (typeof msg.content === 'string') return msg.content

		const parts: OpenAIContentPart[] = []
		for (const part of msg.content) {
			if (part.type === 'text') {
				parts.push({ type: 'text', text: part.text })
			} else if (part.type === 'image') {
				if (part.source.type === 'base64') {
					const url = `data:${part.source.mediaType};base64,${part.source.data}`
					parts.push({ type: 'image_url', image_url: { url } })
				} else {
					parts.push({ type: 'image_url', image_url: { url: part.source.url } })
				}
			}
		}
		return parts
	}

	function formatMessages(messages: Message[]): OpenAIMessage[] {
		const formatted: OpenAIMessage[] = []

		for (const msg of messages) {
			if (msg.role === 'system') {
				formatted.push(formatSystemMessage(msg))
				continue
			}

			if (msg.role === 'tool') {
				formatted.push(...formatToolMessages(msg))
				continue
			}

			if (msg.role === 'assistant') {
				formatted.push(formatAssistantMessage(msg))
				continue
			}

			// User message
			formatted.push({ role: 'user', content: formatUserContent(msg) })
		}

		return formatted
	}

	function formatTools(tools?: ToolDefinition[]): OpenAITool[] | undefined {
		if (!tools?.length) return undefined
		return tools.map((t) => ({
			type: 'function' as const,
			function: {
				name: t.name,
				description: t.description,
				parameters: t.inputSchema,
			},
		}))
	}

	function parseResponse(raw: OpenAIResponse, latencyMs: number): LLMResponse {
		const traceId = generateTraceId()
		const choice = raw.choices[0]

		const toolCalls: ToolCall[] = (choice?.message.tool_calls ?? []).map((tc) => {
			let args: Record<string, unknown> = {}
			try {
				args = JSON.parse(tc.function.arguments)
			} catch {
				args = { _raw: tc.function.arguments }
			}
			return { id: tc.id, name: tc.function.name, arguments: args }
		})

		const usage: TokenUsage = {
			inputTokens: raw.usage.prompt_tokens,
			outputTokens: raw.usage.completion_tokens,
			totalTokens: raw.usage.total_tokens,
		}

		const finishReason = choice?.finish_reason
		const stopReason =
			finishReason === 'stop'
				? 'end_turn'
				: finishReason === 'length'
					? 'max_tokens'
					: finishReason === 'tool_calls'
						? 'tool_use'
						: 'end_turn'

		return {
			id: raw.id,
			message: {
				role: 'assistant',
				content: choice?.message.content ?? '',
				toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
			},
			usage,
			cost: calculateCost(raw.model, usage),
			model: raw.model,
			provider: 'openai',
			stopReason: stopReason as LLMResponse['stopReason'],
			latencyMs,
			traceId,
		}
	}

	return {
		name: 'openai',
		defaultModel: 'gpt-4o',
		metadata: {
			baseUrl: 'https://api.openai.com/v1/chat/completions',
			capabilities: ['tools', 'vision', 'streaming', 'system', 'json_mode'],
			authStyle: 'bearer' as const,
		},

		async complete(req: CompletionRequest): Promise<LLMResponse> {
			const messages = formatMessages(req.messages)
			const model = req.model ?? 'gpt-4o'

			if (req.system) {
				messages.unshift({ role: 'system', content: req.system })
			}

			const body: Record<string, unknown> = {
				model,
				messages,
				max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
				...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
				...(req.seed !== undefined ? { seed: req.seed } : {}),
				...(req.topP !== undefined ? { top_p: req.topP } : {}),
				...(req.stopSequences?.length ? { stop: req.stopSequences } : {}),
			}

			const tools = formatTools(req.tools)
			if (tools) body.tools = tools

			const startTime = performance.now()

			const raw = await retry(
				async () => {
					const controller = new AbortController()
					const timer = setTimeout(() => controller.abort(), timeout)

					try {
						const signals = [controller.signal, req.signal].filter(Boolean) as AbortSignal[]
						const mergedSignal = signals.length > 1 ? AbortSignal.any(signals) : signals[0]
						const resp = await request('/chat/completions', body, mergedSignal)
						return (await resp.json()) as OpenAIResponse
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
			const messages = formatMessages(req.messages)
			const model = req.model ?? 'gpt-4o'

			if (req.system) {
				messages.unshift({ role: 'system', content: req.system })
			}

			const body: Record<string, unknown> = {
				model,
				messages,
				max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
				stream: true,
				stream_options: { include_usage: true },
				...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
				...(req.seed !== undefined ? { seed: req.seed } : {}),
				...(req.topP !== undefined ? { top_p: req.topP } : {}),
				...(req.stopSequences?.length ? { stop: req.stopSequences } : {}),
			}

			const tools = formatTools(req.tools)
			if (tools) body.tools = tools

			return createStream(async (emit) => {
				const controller = new AbortController()
				const timer = setTimeout(() => controller.abort(), timeout)

				try {
					const signals = [controller.signal, req.signal].filter(Boolean) as AbortSignal[]
					const mergedSignal = signals.length > 1 ? AbortSignal.any(signals) : signals[0]
					const resp = await request('/chat/completions', body, mergedSignal)

					if (!resp.body)
						throw new ElsiumError({
							code: 'STREAM_ERROR',
							message: 'Response body is null',
							provider: 'openai',
							retryable: false,
						})

					emit({ type: 'message_start', id: generateId('msg'), model })

					await processOpenAISSEStream(resp.body, emit)
				} finally {
					clearTimeout(timer)
				}
			})
		},

		async listModels(): Promise<string[]> {
			return ['gpt-4o', 'gpt-4o-mini', 'o1', 'o1-mini', 'o3-mini']
		},
	}
}

function emitOpenAIToolCallEvents(
	toolCalls: Array<{ id?: string; function?: { name?: string; arguments?: string } }>,
	emit: (event: StreamEvent) => void,
): void {
	for (const tc of toolCalls) {
		if (tc.function?.name) {
			emit({
				type: 'tool_call_start',
				toolCall: { id: tc.id ?? '', name: tc.function.name },
			})
		}
		if (tc.function?.arguments) {
			emit({
				type: 'tool_call_delta',
				toolCallId: tc.id ?? '',
				arguments: tc.function.arguments,
			})
		}
	}
}

interface OpenAISSEState {
	endEmitted: boolean
	usage: TokenUsage
}

function processOpenAISSEChunk(
	event: Record<string, unknown>,
	emit: (event: StreamEvent) => void,
	state: OpenAISSEState,
): void {
	// Parse usage from final chunk (stream_options: { include_usage: true })
	const eventUsage = event.usage as
		| { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
		| undefined
	if (eventUsage) {
		state.usage = {
			inputTokens: eventUsage.prompt_tokens ?? 0,
			outputTokens: eventUsage.completion_tokens ?? 0,
			totalTokens: eventUsage.total_tokens ?? 0,
		}
	}

	const delta = (
		event.choices as Array<{ delta?: Record<string, unknown>; finish_reason?: string }>
	)?.[0]?.delta

	if (delta?.content) {
		emit({ type: 'text_delta', text: delta.content as string })
	}

	if (delta?.tool_calls) {
		emitOpenAIToolCallEvents(
			delta.tool_calls as Array<{ id?: string; function?: { name?: string; arguments?: string } }>,
			emit,
		)
	}

	const finishReason = (event.choices as Array<{ finish_reason?: string }>)?.[0]?.finish_reason
	if (finishReason === 'tool_calls' && !state.endEmitted) {
		state.endEmitted = true
		emit({
			type: 'message_end',
			usage: state.usage,
			stopReason: 'tool_use',
		})
	}
}

function processOpenAISSELine(
	line: string,
	emit: (event: StreamEvent) => void,
	state: OpenAISSEState,
): void {
	if (!line.startsWith('data: ')) return
	const data = line.slice(6).trim()
	if (data === '[DONE]') {
		if (!state.endEmitted) {
			state.endEmitted = true
			emit({
				type: 'message_end',
				usage: state.usage,
				stopReason: 'end_turn',
			})
		}
		return
	}

	try {
		const event = JSON.parse(data)
		processOpenAISSEChunk(event, emit, state)
	} catch (err) {
		emit({ type: 'error', error: err instanceof Error ? err : new Error(String(err)) })
	}
}

async function processOpenAISSEStream(
	body: ReadableStream<Uint8Array>,
	emit: (event: StreamEvent) => void,
): Promise<void> {
	const reader = body.getReader()
	const decoder = new TextDecoder()
	let buffer = ''
	const state: OpenAISSEState = {
		endEmitted: false,
		usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
	}

	while (true) {
		const { done, value } = await reader.read()
		if (done) break

		buffer += decoder.decode(value, { stream: true })
		const lines = buffer.split('\n')
		buffer = lines.pop() ?? ''

		for (const line of lines) {
			processOpenAISSELine(line, emit, state)
		}
	}
}
