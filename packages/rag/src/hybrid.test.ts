import { describe, expect, it, vi } from 'vitest'
import type { BM25Index } from './bm25'
import { createHybridSearch } from './hybrid'
import type { Chunk, EmbeddingVector, RetrievalResult } from './types'
import type { VectorStore } from './vectorstore'

function makeChunk(id: string, content = `content for ${id}`): Chunk {
	return {
		id,
		content,
		documentId: 'doc-1',
		index: 0,
		metadata: { startChar: 0, endChar: content.length, tokenEstimate: 10 },
	}
}

function makeResult(id: string, score: number): RetrievalResult {
	return { chunk: makeChunk(id), score, distance: 0 }
}

function makeQueryEmbedding(): EmbeddingVector {
	return { values: [0.1, 0.2, 0.3], dimensions: 3 }
}

function createMockVectorStore(results: RetrievalResult[]): VectorStore {
	return {
		name: 'mock',
		upsert: vi.fn(),
		query: vi.fn().mockResolvedValue(results),
		delete: vi.fn(),
		clear: vi.fn(),
		count: vi.fn(),
	}
}

function createMockBM25Index(results: RetrievalResult[]): BM25Index {
	return {
		index: vi.fn(),
		search: vi.fn().mockReturnValue(results),
	}
}

describe('createHybridSearch', () => {
	it('combines vector and BM25 results', async () => {
		const vectorResults = [makeResult('v1', 0.9), makeResult('v2', 0.8)]
		const bm25Results = [makeResult('b1', 5.0), makeResult('b2', 3.0)]

		const store = createMockVectorStore(vectorResults)
		const index = createMockBM25Index(bm25Results)
		const hybrid = createHybridSearch(store, index)

		const results = await hybrid.search('test query', makeQueryEmbedding())

		expect(results.length).toBe(4)
		expect(results.every((r) => r.score > 0)).toBe(true)
		expect(store.query).toHaveBeenCalledOnce()
		expect(index.search).toHaveBeenCalledWith('test query', 10)
	})

	it('boosts scores for results appearing in both sources', async () => {
		const sharedChunk = makeChunk('shared')
		const vectorResults: RetrievalResult[] = [
			{ chunk: sharedChunk, score: 0.9, distance: 0 },
			makeResult('v-only', 0.8),
		]
		const bm25Results: RetrievalResult[] = [
			{ chunk: sharedChunk, score: 5.0, distance: 0 },
			makeResult('b-only', 3.0),
		]

		const store = createMockVectorStore(vectorResults)
		const index = createMockBM25Index(bm25Results)
		const hybrid = createHybridSearch(store, index)

		const results = await hybrid.search('test', makeQueryEmbedding())

		const sharedResult = results.find((r) => r.chunk.id === 'shared')
		const vOnlyResult = results.find((r) => r.chunk.id === 'v-only')
		const bOnlyResult = results.find((r) => r.chunk.id === 'b-only')

		expect(sharedResult).toBeDefined()
		expect(vOnlyResult).toBeDefined()
		expect(bOnlyResult).toBeDefined()
		expect(sharedResult?.score).toBeGreaterThan(vOnlyResult?.score ?? 0)
		expect(sharedResult?.score).toBeGreaterThan(bOnlyResult?.score ?? 0)
	})

	it('applies custom vectorWeight and bm25Weight', async () => {
		const vectorResults = [makeResult('a', 0.9)]
		const bm25Results = [makeResult('b', 5.0)]

		const storeHeavyVector = createMockVectorStore(vectorResults)
		const indexHeavyVector = createMockBM25Index(bm25Results)
		const heavyVector = createHybridSearch(storeHeavyVector, indexHeavyVector, {
			vectorWeight: 10,
			bm25Weight: 1,
		})

		const storeHeavyBM25 = createMockVectorStore(vectorResults)
		const indexHeavyBM25 = createMockBM25Index(bm25Results)
		const heavyBM25 = createHybridSearch(storeHeavyBM25, indexHeavyBM25, {
			vectorWeight: 1,
			bm25Weight: 10,
		})

		const vectorHeavyResults = await heavyVector.search('test', makeQueryEmbedding())
		const bm25HeavyResults = await heavyBM25.search('test', makeQueryEmbedding())

		expect(vectorHeavyResults[0].chunk.id).toBe('a')
		expect(bm25HeavyResults[0].chunk.id).toBe('b')
	})

	it('respects topK from config', async () => {
		const vectorResults = Array.from({ length: 5 }, (_, i) => makeResult(`v${i}`, 0.9 - i * 0.1))
		const bm25Results = Array.from({ length: 5 }, (_, i) => makeResult(`b${i}`, 5.0 - i))

		const store = createMockVectorStore(vectorResults)
		const index = createMockBM25Index(bm25Results)
		const hybrid = createHybridSearch(store, index, { topK: 3 })

		const results = await hybrid.search('test', makeQueryEmbedding())

		expect(results.length).toBe(3)
	})

	it('respects topK passed to search method over config', async () => {
		const vectorResults = Array.from({ length: 5 }, (_, i) => makeResult(`v${i}`, 0.9 - i * 0.1))
		const bm25Results = Array.from({ length: 5 }, (_, i) => makeResult(`b${i}`, 5.0 - i))

		const store = createMockVectorStore(vectorResults)
		const index = createMockBM25Index(bm25Results)
		const hybrid = createHybridSearch(store, index, { topK: 10 })

		const results = await hybrid.search('test', makeQueryEmbedding(), 2)

		expect(results.length).toBe(2)
	})

	it('handles empty vector results', async () => {
		const bm25Results = [makeResult('b1', 5.0), makeResult('b2', 3.0)]

		const store = createMockVectorStore([])
		const index = createMockBM25Index(bm25Results)
		const hybrid = createHybridSearch(store, index)

		const results = await hybrid.search('test', makeQueryEmbedding())

		expect(results.length).toBe(2)
		expect(results[0].chunk.id).toBe('b1')
	})

	it('handles empty BM25 results', async () => {
		const vectorResults = [makeResult('v1', 0.9), makeResult('v2', 0.8)]

		const store = createMockVectorStore(vectorResults)
		const index = createMockBM25Index([])
		const hybrid = createHybridSearch(store, index)

		const results = await hybrid.search('test', makeQueryEmbedding())

		expect(results.length).toBe(2)
		expect(results[0].chunk.id).toBe('v1')
	})

	it('handles both sources returning empty results', async () => {
		const store = createMockVectorStore([])
		const index = createMockBM25Index([])
		const hybrid = createHybridSearch(store, index)

		const results = await hybrid.search('test', makeQueryEmbedding())

		expect(results).toEqual([])
	})

	it('uses default config values', async () => {
		const vectorResults = [makeResult('v1', 0.9)]
		const bm25Results = [makeResult('b1', 5.0)]

		const store = createMockVectorStore(vectorResults)
		const index = createMockBM25Index(bm25Results)
		const hybrid = createHybridSearch(store, index)

		const results = await hybrid.search('test', makeQueryEmbedding())

		expect(store.query).toHaveBeenCalledWith(makeQueryEmbedding(), { topK: 10 })
		expect(index.search).toHaveBeenCalledWith('test', 10)
		expect(results.length).toBeLessThanOrEqual(10)
	})

	it('sorts fused results by descending score', async () => {
		const vectorResults = [makeResult('low', 0.1)]
		const bm25Results = [makeResult('high', 10.0)]

		const store = createMockVectorStore(vectorResults)
		const index = createMockBM25Index(bm25Results)
		const hybrid = createHybridSearch(store, index, { bm25Weight: 5, vectorWeight: 1 })

		const results = await hybrid.search('test', makeQueryEmbedding())

		for (let i = 1; i < results.length; i++) {
			expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score)
		}
	})

	it('sets distance to 0 on all fused results', async () => {
		const vectorResults = [makeResult('v1', 0.9)]
		const bm25Results = [makeResult('b1', 5.0)]

		const store = createMockVectorStore(vectorResults)
		const index = createMockBM25Index(bm25Results)
		const hybrid = createHybridSearch(store, index)

		const results = await hybrid.search('test', makeQueryEmbedding())

		for (const result of results) {
			expect(result.distance).toBe(0)
		}
	})
})
