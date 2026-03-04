import { createRequire } from 'node:module'
import { createLogger } from '@elsium-ai/core'

const require = createRequire(import.meta.url)
import type {
	ChunkMetadata,
	EmbeddedChunk,
	EmbeddingVector,
	QueryOptions,
	RetrievalResult,
} from '../types'
import type { VectorStore } from '../vectorstore'

const log = createLogger()

const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const TABLE_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/

export interface PgVectorStoreConfig {
	connectionString: string
	tableName?: string
	dimensions?: number
}

interface PgClient {
	query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
	end(): Promise<void>
}

export function createPgVectorStore(config: PgVectorStoreConfig): VectorStore {
	const { connectionString, tableName = 'vector_chunks', dimensions = 1536 } = config

	if (BLOCKED_KEYS.has(tableName)) {
		throw new Error(`Invalid table name: ${tableName}`)
	}
	if (!TABLE_NAME_PATTERN.test(tableName)) {
		throw new Error(`Invalid table name format: ${tableName}`)
	}

	let client: PgClient | null = null
	let initialized = false

	async function getClient(): Promise<PgClient> {
		if (client) return client

		try {
			// Dynamic require of pg (optional peer dependency)
			const pg = require('pg') as { Client: new (config: { connectionString: string }) => PgClient }
			client = new pg.Client({ connectionString }) as PgClient
			await (client as unknown as { connect(): Promise<void> }).connect()

			if (!initialized) {
				await client.query('CREATE EXTENSION IF NOT EXISTS vector')
				await client.query(`
					CREATE TABLE IF NOT EXISTS ${tableName} (
						id TEXT PRIMARY KEY,
						content TEXT NOT NULL,
						document_id TEXT NOT NULL,
						chunk_index INTEGER NOT NULL,
						metadata JSONB DEFAULT '{}',
						embedding vector(${dimensions})
					)
				`)
				initialized = true
			}

			return client
		} catch (err) {
			log.error('Failed to initialize PgVector store', {
				error: err instanceof Error ? err.message : String(err),
			})
			throw new Error('pg is required for PgVector store. Install it as a dependency.')
		}
	}

	return {
		name: 'pgvector',

		async upsert(chunks: EmbeddedChunk[]): Promise<void> {
			const pg = await getClient()

			for (const chunk of chunks) {
				if (BLOCKED_KEYS.has(chunk.id)) continue

				const embedding = `[${chunk.embedding.values.join(',')}]`
				await pg.query(
					`INSERT INTO ${tableName} (id, content, document_id, chunk_index, metadata, embedding)
					 VALUES ($1, $2, $3, $4, $5, $6)
					 ON CONFLICT (id) DO UPDATE SET
						content = EXCLUDED.content,
						document_id = EXCLUDED.document_id,
						chunk_index = EXCLUDED.chunk_index,
						metadata = EXCLUDED.metadata,
						embedding = EXCLUDED.embedding`,
					[
						chunk.id,
						chunk.content,
						chunk.documentId,
						chunk.index,
						JSON.stringify(chunk.metadata),
						embedding,
					],
				)
			}
		},

		async query(embedding: EmbeddingVector, options?: QueryOptions): Promise<RetrievalResult[]> {
			const pg = await getClient()
			const topK = options?.topK ?? 5
			const minScore = options?.minScore ?? 0

			const embeddingStr = `[${embedding.values.join(',')}]`

			const result = await pg.query(
				`SELECT id, content, document_id, chunk_index, metadata,
								1 - (embedding <=> $1::vector) as score
				 FROM ${tableName}
				 WHERE 1 - (embedding <=> $1::vector) >= $2
				 ORDER BY embedding <=> $1::vector
				 LIMIT $3`,
				[embeddingStr, minScore, topK],
			)

			return result.rows.map((row) => ({
				chunk: {
					id: row.id as string,
					content: row.content as string,
					documentId: row.document_id as string,
					index: row.chunk_index as number,
					metadata: {
						startChar: 0,
						endChar: 0,
						tokenEstimate: 0,
						...((row.metadata as Record<string, unknown>) ?? {}),
					} as ChunkMetadata,
				},
				score: row.score as number,
				distance: 1 - (row.score as number),
			}))
		},

		async delete(ids: string[]): Promise<void> {
			const pg = await getClient()
			const filtered = ids.filter((id) => !BLOCKED_KEYS.has(id))
			if (filtered.length === 0) return

			const placeholders = filtered.map((_, i) => `$${i + 1}`).join(', ')
			await pg.query(`DELETE FROM ${tableName} WHERE id IN (${placeholders})`, filtered)
		},

		async clear(): Promise<void> {
			const pg = await getClient()
			await pg.query(`DELETE FROM ${tableName}`)
		},

		async count(): Promise<number> {
			const pg = await getClient()
			const result = await pg.query(`SELECT COUNT(*)::int as count FROM ${tableName}`)
			return (result.rows[0]?.count as number) ?? 0
		},
	}
}
