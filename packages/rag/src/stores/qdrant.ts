import { ElsiumError } from '@elsium-ai/core'
import type { EmbeddedChunk, EmbeddingVector, QueryOptions, RetrievalResult } from '../types'
import type { VectorStore } from '../vectorstore'
import { vectorStoreRegistry } from '../vectorstore'

export interface QdrantStoreConfig {
	url: string
	apiKey?: string
	collectionName: string
	dimensions: number
}

export function createQdrantStore(config: QdrantStoreConfig): VectorStore {
	const { url, apiKey, collectionName, dimensions } = config

	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
	}

	if (apiKey) {
		headers['api-key'] = apiKey
	}

	async function request(method: string, path: string, body?: unknown): Promise<unknown> {
		const response = await fetch(`${url}${path}`, {
			method,
			headers,
			...(body ? { body: JSON.stringify(body) } : {}),
		})

		if (!response.ok) {
			const text = await response.text().catch(() => 'Unknown error')
			throw ElsiumError.providerError(`Qdrant error ${response.status}: ${text}`, {
				provider: 'qdrant',
				statusCode: response.status,
				retryable: response.status >= 500,
			})
		}

		if (response.status === 204) return null
		return response.json()
	}

	return {
		name: 'qdrant',

		async upsert(chunks: EmbeddedChunk[]): Promise<void> {
			const points = chunks.map((chunk) => ({
				id: chunk.id,
				vector: chunk.embedding.values,
				payload: {
					content: chunk.content,
					documentId: chunk.documentId,
					index: chunk.index,
					metadata: chunk.metadata,
				},
			}))

			await request('PUT', `/collections/${collectionName}/points`, {
				points,
			})
		},

		async query(embedding: EmbeddingVector, options?: QueryOptions): Promise<RetrievalResult[]> {
			const topK = options?.topK ?? 5
			const minScore = options?.minScore ?? 0

			const result = (await request('POST', `/collections/${collectionName}/points/search`, {
				vector: embedding.values,
				limit: topK,
				score_threshold: minScore,
				with_payload: true,
			})) as {
				result: Array<{
					id: string
					score: number
					payload: {
						content: string
						documentId: string
						index: number
						metadata: Record<string, unknown>
					}
				}>
			}

			return (result.result ?? []).map((hit) => ({
				chunk: {
					id: String(hit.id),
					content: hit.payload.content,
					documentId: hit.payload.documentId,
					index: hit.payload.index,
					metadata: hit.payload.metadata as EmbeddedChunk['metadata'],
				},
				score: hit.score,
				distance: 1 - hit.score,
			}))
		},

		async delete(ids: string[]): Promise<void> {
			await request('POST', `/collections/${collectionName}/points/delete`, {
				points: ids,
			})
		},

		async clear(): Promise<void> {
			// Delete and recreate the collection
			try {
				await request('DELETE', `/collections/${collectionName}`)
			} catch {
				// Collection might not exist
			}
			await request('PUT', `/collections/${collectionName}`, {
				vectors: { size: dimensions, distance: 'Cosine' },
			})
		},

		async count(): Promise<number> {
			const result = (await request('GET', `/collections/${collectionName}`)) as {
				result: { points_count: number }
			}
			return result.result?.points_count ?? 0
		},
	}
}

// Auto-register
vectorStoreRegistry.register('qdrant', (config: Record<string, unknown>) =>
	createQdrantStore(config as unknown as QdrantStoreConfig),
)
