import type { ProviderConfig } from '@elsium-ai/core'
import type { LLMProvider, ProviderMetadata } from '../provider'
import { createOpenAIProvider } from './openai'

export interface OpenAICompatibleConfig extends ProviderConfig {
	baseUrl: string
	name?: string
	defaultModel?: string
	capabilities?: string[]
}

export function createOpenAICompatibleProvider(config: OpenAICompatibleConfig): LLMProvider {
	const providerName = config.name ?? 'openai-compatible'
	const model = config.defaultModel ?? 'default'

	const inner = createOpenAIProvider({
		apiKey: config.apiKey,
		baseUrl: config.baseUrl,
		timeout: config.timeout,
		maxRetries: config.maxRetries,
	})

	const metadata: ProviderMetadata = {
		baseUrl: `${config.baseUrl}/v1/chat/completions`,
		capabilities: config.capabilities ?? ['tools', 'streaming', 'system'],
		authStyle: 'bearer',
	}

	return {
		name: providerName,
		defaultModel: model,
		metadata,

		async complete(request) {
			const response = await inner.complete(request)
			return { ...response, provider: providerName }
		},

		stream(request) {
			return inner.stream(request)
		},

		async listModels() {
			return inner.listModels()
		},
	}
}
