import {
	type CompletionRequest,
	ElsiumError,
	type ElsiumStream,
	type LLMResponse,
	type Message,
	type ProviderConfig,
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

	function formatMessages(messages: Message[]): {
		systemInstruction?: { parts: GeminiPart[] }
		contents: GeminiContent[]
	} {
		let systemInstruction: { parts: GeminiPart[] } | undefined
		const contents: GeminiContent[] = []

		for (const msg of messages) {
			if (msg.role === 'system') {
				const text =
					typeof msg.content === 'string'
						? msg.content
						: msg.content
								.filter((p) => p.type === 'text')
								.map((p) => (p as { text: string }).text)
								.join('\n')
				systemInstruction = { parts: [{ text }] }
				continue
			}

			if (msg.role === 'tool') {
				for (const tr of msg.toolResults ?? []) {
					contents.push({
						role: 'model',
						parts: [
							{
								functionResponse: {
									name: tr.toolCallId,
									response: { content: tr.content },
								},
							},
						],
					})
				}
				continue
			}

			const role = msg.role === 'assistant' ? 'model' : 'user'

			if (typeof msg.content === 'string') {
				const parts: GeminiPart[] = [{ text: msg.content }]

				if (msg.toolCalls?.length) {
					for (const tc of msg.toolCalls) {
						parts.push({
							functionCall: { name: tc.name, args: tc.arguments },
						})
					}
				}

				contents.push({ role, parts })
			} else {
				const parts: GeminiPart[] = msg.content
					.filter((p) => p.type === 'text')
					.map((p) => ({ text: (p as { text: string }).text }))
				contents.push({ role, parts })
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

	function parseResponse(raw: GeminiResponse, model: string, latencyMs: number): LLMResponse {
		const traceId = generateTraceId()
		const candidate = raw.candidates?.[0]
		const parts = candidate?.content?.parts ?? []

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

		const usage: TokenUsage = {
			inputTokens: raw.usageMetadata?.promptTokenCount ?? 0,
			outputTokens: raw.usageMetadata?.candidatesTokenCount ?? 0,
			totalTokens: raw.usageMetadata?.totalTokenCount ?? 0,
		}

		const finishReason = candidate?.finishReason
		const stopReason =
			finishReason === 'STOP'
				? 'end_turn'
				: finishReason === 'MAX_TOKENS'
					? 'max_tokens'
					: finishReason === 'TOOL_CALLS' || toolCalls.length > 0
						? 'tool_use'
						: 'end_turn'

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
			stopReason: stopReason as LLMResponse['stopReason'],
			latencyMs,
			traceId,
		}
	}

	return {
		name: 'google',
		defaultModel: 'gemini-2.0-flash',

		async complete(req: CompletionRequest): Promise<LLMResponse> {
			const model = req.model ?? 'gemini-2.0-flash'
			const { systemInstruction, contents } = formatMessages(req.messages)

			const body: Record<string, unknown> = {
				contents,
				...(systemInstruction || req.system
					? {
							systemInstruction: req.system ? { parts: [{ text: req.system }] } : systemInstruction,
						}
					: {}),
				generationConfig: {
					maxOutputTokens: req.maxTokens ?? 4096,
					...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
					...(req.topP !== undefined ? { topP: req.topP } : {}),
					...(req.stopSequences?.length ? { stopSequences: req.stopSequences } : {}),
				},
			}

			const tools = formatTools(req.tools)
			if (tools) body.tools = tools

			const startTime = performance.now()

			const raw = await retry(
				async () => {
					const controller = new AbortController()
					const timer = setTimeout(() => controller.abort(), timeout)

					try {
						const url = `${baseUrl}/v1beta/models/${model}:generateContent`
						const response = await fetch(url, {
							method: 'POST',
							headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
							body: JSON.stringify(body),
							signal: controller.signal,
						})

						if (!response.ok) {
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

						return (await response.json()) as GeminiResponse
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
			return parseResponse(raw, model, latencyMs)
		},

		stream(req: CompletionRequest): ElsiumStream {
			const model = req.model ?? 'gemini-2.0-flash'
			const { systemInstruction, contents } = formatMessages(req.messages)

			const body: Record<string, unknown> = {
				contents,
				...(systemInstruction || req.system
					? {
							systemInstruction: req.system ? { parts: [{ text: req.system }] } : systemInstruction,
						}
					: {}),
				generationConfig: {
					maxOutputTokens: req.maxTokens ?? 4096,
					...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
					...(req.topP !== undefined ? { topP: req.topP } : {}),
					...(req.stopSequences?.length ? { stopSequences: req.stopSequences } : {}),
				},
			}

			const tools = formatTools(req.tools)
			if (tools) body.tools = tools

			return createStream(async (emit) => {
				const controller = new AbortController()
				const timer = setTimeout(() => controller.abort(), timeout)

				try {
					const url = `${baseUrl}/v1beta/models/${model}:streamGenerateContent?alt=sse`
					const response = await fetch(url, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
						body: JSON.stringify(body),
						signal: controller.signal,
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

					const reader = response.body.getReader()
					const decoder = new TextDecoder()
					let buffer = ''

					emit({ type: 'message_start', id: generateId('msg'), model })

					while (true) {
						const { done, value } = await reader.read()
						if (done) break

						buffer += decoder.decode(value, { stream: true })
						const lines = buffer.split('\n')
						buffer = lines.pop() ?? ''

						for (const line of lines) {
							if (!line.startsWith('data: ')) continue
							const data = line.slice(6).trim()

							try {
								const event = JSON.parse(data) as GeminiResponse
								const parts = event.candidates?.[0]?.content?.parts ?? []

								for (const part of parts) {
									if (part.text) {
										emit({ type: 'text_delta', text: part.text })
									}
									if (part.functionCall) {
										const toolCallId = generateId('tc')
										emit({
											type: 'tool_call_start',
											toolCall: {
												id: toolCallId,
												name: part.functionCall.name,
											},
										})
										emit({
											type: 'tool_call_delta',
											toolCallId,
											arguments: JSON.stringify(part.functionCall.args),
										})
										emit({ type: 'tool_call_end', toolCallId })
									}
								}

								const finishReason = event.candidates?.[0]?.finishReason
								if (finishReason) {
									const usage: TokenUsage = {
										inputTokens: event.usageMetadata?.promptTokenCount ?? 0,
										outputTokens: event.usageMetadata?.candidatesTokenCount ?? 0,
										totalTokens: event.usageMetadata?.totalTokenCount ?? 0,
									}
									emit({
										type: 'message_end',
										usage,
										stopReason: finishReason === 'STOP' ? 'end_turn' : 'end_turn',
									})
								}
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
			return [
				'gemini-2.0-flash',
				'gemini-2.0-flash-lite',
				'gemini-2.5-pro-preview-05-06',
				'gemini-2.5-flash-preview-04-17',
			]
		},
	}
}
