import { ElsiumError } from '@elsium-ai/core'
import type { EmbeddingProvider } from '../embeddings'
import { embeddingProviderRegistry } from '../embeddings'
import type { EmbeddingConfig, EmbeddingVector } from '../types'

export interface GoogleEmbeddingsConfig {
	apiKey: string
	model?: string
	dimensions?: number
}

export function createGoogleEmbeddings(config: GoogleEmbeddingsConfig): EmbeddingProvider {
	const { apiKey, model = 'text-embedding-004', dimensions = 768 } = config

	if (!apiKey) {
		throw new ElsiumError({
			code: 'CONFIG_ERROR',
			message: 'Google API key is required for embeddings',
			retryable: false,
		})
	}

	const baseUrl = 'https://generativelanguage.googleapis.com/v1beta'

	async function callAPI(texts: string[]): Promise<number[][]> {
		const results: number[][] = []

		for (const text of texts) {
			const url = `${baseUrl}/models/${model}:embedContent?key=${apiKey}`
			const response = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					model: `models/${model}`,
					content: { parts: [{ text }] },
					...(dimensions ? { outputDimensionality: dimensions } : {}),
				}),
			})

			if (!response.ok) {
				const body = await response.text().catch(() => 'Unknown error')
				throw ElsiumError.providerError(`Google embeddings error ${response.status}: ${body}`, {
					provider: 'google',
					statusCode: response.status,
					retryable: response.status >= 500,
				})
			}

			const json = (await response.json()) as {
				embedding: { values: number[] }
			}

			results.push(json.embedding.values)
		}

		return results
	}

	return {
		name: 'google',
		dimensions,

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
embeddingProviderRegistry.register('google', (config: EmbeddingConfig) =>
	createGoogleEmbeddings({
		apiKey: config.apiKey ?? '',
		model: config.model,
		dimensions: config.dimensions,
	}),
)
