import { getChunker } from './chunkers'
import { type EmbeddingProvider, getEmbeddingProvider } from './embeddings'
import { getLoader } from './loaders'
import type {
	Chunk,
	ChunkingConfig,
	Document,
	EmbeddedChunk,
	EmbeddingConfig,
	LoaderType,
	QueryOptions,
	RetrievalConfig,
	RetrievalResult,
	VectorStoreConfig,
} from './types'
import { type VectorStore, createInMemoryStore, vectorStoreRegistry } from './vectorstore'

export interface RAGPipelineConfig {
	loader?: LoaderType
	chunking?: ChunkingConfig
	embeddings: EmbeddingConfig
	store?: VectorStoreConfig
	retrieval?: RetrievalConfig
}

export interface RAGPipeline {
	ingest(source: string, content: string): Promise<IngestResult>
	ingestDocument(document: Document): Promise<IngestResult>
	query(text: string, options?: QueryOptions): Promise<RetrievalResult[]>
	clear(): Promise<void>
	count(): Promise<number>
	readonly embeddingProvider: EmbeddingProvider
	readonly vectorStore: VectorStore
}

export interface IngestResult {
	documentId: string
	chunkCount: number
	totalTokens: number
}

export function rag(config: RAGPipelineConfig): RAGPipeline {
	const loaderType = config.loader ?? 'text'
	const chunkingConfig: ChunkingConfig = config.chunking ?? {
		strategy: 'recursive',
		maxChunkSize: 512,
		overlap: 50,
	}
	const retrievalConfig: RetrievalConfig = config.retrieval ?? {
		topK: 5,
		minScore: 0,
		strategy: 'similarity',
	}

	const loader = getLoader(loaderType)
	const chunker = getChunker(chunkingConfig)
	const embeddingProvider = getEmbeddingProvider(config.embeddings)

	let vectorStore: VectorStore
	if (config.store) {
		const factory = vectorStoreRegistry.get(config.store.provider)
		if (!factory) {
			throw new Error(
				`Unknown vector store provider: ${config.store.provider}. Register it with vectorStoreRegistry.register().`,
			)
		}
		vectorStore = factory(config.store as unknown as Record<string, unknown>)
	} else {
		vectorStore = createInMemoryStore()
	}

	async function embedChunks(chunks: Chunk[]): Promise<EmbeddedChunk[]> {
		const texts = chunks.map((c) => c.content)
		const embeddings = await embeddingProvider.embedBatch(texts)

		return chunks.map((chunk, i) => ({
			...chunk,
			embedding: embeddings[i],
		}))
	}

	return {
		embeddingProvider,
		vectorStore,

		async ingest(source: string, content: string): Promise<IngestResult> {
			const document = loader.load(source, content)
			return this.ingestDocument(document)
		},

		async ingestDocument(document: Document): Promise<IngestResult> {
			const chunks = chunker.chunk(document)

			if (chunks.length === 0) {
				return { documentId: document.id, chunkCount: 0, totalTokens: 0 }
			}

			const embedded = await embedChunks(chunks)
			await vectorStore.upsert(embedded)

			const totalTokens = chunks.reduce((sum, c) => sum + c.metadata.tokenEstimate, 0)

			return {
				documentId: document.id,
				chunkCount: chunks.length,
				totalTokens,
			}
		},

		async query(text: string, options?: QueryOptions): Promise<RetrievalResult[]> {
			const queryEmbedding = await embeddingProvider.embed(text)

			return vectorStore.query(queryEmbedding, {
				topK: options?.topK ?? retrievalConfig.topK,
				minScore: options?.minScore ?? retrievalConfig.minScore,
				filter: options?.filter,
			})
		},

		async clear(): Promise<void> {
			await vectorStore.clear()
		},

		async count(): Promise<number> {
			return vectorStore.count()
		},
	}
}
