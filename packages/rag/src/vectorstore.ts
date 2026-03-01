import { generateId } from '@elsium-ai/core'
import type { Chunk, EmbeddedChunk, EmbeddingVector, QueryOptions, RetrievalResult } from './types'

export interface VectorStore {
	readonly name: string

	upsert(chunks: EmbeddedChunk[]): Promise<void>
	query(embedding: EmbeddingVector, options?: QueryOptions): Promise<RetrievalResult[]>
	delete(ids: string[]): Promise<void>
	clear(): Promise<void>
	count(): Promise<number>
}

// ─── Cosine Similarity ───────────────────────────────────────────

export function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length) return 0

	let dotProduct = 0
	let magnitudeA = 0
	let magnitudeB = 0

	for (let i = 0; i < a.length; i++) {
		dotProduct += a[i] * b[i]
		magnitudeA += a[i] * a[i]
		magnitudeB += b[i] * b[i]
	}

	magnitudeA = Math.sqrt(magnitudeA)
	magnitudeB = Math.sqrt(magnitudeB)

	if (magnitudeA === 0 || magnitudeB === 0) return 0
	return dotProduct / (magnitudeA * magnitudeB)
}

// ─── In-Memory Vector Store ──────────────────────────────────────

export function createInMemoryStore(options?: {
	maxChunks?: number
}): VectorStore {
	const maxChunks = options?.maxChunks ?? 100_000
	const entries = new Map<string, EmbeddedChunk>()

	return {
		name: 'in-memory',

		async upsert(chunks: EmbeddedChunk[]): Promise<void> {
			for (const chunk of chunks) {
				entries.set(chunk.id, chunk)
			}
			// Evict oldest entries if over limit
			while (entries.size > maxChunks) {
				const firstKey = entries.keys().next().value
				if (firstKey !== undefined) entries.delete(firstKey)
			}
		},

		async query(embedding: EmbeddingVector, options?: QueryOptions): Promise<RetrievalResult[]> {
			const topK = options?.topK ?? 5
			const minScore = options?.minScore ?? 0

			const scored: RetrievalResult[] = []

			for (const chunk of entries.values()) {
				const score = cosineSimilarity(embedding.values, chunk.embedding.values)
				if (score >= minScore) {
					scored.push({
						chunk: {
							id: chunk.id,
							content: chunk.content,
							documentId: chunk.documentId,
							index: chunk.index,
							metadata: chunk.metadata,
						},
						score,
						distance: 1 - score,
					})
				}
			}

			scored.sort((a, b) => b.score - a.score)
			return scored.slice(0, topK)
		},

		async delete(ids: string[]): Promise<void> {
			for (const id of ids) {
				entries.delete(id)
			}
		},

		async clear(): Promise<void> {
			entries.clear()
		},

		async count(): Promise<number> {
			return entries.size
		},
	}
}

// ─── MMR (Maximal Marginal Relevance) ────────────────────────────

function getEmbeddingValues(
	sel: RetrievalResult,
	results: Array<RetrievalResult & { embedding: EmbeddingVector }>,
): number[] {
	const match = results.find((r) => r.chunk.id === sel.chunk.id) as
		| (RetrievalResult & { embedding: EmbeddingVector })
		| undefined
	return match?.embedding.values ?? []
}

function maxSimilarityToSelected(
	candidate: RetrievalResult & { embedding: EmbeddingVector },
	selected: RetrievalResult[],
	results: Array<RetrievalResult & { embedding: EmbeddingVector }>,
): number {
	let maxSim = Number.NEGATIVE_INFINITY
	for (const sel of selected) {
		const selValues = getEmbeddingValues(sel, results)
		const sim = cosineSimilarity(candidate.embedding.values, selValues)
		if (sim > maxSim) maxSim = sim
	}
	return maxSim
}

function selectBestCandidate(
	remaining: Array<RetrievalResult & { embedding: EmbeddingVector }>,
	selected: RetrievalResult[],
	results: Array<RetrievalResult & { embedding: EmbeddingVector }>,
	lambda: number,
): number {
	let bestIndex = 0
	let bestMmrScore = Number.NEGATIVE_INFINITY

	for (let i = 0; i < remaining.length; i++) {
		const relevance = remaining[i].score
		const maxSim = maxSimilarityToSelected(remaining[i], selected, results)
		const mmrScore = lambda * relevance - (1 - lambda) * maxSim

		if (mmrScore > bestMmrScore) {
			bestMmrScore = mmrScore
			bestIndex = i
		}
	}

	return bestIndex
}

export function mmrRerank(
	queryEmbedding: EmbeddingVector,
	results: Array<RetrievalResult & { embedding: EmbeddingVector }>,
	options?: { topK?: number; lambda?: number },
): RetrievalResult[] {
	const topK = options?.topK ?? 5
	const lambda = options?.lambda ?? 0.7

	if (results.length === 0) return []

	const selected: RetrievalResult[] = []
	const remaining = [...results]

	remaining.sort((a, b) => b.score - a.score)
	const first = remaining.shift()
	if (!first) return []
	selected.push(first)

	while (selected.length < topK && remaining.length > 0) {
		const bestIndex = selectBestCandidate(remaining, selected, results, lambda)
		selected.push(remaining[bestIndex])
		remaining.splice(bestIndex, 1)
	}

	return selected
}
