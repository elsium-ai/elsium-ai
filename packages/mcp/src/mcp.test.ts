import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createMCPClient } from './client'
import { createMCPServer } from './server'

// Mock tool for testing
function createMockTool() {
	return {
		name: 'test_tool',
		description: 'A test tool',
		inputSchema: z.object({ query: z.string() }),
		timeoutMs: 30_000,
		execute: vi.fn().mockResolvedValue({
			success: true,
			data: 'test result',
			toolCallId: 'tc_1',
			durationMs: 10,
		}),
		toDefinition: () => ({
			name: 'test_tool',
			description: 'A test tool',
			inputSchema: {
				type: 'object',
				properties: { query: { type: 'string' } },
				required: ['query'],
			},
		}),
	}
}

describe('MCP Client', () => {
	it('should create client with correct config', () => {
		const client = createMCPClient({
			name: 'test-server',
			transport: 'stdio',
			command: 'echo',
			args: ['hello'],
		})

		expect(client.connected).toBe(false)
	})

	it('should have all required methods', () => {
		const client = createMCPClient({
			name: 'test',
			transport: 'stdio',
			command: 'echo',
		})

		expect(typeof client.connect).toBe('function')
		expect(typeof client.disconnect).toBe('function')
		expect(typeof client.listTools).toBe('function')
		expect(typeof client.callTool).toBe('function')
		expect(typeof client.toElsiumTools).toBe('function')
	})
})

describe('MCP Server', () => {
	it('should create server with tools', () => {
		const tool = createMockTool()
		const server = createMCPServer({
			name: 'test-server',
			tools: [tool as never],
		})

		expect(server.running).toBe(false)
	})

	it('should have start and stop methods', () => {
		const server = createMCPServer({
			name: 'test-server',
			tools: [],
		})

		expect(typeof server.start).toBe('function')
		expect(typeof server.stop).toBe('function')
	})

	it('should stop when called', () => {
		const server = createMCPServer({
			name: 'test-server',
			tools: [],
		})

		server.stop()
		expect(server.running).toBe(false)
	})
})
