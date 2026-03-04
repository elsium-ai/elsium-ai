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
	zodToJsonSchema,
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

	function extractSystemText(msg: Message): string {
		if (typeof msg.content === 'string') return msg.content
		return msg.content
			.filter((p) => p.type === 'text')
			.map((p) => (p as { text: string }).text)
			.join('\n')
	}

	function formatToolResultMessage(msg: Message): AnthropicMessage {
		const blocks: AnthropicContentBlock[] = (msg.toolResults ?? []).map((tr) => ({
			type: 'tool_result' as const,
			tool_use_id: tr.toolCallId,
			content: tr.content,
		}))
		return { role: 'user', content: blocks }
	}

	function formatStringContent(msg: Message, role: 'user' | 'assistant'): AnthropicMessage {
		const blocks: AnthropicContentBlock[] = []

		const text = msg.content as string
		if (text) {
			blocks.push({ type: 'text', text })
		}

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

		if (blocks.length === 0) {
			return { role, content: text }
		}

		return { role, content: blocks }
	}

	function convertContentPart(part: {
		type: string
		text?: string
		source?: { type: string; mediaType: string; data: string } | { type: 'url'; url: string }
	}): AnthropicContentBlock {
		if (part.type === 'text') return { type: 'text', text: part.text }
		if (part.type === 'image' && part.source?.type === 'base64') {
			const src = part.source as { type: 'base64'; mediaType: string; data: string }
			return {
				type: 'image',
				source: {
					type: 'base64',
					media_type: src.mediaType,
					data: src.data,
				},
			}
		}
		if (part.type === 'document' && part.source) {
			if (part.source.type === 'base64') {
				const src = part.source as { type: 'base64'; mediaType: string; data: string }
				return {
					type: 'document' as AnthropicContentBlock['type'],
					source: {
						type: 'base64',
						media_type: src.mediaType,
						data: src.data,
					},
				}
			}
			return { type: 'text', text: '[document: url source not supported by Anthropic]' }
		}
		if (part.type === 'audio') {
			return { type: 'text', text: '[audio content not supported by this provider]' }
		}
		return { type: 'text', text: '[unsupported content]' }
	}

	function formatMultipartContent(msg: Message, role: 'user' | 'assistant'): AnthropicMessage {
		const content = msg.content as Array<{
			type: string
			text?: string
			source?: { type: string; mediaType: string; data: string }
		}>
		const blocks: AnthropicContentBlock[] = content.map(convertContentPart)
		return { role, content: blocks }
	}

	function formatMessages(messages: Message[]): {
		system?: string
		messages: AnthropicMessage[]
	} {
		let system: string | undefined
		const formatted: AnthropicMessage[] = []

		for (const msg of messages) {
			if (msg.role === 'system') {
				system = extractSystemText(msg)
				continue
			}

			if (msg.role === 'tool') {
				formatted.push(formatToolResultMessage(msg))
				continue
			}

			const role = msg.role === 'assistant' ? 'assistant' : 'user'

			if (typeof msg.content === 'string') {
				formatted.push(formatStringContent(msg, role))
			} else {
				formatted.push(formatMultipartContent(msg, role))
			}
		}

		return { system, messages: formatted }
	}

	function buildSeedMetadata(req: CompletionRequest): Record<string, unknown> {
		if (req.seed === undefined) return {}
		return { metadata: { ...((req.metadata as Record<string, unknown>) ?? {}), seed: req.seed } }
	}

	function formatTools(tools?: ToolDefinition[]): AnthropicTool[] | undefined {
		if (!tools?.length) return undefined
		return tools.map((t) => ({
			name: t.name,
			description: t.description,
			input_schema: t.inputSchema,
		}))
	}

	function buildOptionalParams(req: CompletionRequest): Record<string, unknown> {
		const params: Record<string, unknown> = {}
		if (req.temperature !== undefined) params.temperature = req.temperature
		if (req.topP !== undefined) params.top_p = req.topP
		if (req.stopSequences?.length) params.stop_sequences = req.stopSequences
		return params
	}

	function applyStructuredOutput(
		body: Record<string, unknown>,
		req: CompletionRequest,
		tools: AnthropicTool[] | undefined,
	): void {
		if (!req.schema) return
		const jsonSchema = zodToJsonSchema(req.schema)
		const structuredTool: AnthropicTool = {
			name: '_structured_output',
			description: 'Return structured output matching the required schema',
			input_schema: jsonSchema,
		}
		body.tools = [...(tools ?? []), structuredTool]
		body.tool_choice = { type: 'tool', name: '_structured_output' }
	}

	function buildRequestBody(req: CompletionRequest): Record<string, unknown> {
		const { system, messages } = formatMessages(req.messages)
		const model = req.model ?? 'claude-sonnet-4-6'

		const body: Record<string, unknown> = {
			model,
			messages,
			max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
			...(system || req.system ? { system: req.system ?? system } : {}),
			...buildOptionalParams(req),
			...buildSeedMetadata(req),
		}

		const tools = formatTools(req.tools)
		if (tools) body.tools = tools
		applyStructuredOutput(body, req, tools)

		return body
	}

	function executeWithTimeout<T>(
		fn: (signal: AbortSignal) => Promise<T>,
		reqSignal?: AbortSignal,
	): Promise<T> {
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), timeout)

		const signals = [controller.signal, reqSignal].filter(Boolean) as AbortSignal[]
		const mergedSignal = signals.length > 1 ? AbortSignal.any(signals) : signals[0]

		return fn(mergedSignal).finally(() => clearTimeout(timer))
	}

	function extractContentBlocks(content: AnthropicContentBlock[]): {
		textParts: string[]
		toolCalls: ToolCall[]
	} {
		const toolCalls: ToolCall[] = []
		const textParts: string[] = []

		for (const block of content) {
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

		return { textParts, toolCalls }
	}

	function parseResponse(raw: AnthropicResponse, latencyMs: number): LLMResponse {
		const traceId = generateTraceId()
		const { textParts, toolCalls } = extractContentBlocks(raw.content)

		const usage: TokenUsage = {
			inputTokens: raw.usage.input_tokens,
			outputTokens: raw.usage.output_tokens,
			totalTokens: raw.usage.input_tokens + raw.usage.output_tokens,
			cacheReadTokens: raw.usage.cache_read_input_tokens,
			cacheWriteTokens: raw.usage.cache_creation_input_tokens,
		}

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
			stopReason: mapAnthropicStopReason(raw.stop_reason),
			latencyMs,
			traceId,
		}
	}

	return {
		name: 'anthropic',
		defaultModel: 'claude-sonnet-4-6',
		metadata: {
			baseUrl: 'https://api.anthropic.com/v1/messages',
			capabilities: ['tools', 'vision', 'streaming', 'system'],
			authStyle: 'x-api-key' as const,
		},

		async complete(req: CompletionRequest): Promise<LLMResponse> {
			const body = buildRequestBody(req)
			const startTime = performance.now()

			const raw = await retry(
				() =>
					executeWithTimeout(async (signal) => {
						const resp = await request('/messages', body, signal)
						return (await resp.json()) as AnthropicResponse
					}, req.signal),
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
			const body = buildRequestBody(req)
			body.stream = true
			const model = (body.model as string) ?? 'claude-sonnet-4-6'

			return createStream(async (emit) => {
				await executeWithTimeout(async (signal) => {
					const resp = await request('/messages', body, signal)

					if (!resp.body)
						throw new ElsiumError({
							code: 'STREAM_ERROR',
							message: 'Response body is null',
							provider: 'anthropic',
							retryable: false,
						})

					await processAnthropicSSEStream(resp.body, model, emit)
				}, req.signal)
			})
		},

		async listModels(): Promise<string[]> {
			return ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001']
		},
	}
}

function mapAnthropicStopReason(reason: string): LLMResponse['stopReason'] {
	if (reason === 'end_turn') return 'end_turn'
	if (reason === 'max_tokens') return 'max_tokens'
	if (reason === 'tool_use') return 'tool_use'
	return 'end_turn'
}

function processSSELine(line: string, model: string, emit: (event: StreamEvent) => void): void {
	if (!line.startsWith('data: ')) return
	const data = line.slice(6).trim()
	if (data === '[DONE]') return

	try {
		const event = JSON.parse(data)
		const mapped = mapSSEEvent(event, model)
		if (mapped) emit(mapped)
	} catch (err) {
		emit({ type: 'error', error: err instanceof Error ? err : new Error(String(err)) })
	}
}

async function processAnthropicSSEStream(
	body: ReadableStream<Uint8Array>,
	model: string,
	emit: (event: StreamEvent) => void,
): Promise<void> {
	const reader = body.getReader()
	const decoder = new TextDecoder()
	let buffer = ''

	while (true) {
		const { done, value } = await reader.read()
		if (done) break

		buffer += decoder.decode(value, { stream: true })
		const lines = buffer.split('\n')
		buffer = lines.pop() ?? ''

		for (const line of lines) {
			processSSELine(line, model, emit)
		}
	}
}

function mapSSEEventMessageStart(event: Record<string, unknown>, model: string): StreamEvent {
	const msg = event.message as { id: string } | undefined
	return {
		type: 'message_start',
		id: msg?.id ?? generateId('msg'),
		model,
	}
}

function mapSSEEventContentBlockStart(event: Record<string, unknown>): StreamEvent | null {
	const block = event.content_block as { type: string; id?: string; name?: string }
	if (block?.type === 'tool_use') {
		return {
			type: 'tool_call_start',
			toolCall: { id: block.id ?? '', name: block.name ?? '' },
		}
	}
	return null
}

function mapSSEEventContentBlockDelta(event: Record<string, unknown>): StreamEvent | null {
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

function mapSSEEventMessageDelta(event: Record<string, unknown>): StreamEvent | null {
	const delta = event.delta as { stop_reason?: string }
	const usage = event.usage as { input_tokens?: number; output_tokens?: number } | undefined
	if (!delta?.stop_reason) return null

	const inputTokens = usage?.input_tokens ?? 0
	const outputTokens = usage?.output_tokens ?? 0

	return {
		type: 'message_end',
		usage: {
			inputTokens,
			outputTokens,
			totalTokens: inputTokens + outputTokens,
		},
		stopReason: mapAnthropicStopReason(delta.stop_reason) as StreamEvent & {
			type: 'message_end'
		} extends {
			stopReason: infer R
		}
			? R
			: never,
	}
}

function mapSSEEvent(event: Record<string, unknown>, model: string): StreamEvent | null {
	switch (event.type) {
		case 'message_start':
			return mapSSEEventMessageStart(event, model)
		case 'content_block_start':
			return mapSSEEventContentBlockStart(event)
		case 'content_block_delta':
			return mapSSEEventContentBlockDelta(event)
		case 'content_block_stop':
			return null
		case 'message_delta':
			return mapSSEEventMessageDelta(event)
		default:
			return null
	}
}
