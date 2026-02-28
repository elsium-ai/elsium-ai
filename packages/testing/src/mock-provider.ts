import type { CompletionRequest, LLMResponse, Message, TokenUsage } from '@elsium-ai/core'
import { type ElsiumStream, createStream, generateId, generateTraceId } from '@elsium-ai/core'
import type { LLMProvider } from '@elsium-ai/gateway'

export interface MockResponseConfig {
	content?: string
	toolCalls?: Array<{ id?: string; name: string; arguments: Record<string, unknown> }>
	stopReason?: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence'
	usage?: Partial<TokenUsage>
	model?: string
	delay?: number
}

export interface MockProviderOptions {
	responses?: MockResponseConfig[]
	defaultResponse?: MockResponseConfig
	onRequest?: (request: CompletionRequest) => void
}

export interface MockProvider extends LLMProvider {
	readonly calls: CompletionRequest[]
	readonly callCount: number
	reset(): void
}

export function mockProvider(options: MockProviderOptions = {}): MockProvider {
	const { responses = [], defaultResponse, onRequest } = options
	const calls: CompletionRequest[] = []
	let callIndex = 0

	function getNextResponse(): MockResponseConfig {
		if (callIndex < responses.length) {
			return responses[callIndex++]
		}
		if (defaultResponse) {
			callIndex++
			return defaultResponse
		}
		callIndex++
		return { content: '' }
	}

	function buildResponse(config: MockResponseConfig, request: CompletionRequest): LLMResponse {
		const model = config.model ?? request.model ?? 'mock-model'
		const content = config.content ?? ''
		const toolCalls = config.toolCalls?.map((tc) => ({
			id: tc.id ?? generateId('tc'),
			name: tc.name,
			arguments: tc.arguments,
		}))

		const usage: TokenUsage = {
			inputTokens: config.usage?.inputTokens ?? Math.ceil(content.length / 4),
			outputTokens: config.usage?.outputTokens ?? Math.ceil(content.length / 4),
			totalTokens: 0,
			...config.usage,
		}
		usage.totalTokens = usage.inputTokens + usage.outputTokens

		const message: Message = {
			role: 'assistant',
			content,
			...(toolCalls?.length ? { toolCalls } : {}),
		}

		return {
			id: generateId('msg'),
			message,
			usage,
			cost: { inputCost: 0, outputCost: 0, totalCost: 0, currency: 'USD' },
			model,
			provider: 'mock',
			stopReason: config.stopReason ?? (toolCalls?.length ? 'tool_use' : 'end_turn'),
			latencyMs: config.delay ?? 0,
			traceId: generateTraceId(),
		}
	}

	return {
		name: 'mock',
		defaultModel: 'mock-model',

		get calls() {
			return calls
		},

		get callCount() {
			return calls.length
		},

		async complete(request: CompletionRequest): Promise<LLMResponse> {
			calls.push(request)
			onRequest?.(request)

			const config = getNextResponse()

			if (config.delay) {
				await new Promise((r) => setTimeout(r, config.delay))
			}

			return buildResponse(config, request)
		},

		stream(request: CompletionRequest): ElsiumStream {
			calls.push(request)
			onRequest?.(request)

			const config = getNextResponse()

			return createStream(async (emit) => {
				if (config.delay) {
					await new Promise((r) => setTimeout(r, config.delay))
				}

				emit({
					type: 'message_start',
					id: generateId('msg'),
					model: config.model ?? 'mock-model',
				})

				const content = config.content ?? ''
				if (content) {
					// Stream word by word
					const words = content.split(' ')
					for (const word of words) {
						emit({ type: 'text_delta', text: `${word} ` })
					}
				}

				emit({
					type: 'message_end',
					usage: {
						inputTokens: config.usage?.inputTokens ?? 10,
						outputTokens: config.usage?.outputTokens ?? 5,
						totalTokens: config.usage?.totalTokens ?? 15,
					},
					stopReason: config.stopReason ?? 'end_turn',
				})
			})
		},

		async listModels(): Promise<string[]> {
			return ['mock-model']
		},

		reset() {
			calls.length = 0
			callIndex = 0
		},
	}
}
