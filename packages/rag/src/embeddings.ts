import { ElsiumError } from '@elsium-ai/core'
import type { EmbeddingConfig, EmbeddingVector } from './types'

export interface EmbeddingProvider {
	readonly name: string
	readonly dimensions: number

	embed(text: string): Promise<EmbeddingVector>
	embedBatch(texts: string[]): Promise<EmbeddingVector[]>
}

// ─── OpenAI Embeddings ───────────────────────────────────────────

export function createOpenAIEmbeddings(config: EmbeddingConfig): EmbeddingProvider {
	const {
		apiKey,
		model = 'text-embedding-3-small',
		baseUrl = 'https://api.openai.com',
		dimensions = 1536,
		batchSize = 100,
	} = config

	if (!apiKey) {
		throw new ElsiumError({
			code: 'CONFIG_ERROR',
			message: 'OpenAI API key is required for embeddings',
			retryable: false,
		})
	}

	async function callAPI(input: string[]): Promise<number[][]> {
		const response = await fetch(`${baseUrl}/v1/embeddings`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				input,
				model,
				...(dimensions ? { dimensions } : {}),
			}),
		})

		if (!response.ok) {
			const body = await response.text().catch(() => 'Unknown error')
			throw ElsiumError.providerError(`OpenAI embeddings error ${response.status}: ${body}`, {
				provider: 'openai',
				statusCode: response.status,
				retryable: response.status >= 500,
			})
		}

		const json = (await response.json()) as {
			data: Array<{ embedding: number[]; index: number }>
		}

		return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding)
	}

	return {
		name: 'openai',
		dimensions,

		async embed(text: string): Promise<EmbeddingVector> {
			const [embedding] = await callAPI([text])
			return { values: embedding, dimensions: embedding.length }
		},

		async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
			const results: EmbeddingVector[] = []

			for (let i = 0; i < texts.length; i += batchSize) {
				const batch = texts.slice(i, i + batchSize)
				const embeddings = await callAPI(batch)
				results.push(
					...embeddings.map((values) => ({
						values,
						dimensions: values.length,
					})),
				)
			}

			return results
		},
	}
}

// ─── Mock Embeddings (for testing) ───────────────────────────────

export function createMockEmbeddings(dims = 128): EmbeddingProvider {
	function hashEmbed(text: string): number[] {
		const values = new Array(dims).fill(0)
		for (let i = 0; i < text.length; i++) {
			values[i % dims] += text.charCodeAt(i) / 1000
		}
		// Normalize
		const magnitude = Math.sqrt(values.reduce((s, v) => s + v * v, 0))
		if (magnitude > 0) {
			for (let i = 0; i < dims; i++) {
				values[i] /= magnitude
			}
		}
		return values
	}

	return {
		name: 'mock',
		dimensions: dims,

		async embed(text: string): Promise<EmbeddingVector> {
			const values = hashEmbed(text)
			return { values, dimensions: dims }
		},

		async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
			return texts.map((text) => ({
				values: hashEmbed(text),
				dimensions: dims,
			}))
		},
	}
}

// ─── Factory ─────────────────────────────────────────────────────

export function getEmbeddingProvider(config: EmbeddingConfig): EmbeddingProvider {
	switch (config.provider) {
		case 'openai':
			return createOpenAIEmbeddings(config)
		case 'mock':
			return createMockEmbeddings(config.dimensions)
		default:
			throw new ElsiumError({
				code: 'CONFIG_ERROR',
				message: `Unknown embedding provider: ${config.provider}`,
				retryable: false,
			})
	}
}
