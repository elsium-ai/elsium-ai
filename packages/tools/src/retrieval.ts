import { z } from 'zod'
import { defineTool } from './define'
import type { Tool } from './define'

export interface RetrievalResult {
	content: string
	score: number
	source?: string
	metadata?: Record<string, unknown>
}

export type RetrieveFn = (query: string, options?: { topK?: number }) => Promise<RetrievalResult[]>

export interface RetrievalToolConfig {
	name?: string
	description?: string
	retrieve: RetrieveFn
	topK?: number
	formatResult?: (results: RetrievalResult[]) => string
}

function defaultFormatResults(results: RetrievalResult[]): string {
	if (results.length === 0) return 'No relevant results found.'
	return results
		.map((r, i) => {
			const source = r.source ? ` (source: ${r.source})` : ''
			return `[${i + 1}]${source} (score: ${r.score.toFixed(2)})\n${r.content}`
		})
		.join('\n\n---\n\n')
}

export function createRetrievalTool(config: RetrievalToolConfig): Tool {
	const topK = config.topK ?? 5
	const formatResult = config.formatResult ?? defaultFormatResults

	return defineTool({
		name: config.name ?? 'search_knowledge',
		description:
			config.description ??
			'Search the knowledge base for relevant information. Use this when you need to find facts, documentation, or context to answer questions.',
		input: z.object({
			query: z.string().describe('The search query to find relevant information'),
		}),
		async handler(input) {
			const results = await config.retrieve(input.query, { topK })
			return formatResult(results)
		},
	})
}
