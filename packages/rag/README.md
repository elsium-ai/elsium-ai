# @elsium-ai/rag

RAG pipeline, document processing, embeddings, and vector stores for [ElsiumAI](https://github.com/elsium-ai/elsium-ai).

[![npm](https://img.shields.io/npm/v/@elsium-ai/rag.svg)](https://www.npmjs.com/package/@elsium-ai/rag)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE)

## Install

```bash
npm install @elsium-ai/rag @elsium-ai/core
```

## What's Inside

- **Document Loading** — Load documents from various sources
- **Chunking** — Split documents with configurable strategies (fixed-size, recursive, semantic)
- **Embeddings** — Generate embeddings with pluggable providers
- **Vector Search** — In-memory vector store with cosine similarity search
- **RAG Pipeline** — End-to-end retrieval-augmented generation

## Usage

```typescript
import { createRAGPipeline, createVectorStore, createChunker } from '@elsium-ai/rag'

const store = createVectorStore()
const chunker = createChunker({ strategy: 'recursive', chunkSize: 512 })

const chunks = chunker.chunk(document)
await store.add(chunks)

const results = await store.search('What is ElsiumAI?', { topK: 5 })
```

## Part of ElsiumAI

This package is the RAG layer of the [ElsiumAI](https://github.com/elsium-ai/elsium-ai) framework. See the [full documentation](https://github.com/elsium-ai/elsium-ai) for guides and examples.

## License

[MIT](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE)
