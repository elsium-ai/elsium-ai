import { ElsiumError } from '@elsium-ai/core'
import type { EmbeddingProvider } from '../embeddings'
import { embeddingProviderRegistry } from '../embeddings'
import type { EmbeddingConfig, EmbeddingVector } from '../types'

export interface CohereEmbeddingsConfig {
	apiKey: string
	model?: string
	inputType?: string
}

export function createCohereEmbeddings(config: CohereEmbeddingsConfig): EmbeddingProvider {
	const { apiKey, model = 'embed-v4.0', inputType = 'search_document' } = config

	if (!apiKey) {
		throw new ElsiumError({
			code: 'CONFIG_ERROR',
			message: 'Cohere API key is required for embeddings',
			retryable: false,
		})
	}

	async function callAPI(texts: string[]): Promise<number[][]> {
		const response = await fetch('https://api.cohere.com/v2/embed', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				texts,
				model,
				input_type: inputType,
				embedding_types: ['float'],
			}),
		})

		if (!response.ok) {
			const body = await response.text().catch(() => 'Unknown error')
			throw ElsiumError.providerError(`Cohere embeddings error ${response.status}: ${body}`, {
				provider: 'cohere',
				statusCode: response.status,
				retryable: response.status >= 500,
			})
		}

		const json = (await response.json()) as {
			embeddings: { float: number[][] }
		}

		return json.embeddings.float
	}

	return {
		name: 'cohere',
		dimensions: 1024,

		async embed(text: string): Promise<EmbeddingVector> {
			const [embedding] = await callAPI([text])
			return { values: embedding, dimensions: embedding.length }
		},

		async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
			const embeddings = await callAPI(texts)
			return embeddings.map((values) => ({
				values,
				dimensions: values.length,
			}))
		},
	}
}

// Auto-register
embeddingProviderRegistry.register('cohere', (config: EmbeddingConfig) =>
	createCohereEmbeddings({
		apiKey: config.apiKey ?? '',
		model: config.model,
	}),
)
