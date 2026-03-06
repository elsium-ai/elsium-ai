import { describe, expect, it, vi } from 'vitest'
import type { RetrievalResult } from './retrieval'
import { createRetrievalTool } from './retrieval'

describe('createRetrievalTool', () => {
	function mockRetrieve(results: RetrievalResult[]) {
		return vi.fn().mockResolvedValue(results)
	}

	it('creates a tool with default name and description', () => {
		const tool = createRetrievalTool({
			retrieve: mockRetrieve([]),
		})

		expect(tool.name).toBe('search_knowledge')
		expect(tool.description).toContain('knowledge base')
	})

	it('uses custom name and description', () => {
		const tool = createRetrievalTool({
			name: 'search_docs',
			description: 'Search documentation',
			retrieve: mockRetrieve([]),
		})

		expect(tool.name).toBe('search_docs')
		expect(tool.description).toBe('Search documentation')
	})

	it('calls retrieve with query and topK', async () => {
		const retrieve = mockRetrieve([{ content: 'Result 1', score: 0.95 }])

		const tool = createRetrievalTool({ retrieve, topK: 3 })

		const result = await tool.execute({ query: 'test query' })

		expect(result.success).toBe(true)
		expect(retrieve).toHaveBeenCalledWith('test query', { topK: 3 })
	})

	it('formats results with default formatter', async () => {
		const retrieve = mockRetrieve([
			{ content: 'First result', score: 0.95, source: 'doc1.md' },
			{ content: 'Second result', score: 0.8 },
		])

		const tool = createRetrievalTool({ retrieve })
		const result = await tool.execute({ query: 'test' })

		expect(result.success).toBe(true)
		expect(result.data).toContain('[1]')
		expect(result.data).toContain('doc1.md')
		expect(result.data).toContain('0.95')
		expect(result.data).toContain('First result')
		expect(result.data).toContain('[2]')
		expect(result.data).toContain('Second result')
	})

	it('returns "no results" message for empty results', async () => {
		const retrieve = mockRetrieve([])
		const tool = createRetrievalTool({ retrieve })
		const result = await tool.execute({ query: 'nothing' })

		expect(result.success).toBe(true)
		expect(result.data).toContain('No relevant results found')
	})

	it('uses custom format function', async () => {
		const retrieve = mockRetrieve([{ content: 'Test', score: 0.9 }])

		const tool = createRetrievalTool({
			retrieve,
			formatResult: (results) => results.map((r) => r.content).join(', '),
		})

		const result = await tool.execute({ query: 'test' })
		expect(result.data).toBe('Test')
	})

	it('validates input schema', async () => {
		const tool = createRetrievalTool({
			retrieve: mockRetrieve([]),
		})

		const result = await tool.execute({ wrong: 'field' })
		expect(result.success).toBe(false)
		expect(result.error).toContain('Invalid input')
	})

	it('generates tool definition with input schema', () => {
		const tool = createRetrievalTool({
			retrieve: mockRetrieve([]),
		})

		const def = tool.toDefinition()
		expect(def.name).toBe('search_knowledge')
		expect(def.inputSchema).toBeDefined()
		expect(def.inputSchema.properties).toHaveProperty('query')
	})

	it('defaults topK to 5', async () => {
		const retrieve = mockRetrieve([])
		const tool = createRetrievalTool({ retrieve })

		await tool.execute({ query: 'test' })
		expect(retrieve).toHaveBeenCalledWith('test', { topK: 5 })
	})

	it('handles retrieve function errors gracefully', async () => {
		const retrieve = vi.fn().mockRejectedValue(new Error('Connection failed'))
		const tool = createRetrievalTool({ retrieve })

		const result = await tool.execute({ query: 'test' })
		expect(result.success).toBe(false)
		expect(result.error).toContain('Connection failed')
	})
})
