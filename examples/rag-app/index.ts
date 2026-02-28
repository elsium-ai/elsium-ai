/**
 * Example: RAG Knowledge Base
 *
 * Ingests documents and answers questions using retrieval-augmented generation.
 * Demonstrates: RAG pipeline, vector search, agent with context.
 *
 * Usage:
 *   export ANTHROPIC_API_KEY=your-key
 *   bun examples/rag-app/index.ts
 */

import { defineAgent } from '@elsium-ai/agents'
import { env } from '@elsium-ai/core'
import { gateway } from '@elsium-ai/gateway'
import { createInMemoryStore, createMockEmbeddings, rag } from '@elsium-ai/rag'

// Sample knowledge base
const documents = [
	{
		content: `# ElsiumAI Framework

ElsiumAI is a high-performance, TypeScript-first AI framework built on Bun.
It provides a modular architecture with packages for LLM gateway, agents,
tools, RAG, workflows, and observability.

## Key Features
- Zero magic: no hidden behavior, no decorators
- Type safety end-to-end
- Performance by default with streaming
- Built-in cost tracking and tracing
- Deterministic testing with mock providers`,
		source: 'docs/overview.md',
	},
	{
		content: `# Getting Started

To create a new ElsiumAI project:

1. Install the CLI: bun add -g @elsium-ai/cli
2. Scaffold a project: elsium init my-app
3. Configure API key in .env
4. Start development: bun run dev

The generated project includes a basic agent with an HTTP server.`,
		source: 'docs/getting-started.md',
	},
	{
		content: `# Agents

Agents are the core building block in ElsiumAI. An agent wraps an LLM
with a system prompt, tools, memory, and guardrails.

Use defineAgent() to create an agent:
- name: Unique identifier
- system: System prompt
- model: LLM model to use
- tools: Array of tools the agent can use
- memory: Conversation memory strategy
- guardrails: Token budgets and validators`,
		source: 'docs/agents.md',
	},
	{
		content: `# Tools

Tools extend agent capabilities. Define tools with Zod schemas
for type-safe input validation.

Built-in tools:
- httpFetchTool: Make HTTP requests
- calculatorTool: Safe math evaluation
- jsonParseTool: Parse and extract JSON data
- currentTimeTool: Get current date and time

Create custom tools with defineTool().`,
		source: 'docs/tools.md',
	},
	{
		content: `# Observability

ElsiumAI includes built-in tracing and cost tracking.

Use observe() to create a tracer:
- Track every LLM call with cost and latency
- Create spans around operations
- Export to console or custom backends
- Generate cost reports per model

Use the CLI to inspect traces: elsium trace`,
		source: 'docs/observability.md',
	},
]

async function main() {
	console.log('\n  ElsiumAI RAG Example')
	console.log('  ─────────────────────\n')

	// Create RAG pipeline with mock embeddings (no API key needed for demo)
	const pipeline = rag({
		loader: 'markdown',
		chunking: { strategy: 'recursive', maxChunkSize: 256, overlap: 30 },
		embeddings: { provider: 'mock' },
	})

	// Ingest documents
	console.log('  Ingesting documents...')
	for (const doc of documents) {
		await pipeline.ingest(doc.source, doc.content)
	}
	console.log(`  Ingested ${await pipeline.count()} chunks\n`)

	// Query the knowledge base
	const queries = [
		'What is ElsiumAI?',
		'How do I create a new project?',
		'What tools are available?',
		'How does observability work?',
	]

	for (const query of queries) {
		console.log(`  Q: ${query}`)
		const results = await pipeline.query(query, { topK: 3 })
		console.log(`  Found ${results.length} relevant chunks:`)
		for (const r of results) {
			const preview = r.chunk.content.slice(0, 80).replace(/\n/g, ' ')
			console.log(`    [${r.score.toFixed(2)}] ${preview}...`)
			console.log(`           source: ${r.chunk.metadata.source}`)
		}
		console.log()
	}

	// Optional: If API key is available, use a real agent for Q&A
	if (process.env.ANTHROPIC_API_KEY) {
		console.log('  ─── Agent Q&A (with LLM) ───\n')

		const llm = gateway({
			provider: 'anthropic',
			model: 'claude-sonnet-4-6',
			apiKey: env('ANTHROPIC_API_KEY'),
		})

		const qaAgent = defineAgent(
			{
				name: 'qa',
				system: `You answer questions about ElsiumAI using the provided context.
Be concise and accurate. If the context doesn't contain the answer, say so.`,
				model: 'claude-sonnet-4-6',
			},
			{ complete: (req) => llm.complete(req) },
		)

		for (const query of queries) {
			const results = await pipeline.query(query, { topK: 3 })
			const context = results.map((r) => r.chunk.content).join('\n\n---\n\n')
			const prompt = `Context:\n${context}\n\nQuestion: ${query}`

			const result = await qaAgent.run(prompt)
			const content =
				typeof result.message.content === 'string'
					? result.message.content
					: result.message.content.map((p) => ('text' in p ? p.text : '')).join('')
			console.log(`  Q: ${query}`)
			console.log(`  A: ${content}\n`)
		}
	} else {
		console.log('  Set ANTHROPIC_API_KEY to enable agent-powered Q&A.\n')
	}
}

main()
