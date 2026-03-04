// Types
export type {
	Document,
	DocumentMetadata,
	Chunk,
	ChunkMetadata,
	EmbeddingVector,
	EmbeddedChunk,
	RetrievalResult,
	QueryOptions,
	LoaderType,
	ChunkingStrategy,
	ChunkingConfig,
	EmbeddingConfig,
	VectorStoreConfig,
	RetrievalConfig,
} from './types'

// Loaders
export {
	textLoader,
	markdownLoader,
	htmlLoader,
	jsonLoader,
	csvLoader,
	getLoader,
} from './loaders'
export type { DocumentLoader } from './loaders'

// Chunkers
export {
	fixedSizeChunker,
	recursiveChunker,
	sentenceChunker,
	getChunker,
} from './chunkers'
export type { Chunker } from './chunkers'

// Embeddings
export {
	createOpenAIEmbeddings,
	createMockEmbeddings,
	getEmbeddingProvider,
	embeddingProviderRegistry,
} from './embeddings'
export type { EmbeddingProvider, EmbeddingProviderFactory } from './embeddings'

// Vector Store
export {
	createInMemoryStore,
	cosineSimilarity,
	mmrRerank,
	vectorStoreRegistry,
} from './vectorstore'
export type { VectorStore, VectorStoreFactory } from './vectorstore'

// Pipeline
export { rag } from './pipeline'
export type { RAGPipeline, RAGPipelineConfig, IngestResult } from './pipeline'

// Stores
export { createPgVectorStore } from './stores/index'
export type { PgVectorStoreConfig } from './stores/index'
export { createQdrantStore } from './stores/index'
export type { QdrantStoreConfig } from './stores/index'

// Embedding Providers
export { createGoogleEmbeddings } from './providers/google-embeddings'
export type { GoogleEmbeddingsConfig } from './providers/google-embeddings'
export { createCohereEmbeddings } from './providers/cohere-embeddings'
export type { CohereEmbeddingsConfig } from './providers/cohere-embeddings'

// BM25
export { createBM25Index } from './bm25'
export type { BM25Index } from './bm25'

// Hybrid Search
export { createHybridSearch } from './hybrid'
export type { HybridSearch, HybridSearchConfig } from './hybrid'
