import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	cosineSimilarity,
	createInMemoryStore,
	createMockEmbeddings,
	createOpenAIEmbeddings,
	csvLoader,
	fixedSizeChunker,
	htmlLoader,
	jsonLoader,
	markdownLoader,
	mmrRerank,
	rag,
	recursiveChunker,
	sentenceChunker,
	textLoader,
} from './index'
import type { Document, EmbeddedChunk, EmbeddingVector, RetrievalResult } from './types'

// ─── Helpers ─────────────────────────────────────────────────────

function makeDoc(content: string, id = 'doc_test'): Document {
	return { id, content, metadata: { source: 'test', type: 'text' } }
}

// ─── Loaders ─────────────────────────────────────────────────────

describe('Loaders', () => {
	describe('textLoader', () => {
		it('loads plain text', () => {
			const loader = textLoader()
			const doc = loader.load('file.txt', 'Hello world')
			expect(doc.content).toBe('Hello world')
			expect(doc.metadata.source).toBe('file.txt')
			expect(doc.metadata.type).toBe('text')
		})
	})

	describe('markdownLoader', () => {
		it('loads markdown and extracts title', () => {
			const loader = markdownLoader()
			const doc = loader.load('readme.md', '# My Project\n\nSome content here.')
			expect(doc.content).toContain('# My Project')
			expect(doc.metadata.title).toBe('My Project')
		})

		it('handles markdown without title', () => {
			const loader = markdownLoader()
			const doc = loader.load('notes.md', 'No heading here')
			expect(doc.metadata.title).toBeUndefined()
		})
	})

	describe('htmlLoader', () => {
		it('strips HTML tags', () => {
			const loader = htmlLoader()
			const doc = loader.load('page.html', '<p>Hello <b>world</b></p>')
			expect(doc.content).toBe('Hello world')
		})

		it('extracts title from HTML', () => {
			const loader = htmlLoader()
			const doc = loader.load(
				'page.html',
				'<html><head><title>My Page</title></head><body><p>Content</p></body></html>',
			)
			expect(doc.metadata.title).toBe('My Page')
		})

		it('removes script and style tags', () => {
			const loader = htmlLoader()
			const doc = loader.load(
				'page.html',
				'<p>Hello</p><script>alert("x")</script><style>.x{}</style><p>World</p>',
			)
			expect(doc.content).not.toContain('alert')
			expect(doc.content).not.toContain('.x')
			expect(doc.content).toContain('Hello')
			expect(doc.content).toContain('World')
		})
	})

	describe('jsonLoader', () => {
		it('loads JSON object', () => {
			const loader = jsonLoader()
			const doc = loader.load('data.json', '{"content": "Hello from JSON"}')
			expect(doc.content).toBe('Hello from JSON')
		})

		it('loads JSON array', () => {
			const loader = jsonLoader()
			const doc = loader.load('data.json', '[{"content": "Item 1"}, {"content": "Item 2"}]')
			expect(doc.content).toContain('Item 1')
			expect(doc.content).toContain('Item 2')
		})

		it('stringifies objects without content field', () => {
			const loader = jsonLoader()
			const doc = loader.load('data.json', '{"name": "Alice", "age": 30}')
			expect(doc.content).toContain('Alice')
		})
	})

	describe('csvLoader', () => {
		it('loads CSV with headers', () => {
			const loader = csvLoader()
			const doc = loader.load('data.csv', 'name,age,city\nAlice,30,NYC\nBob,25,LA')
			expect(doc.content).toContain('name: Alice')
			expect(doc.content).toContain('age: 30')
			expect(doc.metadata.rowCount).toBe(2)
		})

		it('handles quoted CSV fields', () => {
			const loader = csvLoader()
			const doc = loader.load('data.csv', 'name,bio\n"Alice","She said ""hello"" today"')
			expect(doc.content).toContain('Alice')
		})

		it('selects specific columns', () => {
			const loader = csvLoader({ contentColumns: ['name'] })
			const doc = loader.load('data.csv', 'name,age,city\nAlice,30,NYC')
			expect(doc.content).toContain('name: Alice')
			expect(doc.content).not.toContain('city')
		})
	})
})

// ─── Chunkers ────────────────────────────────────────────────────

describe('Chunkers', () => {
	const longText = 'The quick brown fox jumps over the lazy dog. '.repeat(20)

	describe('fixedSizeChunker', () => {
		it('chunks text by fixed size', () => {
			const chunker = fixedSizeChunker({ maxChunkSize: 100 })
			const chunks = chunker.chunk(makeDoc(longText))

			expect(chunks.length).toBeGreaterThan(1)
			for (const chunk of chunks) {
				expect(chunk.content.length).toBeLessThanOrEqual(100)
			}
		})

		it('handles overlap', () => {
			const chunker = fixedSizeChunker({ maxChunkSize: 50, overlap: 10 })
			const chunks = chunker.chunk(makeDoc('A'.repeat(100)))

			expect(chunks.length).toBeGreaterThan(2)
		})

		it('returns single chunk for short text', () => {
			const chunker = fixedSizeChunker({ maxChunkSize: 500 })
			const chunks = chunker.chunk(makeDoc('Short text'))

			expect(chunks).toHaveLength(1)
			expect(chunks[0].content).toBe('Short text')
		})

		it('returns empty for empty document', () => {
			const chunker = fixedSizeChunker()
			const chunks = chunker.chunk(makeDoc(''))
			expect(chunks).toHaveLength(0)
		})

		it('sets correct metadata', () => {
			const chunker = fixedSizeChunker({ maxChunkSize: 50 })
			const chunks = chunker.chunk(makeDoc('Hello world, this is a test.'))

			expect(chunks[0].metadata.startChar).toBe(0)
			expect(chunks[0].metadata.tokenEstimate).toBeGreaterThan(0)
			expect(chunks[0].documentId).toBe('doc_test')
		})
	})

	describe('recursiveChunker', () => {
		it('splits by paragraph first', () => {
			const text = 'Paragraph one content.\n\nParagraph two content.\n\nParagraph three.'
			const chunker = recursiveChunker({ maxChunkSize: 30 })
			const chunks = chunker.chunk(makeDoc(text))

			expect(chunks.length).toBeGreaterThan(1)
		})

		it('keeps small text as single chunk', () => {
			const chunker = recursiveChunker({ maxChunkSize: 1000 })
			const chunks = chunker.chunk(makeDoc('Small text'))

			expect(chunks).toHaveLength(1)
		})

		it('falls back to smaller separators', () => {
			const text = 'Word '.repeat(200)
			const chunker = recursiveChunker({ maxChunkSize: 100 })
			const chunks = chunker.chunk(makeDoc(text))

			expect(chunks.length).toBeGreaterThan(1)
			for (const chunk of chunks) {
				expect(chunk.content.length).toBeLessThanOrEqual(100)
			}
		})
	})

	describe('sentenceChunker', () => {
		it('groups sentences into chunks', () => {
			const text =
				'First sentence. Second sentence. Third sentence. Fourth sentence. Fifth sentence.'
			const chunker = sentenceChunker({ maxChunkSize: 60 })
			const chunks = chunker.chunk(makeDoc(text))

			expect(chunks.length).toBeGreaterThan(1)
			for (const chunk of chunks) {
				expect(chunk.metadata.sentenceCount).toBeGreaterThan(0)
			}
		})

		it('handles single sentence', () => {
			const chunker = sentenceChunker()
			const chunks = chunker.chunk(makeDoc('Just one sentence.'))

			expect(chunks).toHaveLength(1)
		})
	})
})

// ─── Embeddings ──────────────────────────────────────────────────

describe('MockEmbeddings', () => {
	it('generates embeddings', async () => {
		const provider = createMockEmbeddings(64)
		const result = await provider.embed('Hello world')

		expect(result.dimensions).toBe(64)
		expect(result.values).toHaveLength(64)
	})

	it('generates consistent embeddings for same input', async () => {
		const provider = createMockEmbeddings(64)
		const a = await provider.embed('Hello')
		const b = await provider.embed('Hello')

		expect(a.values).toEqual(b.values)
	})

	it('generates different embeddings for different inputs', async () => {
		const provider = createMockEmbeddings(64)
		const a = await provider.embed('Hello')
		const b = await provider.embed('Goodbye')

		expect(a.values).not.toEqual(b.values)
	})

	it('batch embeds multiple texts', async () => {
		const provider = createMockEmbeddings(32)
		const results = await provider.embedBatch(['one', 'two', 'three'])

		expect(results).toHaveLength(3)
		for (const r of results) expect(r.dimensions).toBe(32)
	})
})

// ─── Vector Store ────────────────────────────────────────────────

describe('InMemoryStore', () => {
	it('upserts and queries chunks', async () => {
		const store = createInMemoryStore()
		const embeddings = createMockEmbeddings(32)

		const chunks: EmbeddedChunk[] = [
			{
				id: 'c1',
				content: 'TypeScript is great',
				documentId: 'doc1',
				index: 0,
				metadata: { startChar: 0, endChar: 20, tokenEstimate: 5 },
				embedding: await embeddings.embed('TypeScript is great'),
			},
			{
				id: 'c2',
				content: 'Python is popular',
				documentId: 'doc1',
				index: 1,
				metadata: { startChar: 20, endChar: 37, tokenEstimate: 4 },
				embedding: await embeddings.embed('Python is popular'),
			},
		]

		await store.upsert(chunks)
		expect(await store.count()).toBe(2)

		const queryEmb = await embeddings.embed('TypeScript language')
		const results = await store.query(queryEmb, { topK: 2 })

		expect(results).toHaveLength(2)
		expect(results[0].score).toBeGreaterThan(0)
		expect(results[0].score).toBeGreaterThanOrEqual(results[1].score)
	})

	it('deletes chunks', async () => {
		const store = createInMemoryStore()
		const embeddings = createMockEmbeddings(16)

		await store.upsert([
			{
				id: 'c1',
				content: 'test',
				documentId: 'doc1',
				index: 0,
				metadata: { startChar: 0, endChar: 4, tokenEstimate: 1 },
				embedding: await embeddings.embed('test'),
			},
		])

		expect(await store.count()).toBe(1)
		await store.delete(['c1'])
		expect(await store.count()).toBe(0)
	})

	it('clears all chunks', async () => {
		const store = createInMemoryStore()
		const embeddings = createMockEmbeddings(16)

		await store.upsert([
			{
				id: 'c1',
				content: 'a',
				documentId: 'doc1',
				index: 0,
				metadata: { startChar: 0, endChar: 1, tokenEstimate: 1 },
				embedding: await embeddings.embed('a'),
			},
			{
				id: 'c2',
				content: 'b',
				documentId: 'doc1',
				index: 1,
				metadata: { startChar: 1, endChar: 2, tokenEstimate: 1 },
				embedding: await embeddings.embed('b'),
			},
		])

		await store.clear()
		expect(await store.count()).toBe(0)
	})

	it('respects minScore filter', async () => {
		const store = createInMemoryStore()
		const embeddings = createMockEmbeddings(16)

		await store.upsert([
			{
				id: 'c1',
				content: 'hello world',
				documentId: 'doc1',
				index: 0,
				metadata: { startChar: 0, endChar: 11, tokenEstimate: 3 },
				embedding: await embeddings.embed('hello world'),
			},
		])

		const queryEmb = await embeddings.embed('completely different topic xyz')
		const results = await store.query(queryEmb, { minScore: 0.99 })

		// Very different text should have low similarity
		expect(results.length).toBeLessThanOrEqual(1)
	})
})

// ─── Cosine Similarity ──────────────────────────────────────────

describe('cosineSimilarity', () => {
	it('returns 1 for identical vectors', () => {
		expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 5)
	})

	it('returns 0 for orthogonal vectors', () => {
		expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5)
	})

	it('returns -1 for opposite vectors', () => {
		expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 5)
	})

	it('handles zero vectors', () => {
		expect(cosineSimilarity([0, 0], [1, 0])).toBe(0)
	})

	it('returns 0 for different length vectors', () => {
		expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0)
	})
})

// ─── RAG Pipeline ────────────────────────────────────────────────

describe('RAG Pipeline', () => {
	it('ingests and queries documents', async () => {
		const pipeline = rag({
			loader: 'text',
			chunking: { strategy: 'fixed-size', maxChunkSize: 100 },
			embeddings: { provider: 'mock', dimensions: 64 },
		})

		const result = await pipeline.ingest(
			'doc.txt',
			'TypeScript is a typed superset of JavaScript. It compiles to plain JavaScript. TypeScript adds optional static types.',
		)

		expect(result.chunkCount).toBeGreaterThan(0)
		expect(result.totalTokens).toBeGreaterThan(0)

		const queryResults = await pipeline.query('What is TypeScript?')
		expect(queryResults.length).toBeGreaterThan(0)
		expect(queryResults[0].score).toBeGreaterThan(0)
	})

	it('ingests markdown documents', async () => {
		const pipeline = rag({
			loader: 'markdown',
			chunking: { strategy: 'recursive', maxChunkSize: 200 },
			embeddings: { provider: 'mock', dimensions: 32 },
		})

		const markdown = `# Getting Started

## Installation

Run npm install to get started.

## Configuration

Create a config file with your settings.

## Usage

Import the library and call the main function.`

		const result = await pipeline.ingest('guide.md', markdown)
		expect(result.chunkCount).toBeGreaterThan(0)
	})

	it('ingests HTML documents', async () => {
		const pipeline = rag({
			loader: 'html',
			chunking: { strategy: 'sentence' },
			embeddings: { provider: 'mock', dimensions: 32 },
		})

		const html = `<html>
			<head><title>Test Page</title></head>
			<body>
				<h1>Welcome</h1>
				<p>This is a test page with content. It has multiple sentences. Each one matters.</p>
			</body>
		</html>`

		const result = await pipeline.ingest('page.html', html)
		expect(result.chunkCount).toBeGreaterThan(0)
	})

	it('handles multiple documents', async () => {
		const pipeline = rag({
			embeddings: { provider: 'mock', dimensions: 32 },
			chunking: { strategy: 'fixed-size', maxChunkSize: 100 },
		})

		await pipeline.ingest('doc1.txt', 'TypeScript is great for large applications.')
		await pipeline.ingest('doc2.txt', 'Python is popular for data science.')
		await pipeline.ingest('doc3.txt', 'Rust provides memory safety guarantees.')

		expect(await pipeline.count()).toBeGreaterThanOrEqual(3)

		const results = await pipeline.query('Which language for big projects?', { topK: 2 })
		expect(results).toHaveLength(2)
	})

	it('clears all data', async () => {
		const pipeline = rag({
			embeddings: { provider: 'mock', dimensions: 16 },
		})

		await pipeline.ingest('doc.txt', 'Some content here.')
		expect(await pipeline.count()).toBeGreaterThan(0)

		await pipeline.clear()
		expect(await pipeline.count()).toBe(0)
	})

	it('returns empty results for empty store', async () => {
		const pipeline = rag({
			embeddings: { provider: 'mock', dimensions: 16 },
		})

		const results = await pipeline.query('anything')
		expect(results).toHaveLength(0)
	})

	it('ingests CSV data', async () => {
		const pipeline = rag({
			loader: 'csv',
			chunking: { strategy: 'fixed-size', maxChunkSize: 200 },
			embeddings: { provider: 'mock', dimensions: 32 },
		})

		const csv =
			'product,description,price\nWidget,"A great widget",9.99\nGadget,"A cool gadget",19.99'
		const result = await pipeline.ingest('products.csv', csv)

		expect(result.chunkCount).toBeGreaterThan(0)

		const results = await pipeline.query('widget')
		expect(results.length).toBeGreaterThan(0)
	})

	it('handles query options', async () => {
		const pipeline = rag({
			embeddings: { provider: 'mock', dimensions: 32 },
			chunking: { strategy: 'fixed-size', maxChunkSize: 50 },
		})

		await pipeline.ingest('doc.txt', 'A '.repeat(100))

		const results = await pipeline.query('test', { topK: 2 })
		expect(results.length).toBeLessThanOrEqual(2)
	})
})

// ─── MMR Reranking ───────────────────────────────────────────────

describe('mmrRerank', () => {
	function makeResult(
		id: string,
		score: number,
		embeddingValues: number[],
	): RetrievalResult & { embedding: EmbeddingVector } {
		return {
			chunk: {
				id,
				content: `content for ${id}`,
				documentId: 'doc1',
				index: 0,
				metadata: { startChar: 0, endChar: 10, tokenEstimate: 3 },
			},
			score,
			distance: 1 - score,
			embedding: { values: embeddingValues, dimensions: embeddingValues.length },
		}
	}

	it('returns empty array for empty input', () => {
		const queryEmb: EmbeddingVector = { values: [1, 0, 0], dimensions: 3 }
		const result = mmrRerank(queryEmb, [])
		expect(result).toEqual([])
	})

	it('returns the most relevant result first', () => {
		const queryEmb: EmbeddingVector = { values: [1, 0, 0], dimensions: 3 }
		const results = [
			makeResult('low', 0.5, [0, 1, 0]),
			makeResult('high', 0.9, [1, 0, 0]),
			makeResult('mid', 0.7, [0.5, 0.5, 0]),
		]

		const reranked = mmrRerank(queryEmb, results, { topK: 3 })

		expect(reranked[0].chunk.id).toBe('high')
		expect(reranked.length).toBe(3)
	})

	it('respects topK parameter', () => {
		const queryEmb: EmbeddingVector = { values: [1, 0, 0], dimensions: 3 }
		const results = [
			makeResult('a', 0.9, [1, 0, 0]),
			makeResult('b', 0.8, [0.9, 0.1, 0]),
			makeResult('c', 0.7, [0.8, 0.2, 0]),
			makeResult('d', 0.6, [0, 1, 0]),
		]

		const reranked = mmrRerank(queryEmb, results, { topK: 2 })
		expect(reranked).toHaveLength(2)
	})

	it('promotes diversity with low lambda', () => {
		const queryEmb: EmbeddingVector = { values: [1, 0, 0], dimensions: 3 }
		// Two similar results and one diverse result
		const results = [
			makeResult('similar1', 0.95, [1, 0, 0]),
			makeResult('similar2', 0.9, [0.99, 0.01, 0]),
			makeResult('diverse', 0.7, [0, 1, 0]),
		]

		// With low lambda, diversity is more valued
		const reranked = mmrRerank(queryEmb, results, { topK: 3, lambda: 0.3 })
		expect(reranked).toHaveLength(3)
		// First result should still be the most relevant
		expect(reranked[0].chunk.id).toBe('similar1')
	})

	it('works with single result', () => {
		const queryEmb: EmbeddingVector = { values: [1, 0], dimensions: 2 }
		const results = [makeResult('only', 0.8, [0.9, 0.1])]

		const reranked = mmrRerank(queryEmb, results, { topK: 5 })
		expect(reranked).toHaveLength(1)
		expect(reranked[0].chunk.id).toBe('only')
	})
})

// ─── OpenAI Embeddings ──────────────────────────────────────────

describe('createOpenAIEmbeddings', () => {
	const originalFetch = globalThis.fetch

	afterEach(() => {
		globalThis.fetch = originalFetch
	})

	it('throws when API key is missing', () => {
		expect(() => createOpenAIEmbeddings({ provider: 'openai' })).toThrow('API key is required')
	})

	it('embeds a single text', async () => {
		const mockEmbedding = [0.1, 0.2, 0.3, 0.4]

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				data: [{ embedding: mockEmbedding, index: 0 }],
			}),
		})

		const provider = createOpenAIEmbeddings({
			provider: 'openai',
			apiKey: 'test-key',
			dimensions: 4,
		})

		expect(provider.name).toBe('openai')
		expect(provider.dimensions).toBe(4)

		const result = await provider.embed('hello world')
		expect(result.values).toEqual(mockEmbedding)
		expect(result.dimensions).toBe(4)

		expect(globalThis.fetch).toHaveBeenCalledOnce()
		const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
		expect(fetchCall[0]).toContain('/v1/embeddings')
	})

	it('embeds a batch of texts', async () => {
		const mockEmbeddings = [
			[0.1, 0.2],
			[0.3, 0.4],
			[0.5, 0.6],
		]

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				data: mockEmbeddings.map((embedding, index) => ({ embedding, index })),
			}),
		})

		const provider = createOpenAIEmbeddings({
			provider: 'openai',
			apiKey: 'test-key',
			dimensions: 2,
			batchSize: 100,
		})

		const results = await provider.embedBatch(['text1', 'text2', 'text3'])
		expect(results).toHaveLength(3)
		expect(results[0].values).toEqual([0.1, 0.2])
		expect(results[1].values).toEqual([0.3, 0.4])
		expect(results[2].values).toEqual([0.5, 0.6])
	})

	it('handles API error', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 500,
			text: async () => 'Internal Server Error',
		})

		const provider = createOpenAIEmbeddings({
			provider: 'openai',
			apiKey: 'test-key',
		})

		await expect(provider.embed('test')).rejects.toThrow('OpenAI embeddings error 500')
	})

	it('sends correct authorization header', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				data: [{ embedding: [0.1], index: 0 }],
			}),
		})

		const provider = createOpenAIEmbeddings({
			provider: 'openai',
			apiKey: 'sk-test-123',
			dimensions: 1,
		})

		await provider.embed('test')

		const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
		expect(fetchCall[1].headers.Authorization).toBe('Bearer sk-test-123')
	})

	it('batches large input according to batchSize', async () => {
		const callCount = { value: 0 }

		globalThis.fetch = vi.fn().mockImplementation(async () => {
			callCount.value++
			// Return embeddings for however many inputs were sent
			return {
				ok: true,
				json: async () => ({
					data: [
						{ embedding: [0.1, 0.2], index: 0 },
						{ embedding: [0.3, 0.4], index: 1 },
					],
				}),
			}
		})

		const provider = createOpenAIEmbeddings({
			provider: 'openai',
			apiKey: 'test-key',
			dimensions: 2,
			batchSize: 2,
		})

		const results = await provider.embedBatch(['a', 'b', 'c', 'd'])
		// With batchSize 2 and 4 texts, should make 2 API calls
		expect(callCount.value).toBe(2)
		expect(results).toHaveLength(4)
	})
})
