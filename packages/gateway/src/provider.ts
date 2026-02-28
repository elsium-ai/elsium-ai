import type { CompletionRequest, LLMResponse, ProviderConfig, StreamEvent } from '@elsium-ai/core'
import type { ElsiumStream } from '@elsium-ai/core'

export interface LLMProvider {
	readonly name: string
	readonly defaultModel: string

	complete(request: CompletionRequest): Promise<LLMResponse>
	stream(request: CompletionRequest): ElsiumStream
	listModels(): Promise<string[]>
}

export type ProviderFactory = (config: ProviderConfig) => LLMProvider

const providerRegistry = new Map<string, ProviderFactory>()

export function registerProvider(name: string, factory: ProviderFactory): void {
	providerRegistry.set(name, factory)
}

export function getProviderFactory(name: string): ProviderFactory | undefined {
	return providerRegistry.get(name)
}

export function listProviders(): string[] {
	return Array.from(providerRegistry.keys())
}
