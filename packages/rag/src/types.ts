// ─── Documents ───────────────────────────────────────────────────

export interface Document {
	id: string
	content: string
	metadata: DocumentMetadata
}

export interface DocumentMetadata {
	source: string
	type: string
	title?: string
	language?: string
	createdAt?: string
	[key: string]: unknown
}

// ─── Chunks ──────────────────────────────────────────────────────

export interface Chunk {
	id: string
	content: string
	documentId: string
	index: number
	metadata: ChunkMetadata
}

export interface ChunkMetadata {
	startChar: number
	endChar: number
	tokenEstimate: number
	[key: string]: unknown
}

// ─── Embeddings ──────────────────────────────────────────────────

export interface EmbeddingVector {
	values: number[]
	dimensions: number
}

export interface EmbeddedChunk extends Chunk {
	embedding: EmbeddingVector
}

// ─── Retrieval ───────────────────────────────────────────────────

export interface RetrievalResult {
	chunk: Chunk
	score: number
	distance: number
}

export interface QueryOptions {
	topK?: number
	minScore?: number
	filter?: Record<string, unknown>
}

// ─── Provider Configs ────────────────────────────────────────────

export type LoaderType = 'text' | 'markdown' | 'html' | 'json' | 'csv'

export type ChunkingStrategy = 'fixed-size' | 'recursive' | 'sentence'

export interface ChunkingConfig {
	strategy: ChunkingStrategy
	maxChunkSize?: number
	overlap?: number
	separator?: string
}

export interface EmbeddingConfig {
	provider: string
	model?: string
	apiKey?: string
	baseUrl?: string
	dimensions?: number
	batchSize?: number
}

export interface VectorStoreConfig {
	provider: string
	connectionString?: string
	tableName?: string
	dimensions?: number
}

export interface RetrievalConfig {
	topK?: number
	minScore?: number
	strategy?: 'similarity' | 'mmr'
	mmrLambda?: number
}
