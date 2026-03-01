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

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com'

interface GeminiContent {
	role: 'user' | 'model'
	parts: GeminiPart[]
}

interface GeminiPart {
	text?: string
	functionCall?: { name: string; args: Record<string, unknown> }
	functionResponse?: { name: string; response: { content: string } }
}

interface GeminiTool {
	functionDeclarations: Array<{
		name: string
		description: string
		parameters: Record<string, unknown>
	}>
}

interface GeminiResponse {
	candidates: Array<{
		content: { role: string; parts: GeminiPart[] }
		finishReason: string
	}>
	usageMetadata: {
		promptTokenCount: number
		candidatesTokenCount: number
		totalTokenCount: number
	}
}

export function createGoogleProvider(config: ProviderConfig): LLMProvider {
	const { apiKey, baseUrl = DEFAULT_BASE_URL, timeout = 60_000, maxRetries = 2 } = config

	function extractGeminiSystemText(msg: Message): string {
		if (typeof msg.content === 'string') return msg.content
		return msg.content
			.filter((p) => p.type === 'text')
			.map((p) => (p as { text: string }).text)
			.join('\n')
	}

	function formatToolResultContents(msg: Message): GeminiContent[] {
		const results: GeminiContent[] = []
		for (const tr of msg.toolResults ?? []) {
			// Use toolCallId as name fallback; Gemini expects the function name, not the call ID
			const name = (tr as { toolName?: string }).toolName ?? tr.toolCallId
			results.push({
				role: 'user',
				parts: [
					{
						functionResponse: {
							name,
							response: { content: tr.content },
						},
					},
				],
			})
		}
		return results
	}

	function formatGeminiStringContent(msg: Message, role: 'user' | 'model'): GeminiContent {
		const parts: GeminiPart[] = [{ text: msg.content as string }]

		if (msg.toolCalls?.length) {
			for (const tc of msg.toolCalls) {
				parts.push({
					functionCall: { name: tc.name, args: tc.arguments },
				})
			}
		}

		return { role, parts }
	}

	function formatGeminiMultipartContent(msg: Message, role: 'user' | 'model'): GeminiContent {
		const parts: GeminiPart[] = (msg.content as Array<{ type: string; text?: string }>)
			.filter((p) => p.type === 'text')
			.map((p) => ({ text: (p as { text: string }).text }))
		return { role, parts }
	}

	function formatMessages(messages: Message[]): {
		systemInstruction?: { parts: GeminiPart[] }
		contents: GeminiContent[]
	} {
		let systemInstruction: { parts: GeminiPart[] } | undefined
		const contents: GeminiContent[] = []

		for (const msg of messages) {
			if (msg.role === 'system') {
				systemInstruction = { parts: [{ text: extractGeminiSystemText(msg) }] }
				continue
			}

			if (msg.role === 'tool') {
				contents.push(...formatToolResultContents(msg))
				continue
			}

			const role = msg.role === 'assistant' ? 'model' : 'user'

			if (typeof msg.content === 'string') {
				contents.push(formatGeminiStringContent(msg, role))
			} else {
				contents.push(formatGeminiMultipartContent(msg, role))
			}
		}

		return { systemInstruction, contents }
	}

	function formatTools(tools?: ToolDefinition[]): GeminiTool[] | undefined {
		if (!tools?.length) return undefined
		return [
			{
				functionDeclarations: tools.map((t) => ({
					name: t.name,
					description: t.description,
					parameters: t.inputSchema,
				})),
			},
		]
	}

	function extractGeminiParts(parts: GeminiPart[]): {
		textParts: string[]
		toolCalls: ToolCall[]
	} {
		const toolCalls: ToolCall[] = []
		const textParts: string[] = []

		for (const part of parts) {
			if (part.text) {
				textParts.push(part.text)
			}
			if (part.functionCall) {
				toolCalls.push({
					id: generateId('tc'),
					name: part.functionCall.name,
					arguments: part.functionCall.args ?? {},
				})
			}
		}

		return { textParts, toolCalls }
	}

	function parseResponse(raw: GeminiResponse, model: string, latencyMs: number): LLMResponse {
		const traceId = generateTraceId()
		const candidate = raw.candidates?.[0]
		const parts = candidate?.content?.parts ?? []
		const { textParts, toolCalls } = extractGeminiParts(parts)

		const usage: TokenUsage = {
			inputTokens: raw.usageMetadata?.promptTokenCount ?? 0,
			outputTokens: raw.usageMetadata?.candidatesTokenCount ?? 0,
			totalTokens: raw.usageMetadata?.totalTokenCount ?? 0,
		}

		return {
			id: generateId('msg'),
			message: {
				role: 'assistant',
				content: textParts.join(''),
				toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
			},
			usage,
			cost: calculateCost(model, usage),
			model,
			provider: 'google',
			stopReason: mapGeminiStopReason(candidate?.finishReason, toolCalls.length > 0),
			latencyMs,
			traceId,
		}
	}

	function resolveSystemInstruction(
		reqSystem: string | undefined,
		parsed: { parts: GeminiPart[] } | undefined,
	): { parts: GeminiPart[] } | undefined {
		if (reqSystem) return { parts: [{ text: reqSystem }] }
		return parsed
	}

	function buildGenerationConfig(req: CompletionRequest): Record<string, unknown> {
		const config: Record<string, unknown> = {
			maxOutputTokens: req.maxTokens ?? 4096,
		}
		if (req.temperature !== undefined) config.temperature = req.temperature
		if (req.seed !== undefined) config.seed = req.seed
		if (req.topP !== undefined) config.topP = req.topP
		if (req.stopSequences?.length) config.stopSequences = req.stopSequences
		return config
	}

	function buildRequestBody(req: CompletionRequest): Record<string, unknown> {
		const { systemInstruction, contents } = formatMessages(req.messages)
		const resolved = resolveSystemInstruction(req.system, systemInstruction)

		const body: Record<string, unknown> = {
			contents,
			generationConfig: buildGenerationConfig(req),
		}
		if (resolved) body.systemInstruction = resolved

		const tools = formatTools(req.tools)
		if (tools) body.tools = tools

		return body
	}

	return {
		name: 'google',
		defaultModel: 'gemini-2.0-flash',

		async complete(req: CompletionRequest): Promise<LLMResponse> {
			const model = req.model ?? 'gemini-2.0-flash'
			const body = buildRequestBody(req)

			const startTime = performance.now()

			const raw = await retry(
				() => googleRequest(baseUrl, model, apiKey, body, timeout, req.signal),
				{
					maxRetries,
					baseDelayMs: 1000,
					shouldRetry: (e) => e instanceof ElsiumError && e.retryable,
				},
			)

			const latencyMs = Math.round(performance.now() - startTime)
			return parseResponse(raw, model, latencyMs)
		},

		stream(req: CompletionRequest): ElsiumStream {
			const model = req.model ?? 'gemini-2.0-flash'
			const body = buildRequestBody(req)

			return createStream(async (emit) => {
				const controller = new AbortController()
				const timer = setTimeout(() => controller.abort(), timeout)

				try {
					const signals = [controller.signal, req.signal].filter(Boolean) as AbortSignal[]
					const mergedSignal = signals.length > 1 ? AbortSignal.any(signals) : signals[0]
					const response = await fetchGoogleStream(baseUrl, model, apiKey, body, mergedSignal)

					emit({ type: 'message_start', id: generateId('msg'), model })

					await processGeminiSSEStream(response.body as ReadableStream<Uint8Array>, emit)
				} finally {
					clearTimeout(timer)
				}
			})
		},

		async listModels(): Promise<string[]> {
			return [
				'gemini-2.0-flash',
				'gemini-2.0-flash-lite',
				'gemini-2.5-pro-preview-05-06',
				'gemini-2.5-flash-preview-04-17',
			]
		},
	}
}

function mapGeminiStopReason(
	finishReason: string | undefined,
	hasToolCalls = false,
): LLMResponse['stopReason'] {
	if (finishReason === 'STOP') return 'end_turn'
	if (finishReason === 'MAX_TOKENS') return 'max_tokens'
	if (finishReason === 'TOOL_CALLS' || hasToolCalls) return 'tool_use'
	return 'end_turn'
}

async function handleGoogleErrorResponse(response: Response): Promise<never> {
	const errorBody = await response.text().catch(() => 'Unknown error')

	if (response.status === 401 || response.status === 403) {
		throw ElsiumError.authError('google')
	}
	if (response.status === 429) {
		throw ElsiumError.rateLimit('google')
	}

	throw ElsiumError.providerError(`Google API error ${response.status}: ${errorBody}`, {
		provider: 'google',
		statusCode: response.status,
		retryable: response.status >= 500,
	})
}

async function googleRequest(
	baseUrl: string,
	model: string,
	apiKey: string,
	body: Record<string, unknown>,
	timeout: number,
	reqSignal?: AbortSignal,
): Promise<GeminiResponse> {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), timeout)

	try {
		const signals = [controller.signal, reqSignal].filter(Boolean) as AbortSignal[]
		const mergedSignal = signals.length > 1 ? AbortSignal.any(signals) : signals[0]
		const url = `${baseUrl}/v1beta/models/${model}:generateContent`
		const response = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
			body: JSON.stringify(body),
			signal: mergedSignal,
		})

		if (!response.ok) {
			await handleGoogleErrorResponse(response)
		}

		return (await response.json()) as GeminiResponse
	} finally {
		clearTimeout(timer)
	}
}

async function fetchGoogleStream(
	baseUrl: string,
	model: string,
	apiKey: string,
	body: Record<string, unknown>,
	signal: AbortSignal,
): Promise<Response> {
	const url = `${baseUrl}/v1beta/models/${model}:streamGenerateContent?alt=sse`
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
		body: JSON.stringify(body),
		signal,
	})

	if (!response.ok) {
		const errorBody = await response.text().catch(() => 'Unknown error')
		throw ElsiumError.providerError(`Google API error ${response.status}: ${errorBody}`, {
			provider: 'google',
			retryable: response.status >= 500,
		})
	}

	if (!response.body) {
		throw new ElsiumError({
			code: 'STREAM_ERROR',
			message: 'Response body is null',
			provider: 'google',
			retryable: false,
		})
	}

	return response
}

function emitGeminiPartEvents(part: GeminiPart, emit: (event: StreamEvent) => void): void {
	if (part.text) {
		emit({ type: 'text_delta', text: part.text })
	}
	if (part.functionCall) {
		const toolCallId = generateId('tc')
		emit({
			type: 'tool_call_start',
			toolCall: { id: toolCallId, name: part.functionCall.name },
		})
		emit({
			type: 'tool_call_delta',
			toolCallId,
			arguments: JSON.stringify(part.functionCall.args),
		})
		emit({ type: 'tool_call_end', toolCallId })
	}
}

function emitGeminiFinishEvent(event: GeminiResponse, emit: (event: StreamEvent) => void): void {
	const finishReason = event.candidates?.[0]?.finishReason
	if (!finishReason) return

	const usage: TokenUsage = {
		inputTokens: event.usageMetadata?.promptTokenCount ?? 0,
		outputTokens: event.usageMetadata?.candidatesTokenCount ?? 0,
		totalTokens: event.usageMetadata?.totalTokenCount ?? 0,
	}
	emit({
		type: 'message_end',
		usage,
		stopReason: mapGeminiStopReason(finishReason, false),
	})
}

function processGeminiSSEEvent(event: GeminiResponse, emit: (event: StreamEvent) => void): void {
	const parts = event.candidates?.[0]?.content?.parts ?? []

	for (const part of parts) {
		emitGeminiPartEvents(part, emit)
	}

	emitGeminiFinishEvent(event, emit)
}

function processGeminiSSELine(line: string, emit: (event: StreamEvent) => void): void {
	if (!line.startsWith('data: ')) return
	const data = line.slice(6).trim()

	try {
		const event = JSON.parse(data) as GeminiResponse
		processGeminiSSEEvent(event, emit)
	} catch (err) {
		emit({ type: 'error', error: err instanceof Error ? err : new Error(String(err)) })
	}
}

async function processGeminiSSEStream(
	body: ReadableStream<Uint8Array>,
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
			processGeminiSSELine(line, emit)
		}
	}
}
