# elsium-ai/rag

Retrieval Augmented Generation module providing document loading, chunking, embedding, vector storage, search, and a unified RAG pipeline.

```ts
import { rag, textLoader, fixedSizeChunker, createOpenAIEmbeddings } from '@elsium-ai/rag'
```

---

## Document Loaders

Load raw content into structured `Document` objects.

| Export | Signature | Description |
|---|---|---|
| `textLoader` | `textLoader(): DocumentLoader` | Plain text documents |
| `markdownLoader` | `markdownLoader(): DocumentLoader` | Markdown with frontmatter extraction |
| `htmlLoader` | `htmlLoader(): DocumentLoader` | HTML with tag stripping |
| `jsonLoader` | `jsonLoader(opts?): DocumentLoader` | JSON documents with configurable content/metadata fields |
| `csvLoader` | `csvLoader(opts?): DocumentLoader` | CSV with row-per-document splitting |
| `pdfLoader` | `pdfLoader(opts?): BinaryDocumentLoader` | PDF documents (requires the `pdf-parse` peer dependency) |
| `getLoader` | `getLoader(type: LoaderType): DocumentLoader` | Get a loader by type name |

**LoaderType:** `'text'` | `'markdown'` | `'html'` | `'json'` | `'csv'` | `'pdf'`

### DocumentLoader Interface

```ts
interface DocumentLoader {
  load(source: string, content: string): Document
}
```

### BinaryDocumentLoader Interface

`pdfLoader` reads binary data asynchronously rather than a string, so it implements a separate interface.

```ts
interface BinaryDocumentLoader {
  load(source: string, data: Buffer | Uint8Array): Promise<Document>
}
```

### Options

```ts
// JSON loader options
jsonLoader({
  contentField?: string,       // Field to use as document content
  metadataFields?: string[],   // Fields to extract as metadata
})

// CSV loader options
csvLoader({
  separator?: string,          // Column separator (default: ',')
  contentColumns?: string[],   // Columns to include in content
})

// PDF loader options
pdfLoader({
  maxPages?: number,           // Truncate to the first N pages
  pageBreakMarker?: string,    // Separator inserted between pages (default: '\n\n---\n\n')
})
```

### Example

```ts
import { markdownLoader, jsonLoader, pdfLoader } from '@elsium-ai/rag'

const md = markdownLoader()
const doc = md.load('README.md', '# Title\nSome content...')
// => { id, content, metadata: { source: 'README.md', type: 'markdown', ... } }

const json = jsonLoader({ contentField: 'body' })
const doc2 = json.load('data.json', '{"body": "Hello", "author": "Alice"}')

// PDF loading is async and takes binary data
const pdf = pdfLoader({ maxPages: 50 })
const doc3 = await pdf.load('report.pdf', await readFile('report.pdf'))
// => { id, content, metadata: { source: 'report.pdf', type: 'pdf', title?, pageCount } }
```

---

## Chunking

Split documents into smaller chunks for embedding and retrieval.

| Export | Signature | Description |
|---|---|---|
| `fixedSizeChunker` | `fixedSizeChunker(opts?): Chunker` | Fixed character size chunks with optional overlap |
| `recursiveChunker` | `recursiveChunker(opts?): Chunker` | Recursive splitting by separators |
| `sentenceChunker` | `sentenceChunker(opts?): Chunker` | Sentence-boundary chunking |
| `getChunker` | `getChunker(config: ChunkingConfig): Chunker` | Get a chunker from config |

### Chunker Interface

```ts
interface Chunker {
  chunk(document: Document): Chunk[]
}
```

### Options

```ts
// All chunkers accept:
{
  maxChunkSize?: number,  // Max characters per chunk
  overlap?: number,       // Overlap between consecutive chunks
}

// recursiveChunker additionally accepts:
{
  separators?: string[],  // Ordered list of separators to split on
}
```

### ChunkingConfig

```ts
interface ChunkingConfig {
  strategy: 'fixed-size' | 'recursive' | 'sentence'
  maxChunkSize?: number
  overlap?: number
  separator?: string
}
```

### Example

```ts
import { recursiveChunker } from '@elsium-ai/rag'

const chunker = recursiveChunker({ maxChunkSize: 500, overlap: 50 })
const chunks = chunker.chunk(document)
// => [{ id, content, documentId, index, metadata: { startChar, endChar, tokenEstimate } }, ...]
```

---

## Embeddings

Generate vector embeddings from text.

| Export | Signature | Description |
|---|---|---|
| `createOpenAIEmbeddings` | `createOpenAIEmbeddings(config: EmbeddingConfig): EmbeddingProvider` | OpenAI text-embedding-3-small/large |
| `createGoogleEmbeddings` | `createGoogleEmbeddings(config: GoogleEmbeddingsConfig): EmbeddingProvider` | Google Generative AI embeddings (default `text-embedding-004`, 768 dims) |
| `createCohereEmbeddings` | `createCohereEmbeddings(config: CohereEmbeddingsConfig): EmbeddingProvider` | Cohere embeddings (default `embed-v4.0`, 1024 dims) |
| `createMockEmbeddings` | `createMockEmbeddings(dims?: number): EmbeddingProvider` | Deterministic mock for testing |
| `getEmbeddingProvider` | `getEmbeddingProvider(config: EmbeddingConfig): EmbeddingProvider` | Get provider from config |

The `google` and `cohere` providers auto-register on import, so they can also be selected by name through `getEmbeddingProvider` / the pipeline `embeddings.provider` field.

### EmbeddingProvider Interface

```ts
interface EmbeddingProvider {
  readonly name: string
  readonly dimensions: number
  embed(text: string): Promise<EmbeddingVector>
  embedBatch(texts: string[]): Promise<EmbeddingVector[]>
}
```

### EmbeddingConfig

```ts
interface EmbeddingConfig {
  provider: string       // 'openai', 'mock', etc.
  model?: string         // e.g. 'text-embedding-3-small'
  apiKey?: string
  baseUrl?: string
  dimensions?: number
  batchSize?: number
}
```

### GoogleEmbeddingsConfig

```ts
interface GoogleEmbeddingsConfig {
  apiKey: string         // required
  model?: string         // default: 'text-embedding-004'
  dimensions?: number    // default: 768 (sent as outputDimensionality)
}
```

### CohereEmbeddingsConfig

```ts
interface CohereEmbeddingsConfig {
  apiKey: string         // required
  model?: string         // default: 'embed-v4.0'
  inputType?: string     // default: 'search_document'
}
```

### Example

```ts
import {
  createOpenAIEmbeddings,
  createGoogleEmbeddings,
  createCohereEmbeddings,
  createMockEmbeddings,
} from '@elsium-ai/rag'

// Production
const embeddings = createOpenAIEmbeddings({
  provider: 'openai',
  apiKey: process.env.OPENAI_API_KEY,
  model: 'text-embedding-3-small',
})

const vector = await embeddings.embed('Hello world')
// => { values: [0.012, -0.034, ...], dimensions: 1536 }

// Google
const google = createGoogleEmbeddings({ apiKey: process.env.GOOGLE_API_KEY })

// Cohere
const cohere = createCohereEmbeddings({ apiKey: process.env.COHERE_API_KEY })

// Testing
const mock = createMockEmbeddings(256)
const vectors = await mock.embedBatch(['Hello', 'World'])
```

---

## Vector Stores

Store and query embedded chunks.

| Export | Signature | Description |
|---|---|---|
| `createInMemoryStore` | `createInMemoryStore(opts?): VectorStore` | In-memory store with optional max chunk cap |
| `createPgVectorStore` | `createPgVectorStore(config: PgVectorStoreConfig): VectorStore` | PostgreSQL + `pgvector` store (requires the `pg` peer dependency) |
| `createQdrantStore` | `createQdrantStore(config: QdrantStoreConfig): VectorStore` | Qdrant store over its HTTP API |
| `cosineSimilarity` | `cosineSimilarity(a: number[], b: number[]): number` | Cosine similarity between two vectors |
| `mmrRerank` | `mmrRerank(queryEmbedding, results, opts?): RetrievalResult[]` | Maximal marginal relevance reranking |

The `qdrant` store auto-registers on import and can be selected by name through `vectorStoreRegistry` / the pipeline `store.provider` field.

### VectorStore Interface

```ts
interface VectorStore {
  readonly name: string
  upsert(chunks: EmbeddedChunk[]): Promise<void>
  query(embedding: EmbeddingVector, options?: QueryOptions): Promise<RetrievalResult[]>
  delete(ids: string[]): Promise<void>
  clear(): Promise<void>
  count(): Promise<number>
}
```

### Options

```ts
// In-memory store options
createInMemoryStore({
  maxChunks?: number,  // Max stored chunks (FIFO eviction when exceeded)
})

// MMR rerank options
mmrRerank(queryEmbedding, results, {
  topK?: number,    // Number of results to return
  lambda?: number,  // Balance relevance vs diversity (0-1, default 0.7)
})
```

### PgVectorStoreConfig

```ts
interface PgVectorStoreConfig {
  connectionString: string   // required
  tableName?: string         // default: 'vector_chunks' (validated identifier)
  dimensions?: number        // default: 1536
}
```

### QdrantStoreConfig

```ts
interface QdrantStoreConfig {
  url: string                // required
  apiKey?: string
  collectionName: string     // required
  dimensions: number         // required
}
```

### Example

```ts
import {
  createInMemoryStore,
  createPgVectorStore,
  createQdrantStore,
  cosineSimilarity,
} from '@elsium-ai/rag'

const store = createInMemoryStore({ maxChunks: 10000 })
await store.upsert(embeddedChunks)

const results = await store.query(queryEmbedding, { topK: 5, minScore: 0.7 })
// => [{ chunk, score, distance }, ...]

// PostgreSQL + pgvector
const pg = createPgVectorStore({
  connectionString: process.env.DATABASE_URL,
  tableName: 'doc_chunks',
  dimensions: 1536,
})

// Qdrant
const qdrant = createQdrantStore({
  url: 'http://localhost:6333',
  collectionName: 'documents',
  dimensions: 1536,
})

// Direct similarity
const sim = cosineSimilarity([1, 0, 0], [0.9, 0.1, 0])
```

---

## Pipeline

Unified RAG pipeline combining loading, chunking, embedding, storage, and retrieval.

| Export | Signature | Description |
|---|---|---|
| `rag` | `rag(config: RAGPipelineConfig): RAGPipeline` | Create a complete RAG pipeline |

### RAGPipelineConfig

```ts
interface RAGPipelineConfig {
  loader?: LoaderType                 // Document loader type
  chunking?: ChunkingConfig           // Chunking strategy and options
  embeddings: EmbeddingConfig         // Embedding provider config (required)
  store?: VectorStoreConfig           // Vector store config
  retrieval?: RetrievalConfig         // Query-time options
}
```

### RAGPipeline Interface

```ts
interface RAGPipeline {
  ingest(source: string, content: string): Promise<IngestResult>
  ingestDocument(document: Document): Promise<IngestResult>
  query(text: string, options?: QueryOptions): Promise<RetrievalResult[]>
  clear(): Promise<void>
  count(): Promise<number>
  readonly embeddingProvider: EmbeddingProvider
  readonly vectorStore: VectorStore
}
```

### IngestResult

```ts
interface IngestResult {
  documentId: string
  chunkCount: number
  totalTokens: number
}
```

### RetrievalConfig

```ts
interface RetrievalConfig {
  topK?: number
  minScore?: number
  strategy?: 'similarity' | 'mmr'
  mmrLambda?: number
}
```

### Example

```ts
import { rag } from '@elsium-ai/rag'

const pipeline = rag({
  loader: 'markdown',
  chunking: { strategy: 'recursive', maxChunkSize: 500, overlap: 50 },
  embeddings: { provider: 'openai', apiKey: process.env.OPENAI_API_KEY },
  retrieval: { topK: 5, strategy: 'mmr', mmrLambda: 0.7 },
})

// Ingest documents
const result = await pipeline.ingest('docs/guide.md', markdownContent)
// => { documentId: '...', chunkCount: 12, totalTokens: 3400 }

// Query
const results = await pipeline.query('How do I configure providers?')
for (const { chunk, score } of results) {
  console.log(`[${score.toFixed(2)}] ${chunk.content.slice(0, 100)}...`)
}
```

---

## Keyword Search (BM25)

In-memory lexical index using Okapi BM25 scoring, for keyword-based retrieval over chunks.

| Export | Signature | Description |
|---|---|---|
| `createBM25Index` | `createBM25Index(opts?): BM25Index` | Create a BM25 keyword index |

### BM25Index Interface

```ts
interface BM25Index {
  index(chunks: Chunk[]): void
  search(query: string, topK?: number): RetrievalResult[]  // topK default: 5
}
```

### Options

```ts
createBM25Index({
  k1?: number,  // Term-frequency saturation (default: 1.2)
  b?: number,   // Length normalization (default: 0.75)
})
```

### Example

```ts
import { createBM25Index } from '@elsium-ai/rag'

const bm25 = createBM25Index()
bm25.index(chunks)
const results = bm25.search('vector database', 5)
// => [{ chunk, score, distance: 0 }, ...]
```

---

## Hybrid Search

Combine dense vector retrieval with BM25 keyword retrieval using Reciprocal Rank Fusion (RRF).

| Export | Signature | Description |
|---|---|---|
| `createHybridSearch` | `createHybridSearch(vectorStore: VectorStore, bm25Index: BM25Index, config?: HybridSearchConfig): HybridSearch` | Fuse vector and BM25 results via RRF |

### HybridSearch Interface

```ts
interface HybridSearch {
  search(
    query: string,
    queryEmbedding: EmbeddingVector,
    topK?: number,
  ): Promise<RetrievalResult[]>
}
```

### HybridSearchConfig

```ts
interface HybridSearchConfig {
  k?: number             // RRF rank constant (default: 60)
  vectorWeight?: number  // Weight for vector results (default: 1)
  bm25Weight?: number    // Weight for BM25 results (default: 1)
  topK?: number          // Default result count (default: 10)
}
```

### Example

```ts
import { createHybridSearch, createBM25Index, createInMemoryStore } from '@elsium-ai/rag'

const hybrid = createHybridSearch(vectorStore, bm25Index, {
  vectorWeight: 1,
  bm25Weight: 1,
})

const results = await hybrid.search('how to configure providers', queryEmbedding, 5)
```

---

## Registries

Global registries let custom embedding providers and vector stores be selected by name (the built-in `google`, `cohere`, and `qdrant` integrations auto-register themselves).

| Export | Type | Description |
|---|---|---|
| `embeddingProviderRegistry` | `Registry<EmbeddingProviderFactory>` | Name-keyed embedding provider factories |
| `vectorStoreRegistry` | `Registry<VectorStoreFactory>` | Name-keyed vector store factories |

```ts
interface Registry<T> {
  register(name: string, factory: T): void
  get(name: string): T | undefined
  list(): string[]
}

type EmbeddingProviderFactory = (config: EmbeddingConfig) => EmbeddingProvider
type VectorStoreFactory = (config: Record<string, unknown>) => VectorStore
```

### Example

```ts
import { embeddingProviderRegistry, vectorStoreRegistry } from '@elsium-ai/rag'

embeddingProviderRegistry.register('my-provider', (config) => createMyEmbeddings(config))
embeddingProviderRegistry.list() // => ['google', 'cohere', 'my-provider']
```

---

## Types

| Export | Description |
|---|---|
| `Document` | Loaded document with `id`, `content`, `metadata` |
| `DocumentMetadata` | Metadata: `source`, `type`, optional `title`, `language`, `createdAt` |
| `Chunk` | Document chunk with `id`, `content`, `documentId`, `index`, `metadata` |
| `ChunkMetadata` | Chunk metadata: `startChar`, `endChar`, `tokenEstimate` |
| `EmbeddingVector` | Vector with `values: number[]` and `dimensions: number` |
| `EmbeddedChunk` | Chunk extended with `embedding: EmbeddingVector` |
| `RetrievalResult` | Query result with `chunk`, `score`, `distance` |
| `QueryOptions` | Query options: `topK?`, `minScore?`, `filter?` |
| `LoaderType` | `'text'` \| `'markdown'` \| `'html'` \| `'json'` \| `'csv'` \| `'pdf'` |
| `ChunkingStrategy` | `'fixed-size'` \| `'recursive'` \| `'sentence'` |
| `ChunkingConfig` | Chunking configuration |
| `EmbeddingConfig` | Embedding provider configuration |
| `VectorStoreConfig` | Vector store configuration |
| `RetrievalConfig` | Retrieval strategy configuration |
| `DocumentLoader` | Loader interface: `load(source, content)` |
| `BinaryDocumentLoader` | Async binary loader interface: `load(source, data)` (used by `pdfLoader`) |
| `PdfLoaderOptions` | PDF loader options: `maxPages?`, `pageBreakMarker?` |
| `Chunker` | Chunker interface: `chunk(document)` |
| `EmbeddingProvider` | Embedding provider interface |
| `EmbeddingProviderFactory` | `(config: EmbeddingConfig) => EmbeddingProvider` |
| `GoogleEmbeddingsConfig` | Google embeddings configuration |
| `CohereEmbeddingsConfig` | Cohere embeddings configuration |
| `VectorStore` | Vector store interface |
| `VectorStoreFactory` | `(config: Record<string, unknown>) => VectorStore` |
| `PgVectorStoreConfig` | PostgreSQL + pgvector store configuration |
| `QdrantStoreConfig` | Qdrant store configuration |
| `BM25Index` | BM25 keyword index interface |
| `HybridSearch` | Hybrid search interface |
| `HybridSearchConfig` | Hybrid (RRF) search configuration |
| `RAGPipeline` | Pipeline interface |
| `RAGPipelineConfig` | Pipeline configuration |
| `IngestResult` | Ingestion result |
