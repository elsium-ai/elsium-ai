# @elsium-ai/rag

RAG pipeline, document processing, embeddings, and vector stores for [ElsiumAI](https://github.com/elsium-ai/elsium-ai).

[![npm](https://img.shields.io/npm/v/@elsium-ai/rag.svg)](https://www.npmjs.com/package/@elsium-ai/rag)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE)

## Install

```bash
npm install @elsium-ai/rag @elsium-ai/core
```

## What's Inside

| Category | Exports |
|---|---|
| **Types** | `Document`, `DocumentMetadata`, `Chunk`, `ChunkMetadata`, `EmbeddingVector`, `EmbeddedChunk`, `RetrievalResult`, `QueryOptions`, `LoaderType`, `ChunkingStrategy`, `ChunkingConfig`, `EmbeddingConfig`, `VectorStoreConfig`, `RetrievalConfig` |
| **Loaders** | `textLoader`, `markdownLoader`, `htmlLoader`, `jsonLoader`, `csvLoader`, `getLoader`, `DocumentLoader` |
| **Chunkers** | `fixedSizeChunker`, `recursiveChunker`, `sentenceChunker`, `getChunker`, `Chunker` |
| **Embeddings** | `createOpenAIEmbeddings`, `createMockEmbeddings`, `getEmbeddingProvider`, `EmbeddingProvider` |
| **Vector Store** | `createInMemoryStore`, `cosineSimilarity`, `mmrRerank`, `VectorStore` |
| **Pipeline** | `rag`, `RAGPipeline`, `RAGPipelineConfig`, `IngestResult` |

---

## Types

### `Document`

Represents a loaded document ready for chunking.

```typescript
interface Document {
  id: string
  content: string
  metadata: DocumentMetadata
}
```

### `DocumentMetadata`

Metadata attached to a document. Includes required fields plus arbitrary extra properties.

```typescript
interface DocumentMetadata {
  source: string
  type: string
  title?: string
  language?: string
  createdAt?: string
  [key: string]: unknown
}
```

### `Chunk`

A segment of a document produced by a chunker.

```typescript
interface Chunk {
  id: string
  content: string
  documentId: string
  index: number
  metadata: ChunkMetadata
}
```

### `ChunkMetadata`

Positional and token metadata for a chunk. Supports arbitrary extra properties.

```typescript
interface ChunkMetadata {
  startChar: number
  endChar: number
  tokenEstimate: number
  [key: string]: unknown
}
```

### `EmbeddingVector`

A numeric embedding vector with its dimensionality.

```typescript
interface EmbeddingVector {
  values: number[]
  dimensions: number
}
```

### `EmbeddedChunk`

A chunk that has been embedded. Extends `Chunk` with an `embedding` field.

```typescript
interface EmbeddedChunk extends Chunk {
  embedding: EmbeddingVector
}
```

### `RetrievalResult`

A single result returned from a vector store query, pairing a chunk with its relevance score.

```typescript
interface RetrievalResult {
  chunk: Chunk
  score: number
  distance: number
}
```

### `QueryOptions`

Options passed to a vector store query or pipeline query.

```typescript
interface QueryOptions {
  topK?: number
  minScore?: number
  filter?: Record<string, unknown>
}
```

### `LoaderType`

Union of supported document loader types.

```typescript
type LoaderType = 'text' | 'markdown' | 'html' | 'json' | 'csv'
```

### `ChunkingStrategy`

Union of supported chunking strategies.

```typescript
type ChunkingStrategy = 'fixed-size' | 'recursive' | 'sentence'
```

### `ChunkingConfig`

Configuration object for creating a chunker via `getChunker`.

```typescript
interface ChunkingConfig {
  strategy: ChunkingStrategy
  maxChunkSize?: number
  overlap?: number
  separator?: string
}
```

### `EmbeddingConfig`

Configuration object for creating an embedding provider.

```typescript
interface EmbeddingConfig {
  provider: string
  model?: string
  apiKey?: string
  baseUrl?: string
  dimensions?: number
  batchSize?: number
}
```

### `VectorStoreConfig`

Configuration object for specifying a vector store backend.

```typescript
interface VectorStoreConfig {
  provider: string
  connectionString?: string
  tableName?: string
  dimensions?: number
}
```

### `RetrievalConfig`

Configuration for retrieval behavior within a RAG pipeline.

```typescript
interface RetrievalConfig {
  topK?: number
  minScore?: number
  strategy?: 'similarity' | 'mmr'
  mmrLambda?: number
}
```

---

## Loaders

### `DocumentLoader`

Interface implemented by all document loaders.

```typescript
interface DocumentLoader {
  load(source: string, content: string): Document
}
```

### `textLoader`

Creates a loader for plain text content.

```typescript
function textLoader(): DocumentLoader
```

**Returns:** A `DocumentLoader` that produces documents with `type: 'text'`.

```typescript
import { textLoader } from '@elsium-ai/rag'

const loader = textLoader()
const doc = loader.load('notes.txt', 'Hello, world!')

console.log(doc.metadata.type) // "text"
```

### `markdownLoader`

Creates a loader for Markdown content. Automatically extracts the first `# heading` as the document title.

```typescript
function markdownLoader(): DocumentLoader
```

**Returns:** A `DocumentLoader` that produces documents with `type: 'markdown'` and an optional `title` in metadata.

```typescript
import { markdownLoader } from '@elsium-ai/rag'

const loader = markdownLoader()
const doc = loader.load('readme.md', '# My Project\n\nSome content here.')

console.log(doc.metadata.title) // "My Project"
```

### `htmlLoader`

Creates a loader for HTML content. Strips tags, scripts, and styles, then extracts the `<title>` element as the document title.

```typescript
function htmlLoader(): DocumentLoader
```

**Returns:** A `DocumentLoader` that produces documents with `type: 'html'`, the HTML body converted to plain text, and an optional `title` in metadata.

```typescript
import { htmlLoader } from '@elsium-ai/rag'

const loader = htmlLoader()
const doc = loader.load('page.html', '<html><title>Hello</title><body><p>World</p></body></html>')

console.log(doc.metadata.title) // "Hello"
console.log(doc.content)        // "World"
```

### `jsonLoader`

Creates a loader for JSON content. Extracts text from a configurable content field and can pull additional metadata fields.

```typescript
function jsonLoader(options?: {
  contentField?: string
  metadataFields?: string[]
}): DocumentLoader
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `options.contentField` | `string` | `'content'` | The JSON key to read text content from. |
| `options.metadataFields` | `string[]` | `[]` | Additional top-level JSON keys to copy into document metadata. |

**Returns:** A `DocumentLoader` that produces documents with `type: 'json'`. If the parsed JSON is an array, each item's content field is joined with double newlines.

```typescript
import { jsonLoader } from '@elsium-ai/rag'

const loader = jsonLoader({ contentField: 'text', metadataFields: ['author'] })
const doc = loader.load('data.json', JSON.stringify({ text: 'Hello', author: 'Alice' }))

console.log(doc.content)          // "Hello"
console.log(doc.metadata.author)  // "Alice"
```

### `csvLoader`

Creates a loader for CSV content. Parses headers and rows, optionally selecting specific columns.

```typescript
function csvLoader(options?: {
  separator?: string
  contentColumns?: string[]
}): DocumentLoader
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `options.separator` | `string` | `','` | Column delimiter character. |
| `options.contentColumns` | `string[]` | all columns | Subset of columns to include in the document text. |

**Returns:** A `DocumentLoader` that produces documents with `type: 'csv'`. Metadata includes `rowCount` and `columns`.

```typescript
import { csvLoader } from '@elsium-ai/rag'

const loader = csvLoader({ contentColumns: ['name', 'bio'] })
const doc = loader.load('people.csv', 'name,age,bio\nAlice,30,Engineer\nBob,25,Designer')

console.log(doc.metadata.rowCount) // 2
console.log(doc.metadata.columns)  // ["name", "age", "bio"]
```

### `getLoader`

Factory function that returns a `DocumentLoader` for the given `LoaderType`.

```typescript
function getLoader(type: LoaderType): DocumentLoader
```

| Parameter | Type | Description |
|---|---|---|
| `type` | `LoaderType` | One of `'text'`, `'markdown'`, `'html'`, `'json'`, `'csv'`. |

**Returns:** The corresponding `DocumentLoader` with default options.

```typescript
import { getLoader } from '@elsium-ai/rag'

const loader = getLoader('markdown')
const doc = loader.load('file.md', '# Title\n\nBody text.')
```

---

## Chunkers

### `Chunker`

Interface implemented by all chunking strategies.

```typescript
interface Chunker {
  chunk(document: Document): Chunk[]
}
```

### `fixedSizeChunker`

Creates a chunker that splits documents into fixed-size character windows with optional overlap.

```typescript
function fixedSizeChunker(options?: {
  maxChunkSize?: number
  overlap?: number
}): Chunker
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `options.maxChunkSize` | `number` | `512` | Maximum number of characters per chunk. |
| `options.overlap` | `number` | `0` | Number of overlapping characters between consecutive chunks. Must be less than `maxChunkSize`. |

**Returns:** A `Chunker` that produces fixed-size chunks.

```typescript
import { fixedSizeChunker } from '@elsium-ai/rag'

const chunker = fixedSizeChunker({ maxChunkSize: 256, overlap: 32 })
// Assuming `doc` is a Document:
const chunks = chunker.chunk(doc)
```

### `recursiveChunker`

Creates a chunker that recursively splits text using a hierarchy of separators (paragraph breaks, line breaks, sentence endings, spaces), falling back to fixed-size splitting when no separator fits.

```typescript
function recursiveChunker(options?: {
  maxChunkSize?: number
  overlap?: number
  separators?: string[]
}): Chunker
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `options.maxChunkSize` | `number` | `512` | Maximum number of characters per chunk. |
| `options.overlap` | `number` | `0` | Number of overlapping characters between consecutive chunks. Must be less than `maxChunkSize`. |
| `options.separators` | `string[]` | `['\n\n', '\n', '. ', ' ', '']` | Ordered list of separators to try. |

**Returns:** A `Chunker` that recursively splits documents using natural boundaries.

```typescript
import { recursiveChunker } from '@elsium-ai/rag'

const chunker = recursiveChunker({ maxChunkSize: 512, overlap: 50 })
const chunks = chunker.chunk(doc)
```

### `sentenceChunker`

Creates a chunker that splits text on sentence boundaries (`.`, `!`, `?` followed by whitespace) and groups sentences into chunks up to `maxChunkSize` characters with optional sentence-level overlap.

```typescript
function sentenceChunker(options?: {
  maxChunkSize?: number
  overlap?: number
}): Chunker
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `options.maxChunkSize` | `number` | `512` | Maximum number of characters per chunk. |
| `options.overlap` | `number` | `1` | Number of sentences to overlap between consecutive chunks. |

**Returns:** A `Chunker` that groups sentences into chunks. Each chunk's metadata includes `sentenceCount`.

```typescript
import { sentenceChunker } from '@elsium-ai/rag'

const chunker = sentenceChunker({ maxChunkSize: 300, overlap: 2 })
const chunks = chunker.chunk(doc)

console.log(chunks[0].metadata.sentenceCount) // number of sentences in the first chunk
```

### `getChunker`

Factory function that returns a `Chunker` for the given `ChunkingConfig`.

```typescript
function getChunker(config: ChunkingConfig): Chunker
```

| Parameter | Type | Description |
|---|---|---|
| `config` | `ChunkingConfig` | Chunking configuration specifying `strategy`, `maxChunkSize`, and `overlap`. |

**Returns:** The corresponding `Chunker` instance.

```typescript
import { getChunker } from '@elsium-ai/rag'

const chunker = getChunker({ strategy: 'recursive', maxChunkSize: 512, overlap: 50 })
const chunks = chunker.chunk(doc)
```

---

## Embeddings

### `EmbeddingProvider`

Interface implemented by all embedding providers.

```typescript
interface EmbeddingProvider {
  readonly name: string
  readonly dimensions: number

  embed(text: string): Promise<EmbeddingVector>
  embedBatch(texts: string[]): Promise<EmbeddingVector[]>
}
```

### `createOpenAIEmbeddings`

Creates an embedding provider backed by the OpenAI embeddings API.

```typescript
function createOpenAIEmbeddings(config: EmbeddingConfig): EmbeddingProvider
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `config.apiKey` | `string` | **(required)** | OpenAI API key. Throws if not provided. |
| `config.model` | `string` | `'text-embedding-3-small'` | Model name to use. |
| `config.baseUrl` | `string` | `'https://api.openai.com'` | API base URL (useful for proxies or compatible APIs). |
| `config.dimensions` | `number` | `1536` | Desired embedding dimensions. |
| `config.batchSize` | `number` | `100` | Maximum number of texts per API call when using `embedBatch`. |

**Returns:** An `EmbeddingProvider` with `name: 'openai'`.

```typescript
import { createOpenAIEmbeddings } from '@elsium-ai/rag'

const embeddings = createOpenAIEmbeddings({
  provider: 'openai',
  apiKey: process.env.OPENAI_API_KEY,
  model: 'text-embedding-3-small',
  dimensions: 1536,
})

const vector = await embeddings.embed('Hello, world!')
console.log(vector.dimensions) // 1536
```

### `createMockEmbeddings`

Creates a deterministic mock embedding provider for testing. Produces normalized vectors derived from character codes.

```typescript
function createMockEmbeddings(dims?: number): EmbeddingProvider
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `dims` | `number` | `128` | Number of dimensions for generated embeddings. |

**Returns:** An `EmbeddingProvider` with `name: 'mock'`.

```typescript
import { createMockEmbeddings } from '@elsium-ai/rag'

const embeddings = createMockEmbeddings(64)
const vector = await embeddings.embed('test input')

console.log(vector.dimensions) // 64
```

### `getEmbeddingProvider`

Factory function that returns an `EmbeddingProvider` for the given `EmbeddingConfig`. Supports `'openai'` and `'mock'` providers.

```typescript
function getEmbeddingProvider(config: EmbeddingConfig): EmbeddingProvider
```

| Parameter | Type | Description |
|---|---|---|
| `config` | `EmbeddingConfig` | Configuration specifying `provider` and provider-specific options. |

**Returns:** The corresponding `EmbeddingProvider`. Throws an error for unknown providers.

```typescript
import { getEmbeddingProvider } from '@elsium-ai/rag'

const embeddings = getEmbeddingProvider({ provider: 'mock', dimensions: 256 })
const vector = await embeddings.embed('sample text')
```

---

## Vector Store

### `VectorStore`

Interface implemented by all vector store backends.

```typescript
interface VectorStore {
  readonly name: string

  upsert(chunks: EmbeddedChunk[]): Promise<void>
  query(embedding: EmbeddingVector, options?: QueryOptions): Promise<RetrievalResult[]>
  delete(ids: string[]): Promise<void>
  clear(): Promise<void>
  count(): Promise<number>
}
```

### `createInMemoryStore`

Creates an in-memory vector store backed by a `Map`. Supports cosine-similarity search and automatic eviction when exceeding `maxChunks`.

```typescript
function createInMemoryStore(options?: {
  maxChunks?: number
}): VectorStore
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `options.maxChunks` | `number` | `100_000` | Maximum number of embedded chunks to store. When exceeded, the oldest entries are evicted. |

**Returns:** A `VectorStore` with `name: 'in-memory'`.

```typescript
import { createInMemoryStore, createMockEmbeddings } from '@elsium-ai/rag'

const store = createInMemoryStore({ maxChunks: 10_000 })
const embeddings = createMockEmbeddings()

// Upsert embedded chunks
await store.upsert(embeddedChunks)

// Query
const queryVector = await embeddings.embed('search query')
const results = await store.query(queryVector, { topK: 5, minScore: 0.5 })

console.log(await store.count()) // number of stored chunks
```

### `cosineSimilarity`

Computes the cosine similarity between two numeric vectors. Returns `0` if the vectors have different lengths or either has zero magnitude.

```typescript
function cosineSimilarity(a: number[], b: number[]): number
```

| Parameter | Type | Description |
|---|---|---|
| `a` | `number[]` | First vector. |
| `b` | `number[]` | Second vector. |

**Returns:** A number between `-1` and `1` representing cosine similarity.

```typescript
import { cosineSimilarity } from '@elsium-ai/rag'

const similarity = cosineSimilarity([1, 0, 0], [1, 0, 0])
console.log(similarity) // 1

const orthogonal = cosineSimilarity([1, 0], [0, 1])
console.log(orthogonal) // 0
```

### `mmrRerank`

Reranks retrieval results using Maximal Marginal Relevance (MMR) to balance relevance and diversity. Requires that each result includes its `embedding` field.

```typescript
function mmrRerank(
  queryEmbedding: EmbeddingVector,
  results: Array<RetrievalResult & { embedding: EmbeddingVector }>,
  options?: { topK?: number; lambda?: number },
): RetrievalResult[]
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `queryEmbedding` | `EmbeddingVector` | -- | The embedding of the query text. |
| `results` | `Array<RetrievalResult & { embedding: EmbeddingVector }>` | -- | Candidate results, each with its embedding attached. |
| `options.topK` | `number` | `5` | Number of results to return. |
| `options.lambda` | `number` | `0.7` | Trade-off between relevance (1.0) and diversity (0.0). |

**Returns:** An array of `RetrievalResult` objects reranked by MMR.

```typescript
import { mmrRerank } from '@elsium-ai/rag'

const reranked = mmrRerank(queryEmbedding, candidateResults, {
  topK: 3,
  lambda: 0.5,
})
```

---

## Pipeline

### `RAGPipelineConfig`

Configuration object for creating a RAG pipeline via `rag()`.

```typescript
interface RAGPipelineConfig {
  loader?: LoaderType
  chunking?: ChunkingConfig
  embeddings: EmbeddingConfig
  store?: VectorStoreConfig
  retrieval?: RetrievalConfig
}
```

### `RAGPipeline`

Interface representing a fully configured RAG pipeline with ingest and query capabilities.

```typescript
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

### `IngestResult`

Summary returned after ingesting a document into the pipeline.

```typescript
interface IngestResult {
  documentId: string
  chunkCount: number
  totalTokens: number
}
```

### `rag`

Creates a complete RAG pipeline that handles loading, chunking, embedding, storing, and querying documents in a single unified API.

```typescript
function rag(config: RAGPipelineConfig): RAGPipeline
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `config.loader` | `LoaderType` | `'text'` | Document loader type. |
| `config.chunking` | `ChunkingConfig` | `{ strategy: 'recursive', maxChunkSize: 512, overlap: 50 }` | Chunking configuration. |
| `config.embeddings` | `EmbeddingConfig` | **(required)** | Embedding provider configuration. |
| `config.store` | `VectorStoreConfig` | in-memory store | Vector store configuration. External stores are not yet supported. |
| `config.retrieval` | `RetrievalConfig` | `{ topK: 5, minScore: 0, strategy: 'similarity' }` | Retrieval configuration. |

**Returns:** A `RAGPipeline` instance.

```typescript
import { rag } from '@elsium-ai/rag'

const pipeline = rag({
  loader: 'markdown',
  chunking: { strategy: 'recursive', maxChunkSize: 512, overlap: 50 },
  embeddings: { provider: 'openai', apiKey: process.env.OPENAI_API_KEY },
  retrieval: { topK: 5, minScore: 0.5 },
})

// Ingest a document
const result = await pipeline.ingest('docs/guide.md', markdownContent)
console.log(result.chunkCount)  // number of chunks created
console.log(result.totalTokens) // estimated total tokens

// Query the pipeline
const hits = await pipeline.query('How do I configure the pipeline?')
for (const hit of hits) {
  console.log(hit.score, hit.chunk.content)
}

// Pipeline also exposes its internals
console.log(pipeline.embeddingProvider.name) // "openai"
console.log(await pipeline.count())          // total chunks stored
```

---

## Part of ElsiumAI

This package is the RAG layer of the [ElsiumAI](https://github.com/elsium-ai/elsium-ai) framework. See the [full documentation](https://github.com/elsium-ai/elsium-ai) for guides and examples.

## License

[MIT](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE)
