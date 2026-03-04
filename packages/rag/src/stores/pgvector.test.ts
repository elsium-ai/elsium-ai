import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EmbeddedChunk, EmbeddingVector } from '../types'

// ─── pg mock via node:module interception ────────────────────────
//
// The pgvector store uses `createRequire(import.meta.url)` to dynamically
// require 'pg', which bypasses Vitest's standard vi.mock() interception.
// We intercept at the node:module level so that any require('pg') call in
// the module under test gets our fake client.

const { mockQuery, mockConnect, mockEnd, MockPgClientConstructor } = vi.hoisted(() => {
	const mockQuery = vi.fn()
	const mockConnect = vi.fn()
	const mockEnd = vi.fn()
	const MockPgClientConstructor = vi.fn().mockImplementation(() => ({
		connect: mockConnect,
		query: mockQuery,
		end: mockEnd,
	}))
	return { mockQuery, mockConnect, mockEnd, MockPgClientConstructor }
})

vi.mock('node:module', () => ({
	createRequire: vi.fn().mockReturnValue((mod: string) => {
		if (mod === 'pg') return { Client: MockPgClientConstructor }
		throw new Error(`Unexpected require("${mod}")`)
	}),
}))

// Import AFTER the mock is set up (vi.mock is hoisted automatically)
import { createPgVectorStore } from './pgvector'

// ─── Helpers ─────────────────────────────────────────────────────

function makeChunk(overrides: Partial<EmbeddedChunk> = {}): EmbeddedChunk {
	return {
		id: 'chunk_1',
		content: 'Hello world',
		documentId: 'doc_1',
		index: 0,
		metadata: { startChar: 0, endChar: 11, tokenEstimate: 3 },
		embedding: { values: [0.1, 0.2, 0.3], dimensions: 3 },
		...overrides,
	}
}

function makeEmbedding(values = [0.1, 0.2, 0.3]): EmbeddingVector {
	return { values, dimensions: values.length }
}

function setupStore(tableName = 'vector_chunks', dimensions = 3) {
	return createPgVectorStore({
		connectionString: 'postgresql://localhost:5432/test',
		tableName,
		dimensions,
	})
}

// ─── Setup ───────────────────────────────────────────────────────

const mockPgClient = {
	connect: mockConnect,
	query: mockQuery,
	end: mockEnd,
}

beforeEach(() => {
	vi.clearAllMocks()
	mockConnect.mockResolvedValue(undefined)
	mockEnd.mockResolvedValue(undefined)
	mockQuery.mockResolvedValue({ rows: [] })
	MockPgClientConstructor.mockImplementation(() => mockPgClient)
})

// ─── createPgVectorStore — validation ────────────────────────────

describe('createPgVectorStore — config validation', () => {
	it('throws for invalid table name format (spaces)', () => {
		expect(() =>
			createPgVectorStore({ connectionString: 'pg://localhost', tableName: 'bad name' }),
		).toThrow('Invalid table name format')
	})

	it('throws for table name with SQL injection characters', () => {
		expect(() =>
			createPgVectorStore({
				connectionString: 'pg://localhost',
				tableName: 'foo; DROP TABLE bar',
			}),
		).toThrow('Invalid table name format')
	})

	it('throws when tableName is "__proto__"', () => {
		expect(() =>
			createPgVectorStore({ connectionString: 'pg://localhost', tableName: '__proto__' }),
		).toThrow('Invalid table name')
	})

	it('throws when tableName is "constructor"', () => {
		expect(() =>
			createPgVectorStore({ connectionString: 'pg://localhost', tableName: 'constructor' }),
		).toThrow('Invalid table name')
	})

	it('throws when tableName is "prototype"', () => {
		expect(() =>
			createPgVectorStore({ connectionString: 'pg://localhost', tableName: 'prototype' }),
		).toThrow('Invalid table name')
	})

	it('accepts valid table names with underscores and numbers', () => {
		expect(() =>
			createPgVectorStore({
				connectionString: 'pg://localhost',
				tableName: 'my_table_v2',
			}),
		).not.toThrow()
	})

	it('store name is "pgvector"', () => {
		const store = createPgVectorStore({ connectionString: 'pg://localhost' })
		expect(store.name).toBe('pgvector')
	})
})

// ─── upsert ──────────────────────────────────────────────────────

describe('upsert', () => {
	it('inserts a chunk using parameterized query', async () => {
		const store = setupStore()
		const chunk = makeChunk()

		await store.upsert([chunk])

		// First two calls are CREATE EXTENSION and CREATE TABLE — find the INSERT call
		const insertCall = mockQuery.mock.calls.find(([sql]: [string]) => sql.includes('INSERT INTO'))
		expect(insertCall).toBeDefined()
		const [sql, params] = insertCall

		// Verify parameterized — uses $1..$6, not string interpolation
		expect(sql).toContain('$1')
		expect(sql).toContain('$2')
		expect(params).toContain('chunk_1')
		expect(params).toContain('Hello world')
		expect(params).toContain('doc_1')
	})

	it('uses ON CONFLICT DO UPDATE for upsert semantics', async () => {
		const store = setupStore()
		await store.upsert([makeChunk()])

		const insertCall = mockQuery.mock.calls.find(([sql]: [string]) => sql.includes('INSERT INTO'))
		const [sql] = insertCall
		expect(sql).toContain('ON CONFLICT')
		expect(sql).toContain('DO UPDATE SET')
	})

	it('skips chunks whose id is a prototype-pollution key', async () => {
		const store = setupStore()
		const evilChunk = makeChunk({ id: '__proto__' })

		await store.upsert([evilChunk])

		const insertCall = mockQuery.mock.calls.find(([sql]: [string]) => sql.includes('INSERT INTO'))
		expect(insertCall).toBeUndefined()
	})

	it('upserts multiple chunks in sequence', async () => {
		const store = setupStore()
		const chunks = [makeChunk({ id: 'c1' }), makeChunk({ id: 'c2' }), makeChunk({ id: 'c3' })]

		await store.upsert(chunks)

		const insertCalls = mockQuery.mock.calls.filter(([sql]: [string]) =>
			sql.includes('INSERT INTO'),
		)
		expect(insertCalls).toHaveLength(3)
	})

	it('encodes embedding as [v1,v2,...] string for pgvector', async () => {
		const store = setupStore()
		await store.upsert([makeChunk({ embedding: { values: [0.5, 0.25, 0.75], dimensions: 3 } })])

		const insertCall = mockQuery.mock.calls.find(([sql]: [string]) => sql.includes('INSERT INTO'))
		const [, params] = insertCall
		expect(params[5]).toBe('[0.5,0.25,0.75]')
	})

	it('initialises the extension and table only once across multiple calls', async () => {
		const store = setupStore()
		await store.upsert([makeChunk({ id: 'a' })])
		await store.upsert([makeChunk({ id: 'b' })])

		const extensionCalls = mockQuery.mock.calls.filter(([sql]: [string]) =>
			sql.includes('CREATE EXTENSION'),
		)
		expect(extensionCalls).toHaveLength(1)
	})
})

// ─── query ────────────────────────────────────────────────────────

describe('query', () => {
	it('calls SELECT with parameterized embedding and topK', async () => {
		const store = setupStore()
		mockQuery.mockResolvedValue({ rows: [] })

		await store.query(makeEmbedding(), { topK: 3 })

		const selectCall = mockQuery.mock.calls.find(([sql]: [string]) => sql.includes('SELECT'))
		expect(selectCall).toBeDefined()
		const [sql, params] = selectCall

		// Parameterized — no string interpolation of user values
		expect(sql).toContain('$1')
		expect(sql).toContain('$2')
		expect(sql).toContain('$3')
		expect(params[0]).toBe('[0.1,0.2,0.3]')
		expect(params[2]).toBe(3)
	})

	it('defaults topK to 5 when not specified', async () => {
		const store = setupStore()
		mockQuery.mockResolvedValue({ rows: [] })

		await store.query(makeEmbedding())

		const selectCall = mockQuery.mock.calls.find(([sql]: [string]) => sql.includes('SELECT'))
		const [, params] = selectCall
		expect(params[2]).toBe(5)
	})

	it('applies minScore filter via parameterized query', async () => {
		const store = setupStore()
		mockQuery.mockResolvedValue({ rows: [] })

		await store.query(makeEmbedding(), { minScore: 0.8 })

		const selectCall = mockQuery.mock.calls.find(([sql]: [string]) => sql.includes('SELECT'))
		const [, params] = selectCall
		expect(params[1]).toBe(0.8)
	})

	it('maps returned rows to RetrievalResult shape', async () => {
		const store = setupStore()
		mockQuery.mockImplementation(async (sql: string) => {
			if (sql.includes('SELECT')) {
				return {
					rows: [
						{
							id: 'chunk_1',
							content: 'Result content',
							document_id: 'doc_1',
							chunk_index: 0,
							metadata: { startChar: 0, endChar: 10, tokenEstimate: 5 },
							score: 0.92,
						},
					],
				}
			}
			return { rows: [] }
		})

		const results = await store.query(makeEmbedding())

		expect(results).toHaveLength(1)
		expect(results[0].chunk.id).toBe('chunk_1')
		expect(results[0].chunk.content).toBe('Result content')
		expect(results[0].chunk.documentId).toBe('doc_1')
		expect(results[0].score).toBe(0.92)
		expect(results[0].distance).toBeCloseTo(0.08)
	})

	it('returns empty array when no rows match', async () => {
		const store = setupStore()
		mockQuery.mockResolvedValue({ rows: [] })

		const results = await store.query(makeEmbedding())

		expect(results).toHaveLength(0)
	})
})

// ─── delete ───────────────────────────────────────────────────────

describe('delete', () => {
	it('deletes by ids using parameterized placeholders', async () => {
		const store = setupStore()

		await store.delete(['chunk_1', 'chunk_2'])

		const deleteCall = mockQuery.mock.calls.find(([sql]: [string]) => sql.includes('DELETE'))
		expect(deleteCall).toBeDefined()
		const [sql, params] = deleteCall

		expect(sql).toContain('$1')
		expect(sql).toContain('$2')
		expect(params).toContain('chunk_1')
		expect(params).toContain('chunk_2')
	})

	it('generates correct number of placeholders for N ids', async () => {
		const store = setupStore()
		await store.delete(['a', 'b', 'c'])

		const deleteCall = mockQuery.mock.calls.find(([sql]: [string]) => sql.includes('DELETE'))
		const [sql] = deleteCall
		expect(sql).toContain('$3')
		expect(sql).not.toContain('$4')
	})

	it('filters out prototype-pollution ids and deletes valid ones', async () => {
		const store = setupStore()

		await store.delete(['good_id', '__proto__', 'another_good'])

		const deleteCall = mockQuery.mock.calls.find(([sql]: [string]) => sql.includes('DELETE'))
		const [, params] = deleteCall
		expect(params).toContain('good_id')
		expect(params).toContain('another_good')
		expect(params).not.toContain('__proto__')
	})

	it('does not execute DELETE when all ids are prototype-pollution keys', async () => {
		const store = setupStore()
		// Initialise the store first by calling count
		await store.count()
		vi.clearAllMocks()
		mockQuery.mockResolvedValue({ rows: [{ count: 0 }] })

		await store.delete(['__proto__', 'constructor', 'prototype'])

		const deleteCall = mockQuery.mock.calls.find(([sql]: [string]) => sql?.includes('DELETE'))
		expect(deleteCall).toBeUndefined()
	})

	it('does nothing when ids array is empty', async () => {
		const store = setupStore()
		// Initialise first
		await store.count()
		vi.clearAllMocks()
		mockQuery.mockResolvedValue({ rows: [{ count: 0 }] })

		await store.delete([])

		const deleteCall = mockQuery.mock.calls.find(([sql]: [string]) => sql?.includes('DELETE'))
		expect(deleteCall).toBeUndefined()
	})
})

// ─── clear ────────────────────────────────────────────────────────

describe('clear', () => {
	it('issues DELETE FROM <tableName> with no parameters', async () => {
		const store = setupStore()

		await store.clear()

		const deleteCall = mockQuery.mock.calls.find(([sql]: [string]) =>
			sql.includes('DELETE FROM vector_chunks'),
		)
		expect(deleteCall).toBeDefined()
		const [, params] = deleteCall
		expect(params).toBeUndefined()
	})

	it('uses the configured table name', async () => {
		const store = setupStore('my_embeddings')

		await store.clear()

		const deleteCall = mockQuery.mock.calls.find(([sql]: [string]) =>
			sql.includes('DELETE FROM my_embeddings'),
		)
		expect(deleteCall).toBeDefined()
	})
})

// ─── count ────────────────────────────────────────────────────────

describe('count', () => {
	it('returns the integer count from SELECT COUNT(*)', async () => {
		const store = setupStore()
		mockQuery.mockImplementation(async (sql: string) => {
			if (sql.includes('COUNT')) return { rows: [{ count: 42 }] }
			return { rows: [] }
		})

		const result = await store.count()

		expect(result).toBe(42)
	})

	it('returns 0 when the table is empty', async () => {
		const store = setupStore()
		mockQuery.mockImplementation(async (sql: string) => {
			if (sql.includes('COUNT')) return { rows: [{ count: 0 }] }
			return { rows: [] }
		})

		const result = await store.count()

		expect(result).toBe(0)
	})

	it('returns 0 when query returns no rows', async () => {
		const store = setupStore()
		mockQuery.mockImplementation(async (sql: string) => {
			if (sql.includes('COUNT')) return { rows: [] }
			return { rows: [] }
		})

		const result = await store.count()

		expect(result).toBe(0)
	})
})

// ─── Parameterized query safety ───────────────────────────────────

describe('SQL injection safety', () => {
	it('does not interpolate user-supplied chunk content into query string', async () => {
		const store = setupStore()
		const maliciousChunk = makeChunk({
			id: 'safe_id',
			content: "'; DROP TABLE vector_chunks; --",
		})

		await store.upsert([maliciousChunk])

		const insertCall = mockQuery.mock.calls.find(([sql]: [string]) => sql.includes('INSERT INTO'))
		const [sql, params] = insertCall

		// The SQL template must never contain the raw malicious string
		expect(sql).not.toContain('DROP TABLE')
		// But it must be safely passed as a parameter
		expect(params).toContain("'; DROP TABLE vector_chunks; --")
	})

	it('does not interpolate document_id into query string', async () => {
		const store = setupStore()
		const chunk = makeChunk({ documentId: "'; TRUNCATE vector_chunks; --" })

		await store.upsert([chunk])

		const insertCall = mockQuery.mock.calls.find(([sql]: [string]) => sql.includes('INSERT INTO'))
		const [sql, params] = insertCall
		expect(sql).not.toContain('TRUNCATE')
		expect(params).toContain("'; TRUNCATE vector_chunks; --")
	})

	it('passes embedding values through params for query(), not as string interpolation', async () => {
		const store = setupStore()
		mockQuery.mockResolvedValue({ rows: [] })

		const embedding: EmbeddingVector = { values: [0.1, 0.9], dimensions: 2 }
		await store.query(embedding)

		const selectCall = mockQuery.mock.calls.find(([sql]: [string]) => sql.includes('SELECT'))
		const [, params] = selectCall
		// Embedding string is passed as the first parameter
		expect(params[0]).toBe('[0.1,0.9]')
	})

	it('does not interpolate delete ids into query string', async () => {
		const store = setupStore()
		const maliciousId = "1'; DROP TABLE vector_chunks; --"

		await store.delete([maliciousId])

		const deleteCall = mockQuery.mock.calls.find(([sql]: [string]) => sql.includes('DELETE'))
		const [sql, params] = deleteCall
		expect(sql).not.toContain('DROP TABLE')
		expect(params).toContain(maliciousId)
	})
})
