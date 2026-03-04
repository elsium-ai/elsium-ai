import { describe, expect, it } from 'vitest'
import { createBM25Index } from './bm25'
import type { Chunk } from './types'

// ─── Helpers ─────────────────────────────────────────────────────

function makeChunk(id: string, content: string, index = 0): Chunk {
	return {
		id,
		content,
		documentId: `doc-${id}`,
		index,
		metadata: { startChar: 0, endChar: content.length, tokenEstimate: content.split(' ').length },
	}
}

// ─── Tests ────────────────────────────────────────────────────────

describe('createBM25Index', () => {
	describe('indexing', () => {
		it('indexes chunks and allows them to be found via search', () => {
			const idx = createBM25Index()
			idx.index([makeChunk('1', 'the quick brown fox jumps over the lazy dog')])

			const results = idx.search('fox')
			expect(results).toHaveLength(1)
			expect(results[0].chunk.id).toBe('1')
		})

		it('indexes multiple chunks', () => {
			const idx = createBM25Index()
			idx.index([
				makeChunk('1', 'machine learning algorithms'),
				makeChunk('2', 'deep learning neural networks'),
				makeChunk('3', 'natural language processing'),
			])

			const results = idx.search('learning')
			expect(results.length).toBeGreaterThanOrEqual(2)
			const ids = results.map((r) => r.chunk.id)
			expect(ids).toContain('1')
			expect(ids).toContain('2')
		})

		it('allows incremental indexing by calling index multiple times', () => {
			const idx = createBM25Index()
			idx.index([makeChunk('1', 'first document about cats')])
			idx.index([makeChunk('2', 'second document about dogs')])

			const catResults = idx.search('cats')
			expect(catResults[0].chunk.id).toBe('1')

			const dogResults = idx.search('dogs')
			expect(dogResults[0].chunk.id).toBe('2')
		})
	})

	describe('search ranking', () => {
		it('ranks more relevant docs higher than less relevant ones', () => {
			const idx = createBM25Index()
			idx.index([
				makeChunk('low', 'a document that mentions python once'),
				makeChunk(
					'high',
					'python python python python is a great programming language python is everywhere',
				),
				makeChunk('none', 'completely unrelated content about cooking and recipes'),
			])

			const results = idx.search('python')
			expect(results[0].chunk.id).toBe('high')
		})

		it('returns results sorted by score descending', () => {
			const idx = createBM25Index()
			idx.index([
				makeChunk('a', 'typescript is great'),
				makeChunk('b', 'typescript typescript is really really great great great'),
				makeChunk('c', 'javascript is also popular'),
			])

			const results = idx.search('typescript great')
			for (let i = 1; i < results.length; i++) {
				expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score)
			}
		})

		it('assigns a score > 0 to matching documents', () => {
			const idx = createBM25Index()
			idx.index([makeChunk('1', 'the quick brown fox')])

			const results = idx.search('quick')
			expect(results[0].score).toBeGreaterThan(0)
		})

		it('does not return documents that have no matching terms', () => {
			const idx = createBM25Index()
			idx.index([
				makeChunk('match', 'the quick brown fox'),
				makeChunk('no-match', 'completely unrelated content'),
			])

			const results = idx.search('fox')
			const ids = results.map((r) => r.chunk.id)
			expect(ids).toContain('match')
			expect(ids).not.toContain('no-match')
		})
	})

	describe('empty index', () => {
		it('returns an empty array when nothing has been indexed', () => {
			const idx = createBM25Index()
			expect(idx.search('anything')).toEqual([])
		})

		it('returns an empty array for an empty query string', () => {
			const idx = createBM25Index()
			idx.index([makeChunk('1', 'some content')])
			expect(idx.search('')).toEqual([])
		})

		it('returns an empty array for a query that matches no documents', () => {
			const idx = createBM25Index()
			idx.index([makeChunk('1', 'hello world')])
			const results = idx.search('xyzzy')
			expect(results).toEqual([])
		})
	})

	describe('multiple terms', () => {
		it('searches across multiple query terms and ranks by combined score', () => {
			const idx = createBM25Index()
			idx.index([
				makeChunk('both', 'machine learning and deep learning techniques'),
				makeChunk('one', 'deep sea diving exploration'),
				makeChunk('neither', 'recipes for chocolate cake'),
			])

			const results = idx.search('machine deep')
			// "both" chunk contains both terms so should score highest
			expect(results[0].chunk.id).toBe('both')
		})

		it('includes documents matching any of the query terms', () => {
			const idx = createBM25Index()
			idx.index([
				makeChunk('a', 'about cats and felines'),
				makeChunk('b', 'about dogs and canines'),
				makeChunk('c', 'about fish and aquariums'),
			])

			const results = idx.search('cats dogs')
			const ids = results.map((r) => r.chunk.id)
			expect(ids).toContain('a')
			expect(ids).toContain('b')
			expect(ids).not.toContain('c')
		})
	})

	describe('topK parameter', () => {
		it('respects the topK limit', () => {
			const idx = createBM25Index()
			idx.index([
				makeChunk('1', 'the word test appears here'),
				makeChunk('2', 'test is also mentioned here'),
				makeChunk('3', 'yet another test document'),
				makeChunk('4', 'test number four document'),
				makeChunk('5', 'the fifth test document here'),
			])

			const results = idx.search('test', 2)
			expect(results).toHaveLength(2)
		})

		it('defaults to topK of 5', () => {
			const idx = createBM25Index()
			const chunks = Array.from({ length: 10 }, (_, i) =>
				makeChunk(`${i}`, `document number ${i} contains word hello`),
			)
			idx.index(chunks)

			const results = idx.search('hello')
			expect(results.length).toBeLessThanOrEqual(5)
		})
	})

	describe('custom BM25 parameters', () => {
		it('accepts custom k1 and b parameters without throwing', () => {
			const idx = createBM25Index({ k1: 1.5, b: 0.5 })
			idx.index([makeChunk('1', 'custom parameters test')])

			const results = idx.search('test')
			expect(results).toHaveLength(1)
			expect(results[0].score).toBeGreaterThan(0)
		})
	})
})
