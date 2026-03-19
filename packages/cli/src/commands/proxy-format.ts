import type { CompletionRequest, LLMResponse, Message } from '@elsium-ai/core'

export interface OpenAIChatRequest {
	model: string
	messages: Array<{ role: string; content: string }>
	max_tokens?: number
	temperature?: number
	stream?: boolean
	seed?: number
	top_p?: number
	stop?: string[]
}

export interface OpenAIChatResponse {
	id: string
	object: 'chat.completion'
	created: number
	model: string
	choices: Array<{
		index: number
		message: { role: 'assistant'; content: string }
		finish_reason: string
	}>
	usage: {
		prompt_tokens: number
		completion_tokens: number
		total_tokens: number
	}
}

export interface OpenAIModelList {
	object: 'list'
	data: Array<{
		id: string
		object: 'model'
		created: number
		owned_by: string
	}>
}

const PROVIDER_PATTERNS: Array<[RegExp, string]> = [
	[/^claude-|^anthropic\//, 'anthropic'],
	[/^gpt-|^o1-|^o3-|^o4-/, 'openai'],
	[/^gemini-/, 'google'],
]

export function detectProvider(model: string): string {
	for (const [pattern, provider] of PROVIDER_PATTERNS) {
		if (pattern.test(model)) return provider
	}
	return 'openai'
}

export function openaiToElsium(body: OpenAIChatRequest): CompletionRequest {
	const messages: Message[] = body.messages.map((m) => ({
		role: m.role as Message['role'],
		content: m.content,
	}))

	const request: CompletionRequest = {
		messages,
		model: body.model,
		stream: body.stream,
	}

	if (body.max_tokens !== undefined) request.maxTokens = body.max_tokens
	if (body.temperature !== undefined) request.temperature = body.temperature
	if (body.seed !== undefined) request.seed = body.seed
	if (body.top_p !== undefined) request.topP = body.top_p
	if (body.stop !== undefined) request.stopSequences = body.stop

	return request
}

export function elsiumToOpenai(response: LLMResponse, model: string): OpenAIChatResponse {
	const content =
		typeof response.message.content === 'string'
			? response.message.content
			: response.message.content
					.filter((p) => p.type === 'text')
					.map((p) => (p as { type: 'text'; text: string }).text)
					.join('')

	const finishReason =
		response.stopReason === 'end_turn'
			? 'stop'
			: response.stopReason === 'max_tokens'
				? 'length'
				: response.stopReason === 'tool_use'
					? 'tool_calls'
					: 'stop'

	return {
		id: response.id,
		object: 'chat.completion',
		created: Math.floor(Date.now() / 1000),
		model,
		choices: [
			{
				index: 0,
				message: { role: 'assistant', content },
				finish_reason: finishReason,
			},
		],
		usage: {
			prompt_tokens: response.usage.inputTokens,
			completion_tokens: response.usage.outputTokens,
			total_tokens: response.usage.totalTokens,
		},
	}
}
