import type { LLMResponse, Message } from '@elsium-ai/core'
import { ElsiumError } from '@elsium-ai/core'
import type { z } from 'zod'
import { type GatewayConfig, gateway } from './gateway'

export interface GenerateObjectOptions<T>
	extends Omit<GatewayConfig, 'middleware' | 'streamMiddleware' | 'xray'> {
	schema: z.ZodType<T>
	messages?: Message[]
	prompt?: string
	system?: string
	temperature?: number
	maxTokens?: number
	signal?: AbortSignal
}

export async function generateObject<T>(
	options: GenerateObjectOptions<T>,
): Promise<{ object: T; response: LLMResponse }> {
	const {
		schema,
		messages,
		prompt,
		system,
		temperature,
		maxTokens,
		signal,
		model,
		...gatewayConfig
	} = options

	if (!messages?.length && !prompt) {
		throw ElsiumError.validation('generateObject requires either `messages` or `prompt`')
	}

	const finalMessages: Message[] = messages ?? [{ role: 'user', content: prompt as string }]

	const gw = gateway({
		...gatewayConfig,
		model,
	})

	return gw.generateObject({
		messages: finalMessages,
		schema,
		system,
		temperature,
		maxTokens,
		signal,
		model,
	})
}
