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
} from './embeddings'
export type { EmbeddingProvider } from './embeddings'

// Vector Store
export {
	createInMemoryStore,
	cosineSimilarity,
	mmrRerank,
} from './vectorstore'
export type { VectorStore } from './vectorstore'

// Pipeline
export { rag } from './pipeline'
export type { RAGPipeline, RAGPipelineConfig, IngestResult } from './pipeline'
