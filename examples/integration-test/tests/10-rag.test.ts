import { rag } from '@elsium-ai/rag'
/**
 * Test 10: RAG Pipeline
 * Verifies: rag(), pipeline.ingest(), pipeline.query()
 */
import { describe, expect, it } from 'vitest'

describe('10 — RAG Pipeline', () => {
	it('creates a pipeline with mock embeddings', () => {
		const pipeline = rag({
			embeddings: { provider: 'mock', dimensions: 128 },
		})

		expect(pipeline).toBeDefined()
		expect(typeof pipeline.ingest).toBe('function')
		expect(typeof pipeline.query).toBe('function')
		expect(typeof pipeline.clear).toBe('function')
		expect(typeof pipeline.count).toBe('function')
		expect(pipeline.embeddingProvider.name).toBe('mock')
		expect(pipeline.embeddingProvider.dimensions).toBe(128)
	})

	it('ingests documents and returns stats', async () => {
		const pipeline = rag({
			embeddings: { provider: 'mock', dimensions: 64 },
			chunking: { strategy: 'recursive', maxChunkSize: 100, overlap: 10 },
		})

		const result = await pipeline.ingest(
			'doc1.txt',
			'TypeScript is a typed superset of JavaScript that compiles to plain JavaScript. It adds optional static type-checking along with the latest ECMAScript features.',
		)

		expect(result.documentId).toBeDefined()
		expect(result.chunkCount).toBeGreaterThan(0)
		expect(result.totalTokens).toBeGreaterThan(0)
	})

	it('queries return relevant results', async () => {
		const pipeline = rag({
			embeddings: { provider: 'mock', dimensions: 64 },
		})

		await pipeline.ingest(
			'animals.txt',
			'Dogs are loyal companions. Cats are independent creatures. Birds can fly high in the sky.',
		)
		await pipeline.ingest(
			'food.txt',
			'Pizza is a popular Italian dish. Sushi comes from Japan. Tacos are a Mexican staple.',
		)

		const results = await pipeline.query('What animals are loyal?')

		expect(results.length).toBeGreaterThan(0)
		expect(results[0].chunk).toBeDefined()
		expect(results[0].chunk.content).toBeDefined()
		expect(results[0].score).toBeDefined()
	})

	it('pipeline.count() and pipeline.clear()', async () => {
		const pipeline = rag({
			embeddings: { provider: 'mock', dimensions: 32 },
		})

		await pipeline.ingest('test.txt', 'Some test content for counting.')

		const count = await pipeline.count()
		expect(count).toBeGreaterThan(0)

		await pipeline.clear()
		const afterClear = await pipeline.count()
		expect(afterClear).toBe(0)
	})

	it('ingestDocument accepts a Document object', async () => {
		const pipeline = rag({
			embeddings: { provider: 'mock', dimensions: 32 },
		})

		const result = await pipeline.ingestDocument({
			id: 'custom-doc-id',
			source: 'inline',
			content: 'This is inline document content.',
			metadata: { author: 'test' },
		})

		expect(result.documentId).toBe('custom-doc-id')
		expect(result.chunkCount).toBeGreaterThan(0)
	})
})
