import type { CompletionRequest, ElsiumStream, LLMResponse, ProviderConfig } from '@elsium-ai/core'

export interface ModelPricing {
	inputPerMillion: number
	outputPerMillion: number
}

export interface ModelTier {
	tier: 'low' | 'mid' | 'high'
	costPerMToken: number
}

export interface ProviderMetadata {
	baseUrl?: string
	capabilities?: string[]
	pricing?: Record<string, ModelPricing>
	modelTiers?: Record<string, ModelTier>
	authStyle?: 'bearer' | 'x-api-key' | 'query-param'
}

export interface LLMProvider {
	readonly name: string
	readonly defaultModel: string
	readonly metadata?: ProviderMetadata

	complete(request: CompletionRequest): Promise<LLMResponse>
	stream(request: CompletionRequest): ElsiumStream
	listModels(): Promise<string[]>
}

export type ProviderFactory = (config: ProviderConfig) => LLMProvider

const providerRegistry = new Map<string, ProviderFactory>()
const metadataRegistry = new Map<string, ProviderMetadata>()

export function registerProvider(name: string, factory: ProviderFactory): void {
	providerRegistry.set(name, factory)
}

export function getProviderFactory(name: string): ProviderFactory | undefined {
	return providerRegistry.get(name)
}

export function listProviders(): string[] {
	return Array.from(providerRegistry.keys())
}

export function registerProviderMetadata(name: string, metadata: ProviderMetadata): void {
	metadataRegistry.set(name, metadata)
}

export function getProviderMetadata(name: string): ProviderMetadata | undefined {
	return metadataRegistry.get(name)
}
