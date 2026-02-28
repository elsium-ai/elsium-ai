/**
 * Example: Simple Chatbot
 *
 * A conversational agent with memory that responds to user messages.
 * Demonstrates: gateway, agent, memory, observability.
 *
 * Usage:
 *   export ANTHROPIC_API_KEY=your-key
 *   bun examples/chatbot/index.ts
 */

import { defineAgent } from '@elsium-ai/agents'
import { env } from '@elsium-ai/core'
import { gateway } from '@elsium-ai/gateway'
import { observe } from '@elsium-ai/observe'

// Set up observability
const tracer = observe({
	output: ['console'],
	costTracking: true,
})

// Create LLM gateway
const llm = gateway({
	provider: 'anthropic',
	model: 'claude-sonnet-4-6',
	apiKey: env('ANTHROPIC_API_KEY'),
})

// Define a chatbot agent with memory
const chatbot = defineAgent(
	{
		name: 'chatbot',
		system: `You are a friendly and helpful assistant. Keep your responses concise but warm.
When users ask follow-up questions, use context from the conversation.`,
		model: 'claude-sonnet-4-6',
		memory: {
			strategy: 'sliding-window',
			maxMessages: 20,
		},
		guardrails: {
			maxIterations: 1,
			maxTokenBudget: 50_000,
		},
	},
	{
		complete: async (req) => {
			const span = tracer.startSpan('llm.complete', { kind: 'llm' })
			try {
				const response = await llm.complete(req)
				span.setStatus('ok')
				tracer.trackLLMCall({
					model: response.model,
					inputTokens: response.usage.inputTokens,
					outputTokens: response.usage.outputTokens,
					cost: response.cost.totalCost,
					latencyMs: response.latencyMs,
				})
				return response
			} catch (err) {
				span.setStatus('error')
				throw err
			} finally {
				span.end()
			}
		},
	},
)

function printSessionReport() {
	const report = tracer.getCostReport()
	console.log(`\n  Session cost: $${report.totalCost.toFixed(6)}`)
	console.log(`  Total tokens: ${report.totalTokens.toLocaleString()}`)
	console.log('  Goodbye!\n')
}

async function handleMessage(input: string) {
	const result = await chatbot.run(input)
	const content =
		typeof result.message.content === 'string'
			? result.message.content
			: result.message.content.map((p) => ('text' in p ? p.text : '')).join('')
	console.log(`\nAssistant: ${content}\n`)
}

async function processLine(line: string) {
	const input = line.trim()
	if (!input) {
		process.stdout.write('You: ')
		return
	}
	if (input.toLowerCase() === 'quit') {
		printSessionReport()
		process.exit(0)
	}

	try {
		await handleMessage(input)
	} catch (err) {
		console.error(`Error: ${err instanceof Error ? err.message : err}\n`)
	}

	process.stdout.write('You: ')
}

// Interactive chat loop
async function main() {
	console.log('\n  ElsiumAI Chatbot Example')
	console.log('  ─────────────────────────')
	console.log('  Type your message and press Enter.')
	console.log('  Type "quit" to exit.\n')

	const reader = Bun.stdin.stream().getReader()
	const decoder = new TextDecoder()

	process.stdout.write('You: ')

	let buffer = ''
	while (true) {
		const { done, value } = await reader.read()
		if (done) break

		buffer += decoder.decode(value, { stream: true })
		const lines = buffer.split('\n')
		buffer = lines.pop() ?? ''

		for (const line of lines) {
			await processLine(line)
		}
	}
}

main()
