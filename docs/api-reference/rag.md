# elsium-ai/rag

Retrieval Augmented Generation module providing document loading, chunking, embedding, vector storage, search, and a unified RAG pipeline.

```ts
import { rag, textLoader, fixedSizeChunker, createOpenAIEmbeddings } from 'elsium-ai/rag'
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
| `getLoader` | `getLoader(type: LoaderType): DocumentLoader` | Get a loader by type name |

**LoaderType:** `'text'` | `'markdown'` | `'html'` | `'json'` | `'csv'`

### DocumentLoader Interface

```ts
interface DocumentLoader {
  load(source: string, content: string): Document
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
```

### Example

```ts
import { markdownLoader, jsonLoader } from 'elsium-ai/rag'

const md = markdownLoader()
const doc = md.load('README.md', '# Title\nSome content...')
// => { id, content, metadata: { source: 'README.md', type: 'markdown', ... } }

const json = jsonLoader({ contentField: 'body' })
const doc2 = json.load('data.json', '{"body": "Hello", "author": "Alice"}')
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
import { recursiveChunker } from 'elsium-ai/rag'

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
| `createMockEmbeddings` | `createMockEmbeddings(dims?: number): EmbeddingProvider` | Deterministic mock for testing |
| `getEmbeddingProvider` | `getEmbeddingProvider(config: EmbeddingConfig): EmbeddingProvider` | Get provider from config |

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

### Example

```ts
import { createOpenAIEmbeddings, createMockEmbeddings } from 'elsium-ai/rag'

// Production
const embeddings = createOpenAIEmbeddings({
  provider: 'openai',
  apiKey: process.env.OPENAI_API_KEY,
  model: 'text-embedding-3-small',
})

const vector = await embeddings.embed('Hello world')
// => { values: [0.012, -0.034, ...], dimensions: 1536 }

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
| `cosineSimilarity` | `cosineSimilarity(a: number[], b: number[]): number` | Cosine similarity between two vectors |
| `mmrRerank` | `mmrRerank(queryEmbedding, results, opts?): RetrievalResult[]` | Maximal marginal relevance reranking |

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
  lambda?: number,  // Balance relevance vs diversity (0-1, default 0.5)
})
```

### Example

```ts
import { createInMemoryStore, cosineSimilarity } from 'elsium-ai/rag'

const store = createInMemoryStore({ maxChunks: 10000 })
await store.upsert(embeddedChunks)

const results = await store.query(queryEmbedding, { topK: 5, minScore: 0.7 })
// => [{ chunk, score, distance }, ...]

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
import { rag } from 'elsium-ai/rag'

const pipeline = rag({
  loader: 'markdown',
  chunking: { strategy: 'recursive', maxChunkSize: 500, overlap: 50 },
  embeddings: { provider: 'openai', apiKey: process.env.OPENAI_API_KEY },
  store: { provider: 'memory' },
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
| `LoaderType` | `'text'` \| `'markdown'` \| `'html'` \| `'json'` \| `'csv'` |
| `ChunkingStrategy` | `'fixed-size'` \| `'recursive'` \| `'sentence'` |
| `ChunkingConfig` | Chunking configuration |
| `EmbeddingConfig` | Embedding provider configuration |
| `VectorStoreConfig` | Vector store configuration |
| `RetrievalConfig` | Retrieval strategy configuration |
| `DocumentLoader` | Loader interface: `load(source, content)` |
| `Chunker` | Chunker interface: `chunk(document)` |
| `EmbeddingProvider` | Embedding provider interface |
| `VectorStore` | Vector store interface |
| `RAGPipeline` | Pipeline interface |
| `RAGPipelineConfig` | Pipeline configuration |
| `IngestResult` | Ingestion result |
