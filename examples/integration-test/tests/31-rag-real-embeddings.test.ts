import { createOpenAIEmbeddings, rag } from '@elsium-ai/rag'
/**
 * Test 31: RAG with Real Embeddings
 * Verifies: real OpenAI embeddings for ingest, query, and embedBatch
 */
import { expect, it } from 'vitest'
import { assertNonEmptyString, describeWithLLM } from '../lib/helpers'

const EMBEDDING_CONFIG = {
	provider: 'openai' as const,
	model: 'text-embedding-3-small',
	dimensions: 256,
	apiKey: process.env.OPENAI_API_KEY,
}

describeWithLLM('31 — RAG with Real Embeddings', () => {
	it('retrieves relevant document (dogs vs programming)', async () => {
		const pipeline = rag({
			embeddings: EMBEDDING_CONFIG,
			chunking: { strategy: 'fixed-size', maxChunkSize: 200 },
		})

		await pipeline.ingest(
			'dogs',
			'Dogs are loyal pets. They love walks and belly rubs. Golden retrievers are friendly and playful.',
		)
		await pipeline.ingest(
			'programming',
			'TypeScript is a programming language. Functions and variables are key concepts in coding.',
		)

		const results = await pipeline.query('loyal pets', { topK: 1 })
		expect(results.length).toBeGreaterThan(0)
		expect(results[0].chunk.content.toLowerCase()).toMatch(/dog|loyal|pet|walk|retriever/)
	})

	it('retrieves correct topic from 3 documents', async () => {
		const pipeline = rag({
			embeddings: EMBEDDING_CONFIG,
			chunking: { strategy: 'fixed-size', maxChunkSize: 200 },
		})

		await pipeline.ingest(
			'animals',
			'Cats and dogs are popular household pets. They need food, water, and love.',
		)
		await pipeline.ingest(
			'cooking',
			'Italian pasta is made with flour and eggs. Tomato sauce adds flavor to many dishes.',
		)
		await pipeline.ingest(
			'astronomy',
			'Stars are massive celestial bodies. Galaxies contain billions of stars. The Milky Way is our home galaxy.',
		)

		const results = await pipeline.query('stars and galaxies', { topK: 1 })
		expect(results.length).toBeGreaterThan(0)
		expect(results[0].chunk.content.toLowerCase()).toMatch(/star|galax|celestial|milky/)
	})

	it('embedBatch returns correct count and dimensions', async () => {
		const embedder = createOpenAIEmbeddings(EMBEDDING_CONFIG)

		const vectors = await embedder.embedBatch(['hello', 'world'])
		expect(vectors).toHaveLength(2)
		for (const vec of vectors) {
			expect(vec.dimensions).toBe(256)
			expect(vec.values).toHaveLength(256)
			expect(typeof vec.values[0]).toBe('number')
		}
	})
})
