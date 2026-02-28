/**
 * Example: API Server with Tools
 *
 * An HTTP server exposing an agent with custom tools.
 * Demonstrates: app server, middleware, tools, agents, workflow.
 *
 * Usage:
 *   export ANTHROPIC_API_KEY=your-key
 *   bun examples/api-server/index.ts
 *
 * Then:
 *   curl http://localhost:3000/health
 *   curl -X POST http://localhost:3000/chat \
 *     -H "Content-Type: application/json" \
 *     -d '{"message": "What time is it?", "agent": "assistant"}'
 */

import { defineAgent } from '@elsium-ai/agents'
import { createApp } from '@elsium-ai/app'
import { env } from '@elsium-ai/core'
import { gateway } from '@elsium-ai/gateway'
import { createToolkit, defineTool } from '@elsium-ai/tools'
import { defineWorkflow, step } from '@elsium-ai/workflows'
import { z } from 'zod'

// ─── Tools ──────────────────────────────────────────────────────

const weatherTool = defineTool({
	name: 'get_weather',
	description: 'Get the current weather for a location',
	parameters: z.object({
		city: z.string().describe('City name'),
		unit: z.enum(['celsius', 'fahrenheit']).optional().describe('Temperature unit'),
	}),
	execute: async ({ city, unit = 'celsius' }) => {
		// Simulated weather data
		const weather: Record<string, { temp: number; condition: string }> = {
			london: { temp: 12, condition: 'cloudy' },
			tokyo: { temp: 22, condition: 'sunny' },
			'new york': { temp: 18, condition: 'partly cloudy' },
			paris: { temp: 15, condition: 'rainy' },
		}

		const data = weather[city.toLowerCase()] ?? { temp: 20, condition: 'unknown' }
		const temp = unit === 'fahrenheit' ? data.temp * 1.8 + 32 : data.temp

		return {
			city,
			temperature: temp,
			unit,
			condition: data.condition,
			timestamp: new Date().toISOString(),
		}
	},
})

const calculatorTool = defineTool({
	name: 'calculate',
	description: 'Perform a mathematical calculation',
	parameters: z.object({
		expression: z.string().describe('Math expression like "2 + 2" or "sqrt(16)"'),
	}),
	execute: async ({ expression }) => {
		// Safe math evaluation
		const mathFns: Record<string, (...args: number[]) => number> = {
			sqrt: Math.sqrt,
			abs: Math.abs,
			round: Math.round,
			floor: Math.floor,
			ceil: Math.ceil,
			min: Math.min,
			max: Math.max,
			pow: Math.pow,
		}

		const sanitized = expression.replace(/[^0-9+\-*/().%\s,a-z]/gi, '')
		const withFns = sanitized.replace(/([a-z]+)\s*\(/gi, (_, name: string) => {
			if (name.toLowerCase() in mathFns) {
				return `__math.${name.toLowerCase()}(`
			}
			throw new Error(`Unknown function: ${name}`)
		})

		const fn = new Function('__math', `"use strict"; return (${withFns})`)
		const result = fn(mathFns)

		return { expression, result }
	},
})

const toolkit = createToolkit('assistant-tools', [weatherTool, calculatorTool])

// ─── Gateway ────────────────────────────────────────────────────

const useRealLLM = !!process.env.ANTHROPIC_API_KEY

const llm = useRealLLM
	? gateway({
			provider: 'anthropic',
			model: 'claude-sonnet-4-6',
			apiKey: env('ANTHROPIC_API_KEY'),
		})
	: null

// Mock provider for demo without API key
const mockComplete = async (req: import('@elsium-ai/core').CompletionRequest) => {
	const { generateId, generateTraceId } = await import('@elsium-ai/core')
	const lastMessage = req.messages[req.messages.length - 1]
	const input = typeof lastMessage.content === 'string' ? lastMessage.content : ''

	return {
		id: generateId(),
		message: {
			role: 'assistant' as const,
			content: `[Mock] I received: "${input.slice(0, 50)}". Set ANTHROPIC_API_KEY for real responses.`,
		},
		usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
		cost: { inputCost: 0, outputCost: 0, totalCost: 0, currency: 'USD' as const },
		model: 'mock',
		provider: 'mock',
		stopReason: 'end_turn' as const,
		latencyMs: 1,
		traceId: generateTraceId(),
	}
}

// ─── Agents ─────────────────────────────────────────────────────

const assistant = defineAgent(
	{
		name: 'assistant',
		system: `You are a helpful assistant with access to tools.
You can check the weather and perform calculations.
Always be concise and helpful.`,
		model: 'claude-sonnet-4-6',
		tools: [weatherTool, calculatorTool],
		memory: {
			strategy: 'sliding-window',
			maxMessages: 10,
		},
		guardrails: {
			maxIterations: 5,
			maxTokenBudget: 100_000,
		},
	},
	{
		complete: (req) => (llm ? llm.complete(req) : mockComplete(req)),
	},
)

const coder = defineAgent(
	{
		name: 'coder',
		system: `You are a coding assistant. Help users with programming questions.
Provide clear, concise code examples. Always specify the language.`,
		model: 'claude-sonnet-4-6',
	},
	{
		complete: (req) => (llm ? llm.complete(req) : mockComplete(req)),
	},
)

// ─── App ────────────────────────────────────────────────────────

const app = createApp({
	gateway: {
		providers: useRealLLM ? { anthropic: { apiKey: env('ANTHROPIC_API_KEY') } } : {},
		defaultModel: 'claude-sonnet-4-6',
	},
	agents: [assistant, coder],
	observe: {
		tracing: true,
		costTracking: true,
	},
	server: {
		port: 3000,
		cors: {
			origin: '*',
			methods: ['GET', 'POST'],
		},
		rateLimit: {
			windowMs: 60_000,
			max: 100,
		},
	},
})

console.log(`
  ElsiumAI API Server Example
  ─────────────────────────────
  Mode: ${useRealLLM ? 'Live (Anthropic)' : 'Mock (set ANTHROPIC_API_KEY for live)'}
  Port: 3000

  Endpoints:
    GET  /health     Health check
    GET  /metrics    Usage metrics
    GET  /agents     List agents
    POST /chat       Chat with an agent
    POST /complete   Raw LLM completion

  Try it:
    curl http://localhost:3000/health
    curl http://localhost:3000/agents
    curl -X POST http://localhost:3000/chat \\
      -H "Content-Type: application/json" \\
      -d '{"message": "What is the weather in Tokyo?", "agent": "assistant"}'
`)

app.listen()
