import type { BM25Index } from './bm25'
import type { EmbeddingVector, RetrievalResult } from './types'
import type { VectorStore } from './vectorstore'

export interface HybridSearchConfig {
	k?: number
	vectorWeight?: number
	bm25Weight?: number
	topK?: number
}

export interface HybridSearch {
	search(query: string, queryEmbedding: EmbeddingVector, topK?: number): Promise<RetrievalResult[]>
}

function reciprocalRankFusion(
	vectorResults: RetrievalResult[],
	bm25Results: RetrievalResult[],
	k: number,
	vectorWeight: number,
	bm25Weight: number,
): RetrievalResult[] {
	const scores = new Map<string, { score: number; chunk: RetrievalResult['chunk'] }>()

	for (let i = 0; i < vectorResults.length; i++) {
		const result = vectorResults[i]
		const rrfScore = vectorWeight / (k + i + 1)
		const existing = scores.get(result.chunk.id)
		if (existing) {
			existing.score += rrfScore
		} else {
			scores.set(result.chunk.id, { score: rrfScore, chunk: result.chunk })
		}
	}

	for (let i = 0; i < bm25Results.length; i++) {
		const result = bm25Results[i]
		const rrfScore = bm25Weight / (k + i + 1)
		const existing = scores.get(result.chunk.id)
		if (existing) {
			existing.score += rrfScore
		} else {
			scores.set(result.chunk.id, { score: rrfScore, chunk: result.chunk })
		}
	}

	return Array.from(scores.values())
		.sort((a, b) => b.score - a.score)
		.map(({ score, chunk }) => ({ chunk, score, distance: 0 }))
}

export function createHybridSearch(
	vectorStore: VectorStore,
	bm25Index: BM25Index,
	config?: HybridSearchConfig,
): HybridSearch {
	const k = config?.k ?? 60
	const vectorWeight = config?.vectorWeight ?? 1
	const bm25Weight = config?.bm25Weight ?? 1
	const defaultTopK = config?.topK ?? 10

	return {
		async search(
			query: string,
			queryEmbedding: EmbeddingVector,
			topK?: number,
		): Promise<RetrievalResult[]> {
			const limit = topK ?? defaultTopK

			const [vectorResults, bm25Results] = await Promise.all([
				vectorStore.query(queryEmbedding, { topK: limit }),
				Promise.resolve(bm25Index.search(query, limit)),
			])

			const fused = reciprocalRankFusion(vectorResults, bm25Results, k, vectorWeight, bm25Weight)

			return fused.slice(0, limit)
		},
	}
}
