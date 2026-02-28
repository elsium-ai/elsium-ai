/**
 * MCP Integration Example
 *
 * Demonstrates bidirectional MCP support:
 * 1. Using an MCP server's tools in an ElsiumAI agent (client mode)
 * 2. Exposing ElsiumAI tools as an MCP server (server mode)
 */

import { createMCPClient, createMCPServer, defineAgent, defineTool, gateway } from 'elsium-ai'
import { z } from 'zod'

// ─── Example 1: Use MCP Server Tools in Agent ─────────────────

async function clientExample() {
	console.log('\n── MCP Client Example ──\n')

	// Connect to an MCP server (e.g., GitHub MCP server)
	const mcp = createMCPClient({
		name: 'github',
		transport: 'stdio',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-github'],
		env: { GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN ?? '' },
	})

	try {
		await mcp.connect()
		console.log('Connected to GitHub MCP server')

		// Convert MCP tools to ElsiumAI tools
		const tools = await mcp.toElsiumTools()
		console.log(`Available tools: ${tools.map((t) => t.name).join(', ')}`)

		// Create an agent that uses MCP tools
		const gw = gateway({
			provider: 'anthropic',
			apiKey: process.env.ANTHROPIC_API_KEY ?? '',
		})

		const agent = defineAgent(
			{
				name: 'github-agent',
				system: 'You are a helpful assistant that can interact with GitHub repositories.',
				tools,
			},
			{ complete: gw.complete.bind(gw) },
		)

		// Use the agent
		const result = await agent.run('List the open issues in the elsium-ai repository')
		console.log('Agent response:', result.message.content)
	} catch (err) {
		console.log('MCP client example requires a running MCP server')
		console.log('Error:', err instanceof Error ? err.message : err)
	} finally {
		await mcp.disconnect()
	}
}

// ─── Example 2: Expose ElsiumAI Tools as MCP Server ──────────

async function serverExample() {
	console.log('\n── MCP Server Example ──\n')

	// Define some ElsiumAI tools
	const weatherTool = defineTool({
		name: 'get_weather',
		description: 'Get the current weather for a city',
		input: z.object({
			city: z.string().describe('The city name'),
		}),
		handler: async (input) => ({
			city: input.city,
			temperature: 72,
			condition: 'Sunny',
			humidity: 45,
		}),
	})

	const calculatorTool = defineTool({
		name: 'calculate',
		description: 'Perform a mathematical calculation',
		input: z.object({
			expression: z.string().describe('Math expression to evaluate'),
		}),
		handler: async (input) => ({
			expression: input.expression,
			result: Function(`"use strict"; return (${input.expression})`)(),
		}),
	})

	// Expose tools as MCP server
	const server = createMCPServer({
		name: 'elsium-tools',
		version: '0.1.0',
		tools: [weatherTool, calculatorTool],
	})

	console.log('MCP Server ready with tools: get_weather, calculate')
	console.log(
		'Start with: echo \'{"jsonrpc":"2.0","id":1,"method":"tools/list"}\' | bun run examples/mcp-integration/index.ts --server',
	)

	if (process.argv.includes('--server')) {
		await server.start()
	}
}

// ─── Main ────────────────────────────────────────────────────

const mode = process.argv.includes('--server') ? 'server' : 'client'

if (mode === 'server') {
	serverExample()
} else {
	clientExample()
}
