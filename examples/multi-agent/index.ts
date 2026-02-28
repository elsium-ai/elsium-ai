/**
 * Example: Multi-Agent System
 *
 * Demonstrates sequential, parallel, and supervisor multi-agent patterns.
 * Uses mock providers so no API key is needed.
 *
 * Usage:
 *   bun examples/multi-agent/index.ts
 */

import { defineAgent, runParallel, runSequential } from '@elsium-ai/agents'
import type { CompletionRequest, LLMResponse } from '@elsium-ai/core'
import { generateId, generateTraceId } from '@elsium-ai/core'
import { defineWorkflow, step } from '@elsium-ai/workflows'

// Mock provider that simulates different agent personalities
function createMockProvider(role: string) {
	const responses: Record<string, string> = {
		researcher: `Based on my research, the topic involves several key aspects:
1. Market trends show significant growth in AI adoption
2. Current solutions have gaps in developer experience
3. TypeScript-first approaches are gaining traction
4. Performance and observability are underserved areas`,

		writer: `Here's a polished draft based on the research:

"The AI framework landscape is evolving rapidly. While existing solutions have
served the community well, a new wave of TypeScript-first tools is emerging.
These frameworks prioritize developer experience, type safety, and performance,
addressing long-standing pain points in the ecosystem."`,

		reviewer: `Review complete. Assessment:
- Accuracy: Good — claims are supported by research
- Clarity: Strong — language is accessible
- Completeness: Could mention specific frameworks
- Tone: Professional and balanced
- Suggestion: Add a conclusion with forward-looking statement

Overall score: 8/10`,

		summarizer: `Summary: AI frameworks are shifting toward TypeScript-first approaches
that prioritize DX, type safety, and performance. The market shows growth
potential for solutions addressing observability and testing gaps.`,
	}

	return {
		complete: async (req: CompletionRequest): Promise<LLMResponse> => {
			// Simulate some latency
			await new Promise((r) => setTimeout(r, 50))

			const content = responses[role] ?? `[${role}] Processed the input.`
			return {
				id: generateId(),
				message: { role: 'assistant', content },
				usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
				cost: { inputCost: 0.0003, outputCost: 0.0006, totalCost: 0.0009, currency: 'USD' },
				model: 'mock',
				provider: 'mock',
				stopReason: 'end_turn',
				latencyMs: 50,
				traceId: generateTraceId(),
			}
		},
	}
}

// Define specialized agents
const researcher = defineAgent(
	{
		name: 'researcher',
		system: 'You research topics thoroughly and provide structured findings.',
		model: 'mock',
	},
	{ complete: (req) => createMockProvider('researcher').complete(req) },
)

const writer = defineAgent(
	{
		name: 'writer',
		system: 'You write polished content based on research and briefs.',
		model: 'mock',
	},
	{ complete: (req) => createMockProvider('writer').complete(req) },
)

const reviewer = defineAgent(
	{
		name: 'reviewer',
		system: 'You review content for accuracy, clarity, and completeness.',
		model: 'mock',
	},
	{ complete: (req) => createMockProvider('reviewer').complete(req) },
)

const summarizer = defineAgent(
	{
		name: 'summarizer',
		system: 'You create concise summaries from longer content.',
		model: 'mock',
	},
	{ complete: (req) => createMockProvider('summarizer').complete(req) },
)

async function main() {
	console.log('\n  ElsiumAI Multi-Agent Example')
	console.log('  ─────────────────────────────\n')

	const topic = 'The future of AI development frameworks'

	// 1. Sequential pipeline: research → write → review
	console.log('  ═══ Sequential Pipeline ═══')
	console.log(`  Topic: "${topic}"\n`)

	const sequential = await runSequential([researcher, writer, reviewer], topic)
	console.log(`  Pipeline completed in ${sequential.length} steps:`)
	for (const result of sequential) {
		const content = typeof result.message.content === 'string' ? result.message.content : ''
		const preview = content.split('\n')[0]
		console.log(`    → ${preview}`)
	}
	console.log()

	// 2. Parallel execution: research + summarize simultaneously
	console.log('  ═══ Parallel Execution ═══')
	console.log('  Running researcher and summarizer in parallel...\n')

	const start = performance.now()
	const parallel = await runParallel([researcher, summarizer], topic)
	const elapsed = performance.now() - start

	console.log(`  Completed in ${elapsed.toFixed(0)}ms (concurrent):`)
	for (const result of parallel) {
		const content = typeof result.message.content === 'string' ? result.message.content : ''
		const preview = content.split('\n')[0]
		console.log(`    → ${preview}`)
	}
	console.log()

	// 3. Workflow-based pipeline
	console.log('  ═══ Workflow Pipeline ═══')

	const contentPipeline = defineWorkflow({
		name: 'content-pipeline',
		steps: [
			step('research', {
				handler: async (input: unknown) => {
					const result = await researcher.run(String(input))
					return typeof result.message.content === 'string'
						? result.message.content
						: 'Research complete.'
				},
			}),
			step('draft', {
				handler: async (input: unknown) => {
					const result = await writer.run(`Write based on: ${input}`)
					return typeof result.message.content === 'string'
						? result.message.content
						: 'Draft complete.'
				},
			}),
			step('review', {
				handler: async (input: unknown) => {
					const result = await reviewer.run(`Review: ${input}`)
					return typeof result.message.content === 'string'
						? result.message.content
						: 'Review complete.'
				},
			}),
		],
	})

	const workflowResult = await contentPipeline.run(topic)
	console.log(`  Workflow "${contentPipeline.name}" completed:`)
	console.log(`    Steps: ${workflowResult.steps.length}`)
	console.log(`    Status: ${workflowResult.status}`)
	console.log(`    Duration: ${workflowResult.totalDurationMs}ms`)

	const lastStep = workflowResult.steps[workflowResult.steps.length - 1]
	const finalOutput = lastStep?.data ? String(lastStep.data).split('\n')[0] : 'Done'
	console.log(`    Output: ${finalOutput}`)
	console.log()

	// Cost summary
	const totalCost =
		sequential.reduce((sum, r) => sum + r.usage.totalCost, 0) +
		parallel.reduce((sum, r) => sum + r.usage.totalCost, 0)

	console.log('  ─── Summary ───')
	console.log('  Total agents used: 4')
	console.log(
		`  Total API calls: ${sequential.length + parallel.length + workflowResult.steps.length}`,
	)
	console.log(`  Simulated cost: $${(totalCost + workflowResult.steps.length * 0.0009).toFixed(4)}`)
	console.log()
}

main()
