# RAG Knowledge Base Example

Ingests Markdown documents and answers questions using retrieval-augmented generation.

## Run

```bash
# Works without API key (uses mock embeddings)
bun examples/rag-app/index.ts

# With LLM-powered Q&A
export ANTHROPIC_API_KEY=your-key
bun examples/rag-app/index.ts
```

## What it demonstrates

- `@elsium-ai/rag` — Full RAG pipeline (loader, chunker, embeddings, vector store)
- Markdown document loading and recursive chunking
- In-memory vector search with cosine similarity
- Combining RAG context with agent for Q&A
