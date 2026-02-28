/**
 * Benchmark: Memory usage
 * Measures memory consumption per agent and for the full framework.
 * Target: < 10MB per agent
 */

import { defineAgent } from '@elsium-ai/agents'
import { createMemory } from '@elsium-ai/agents'
import type { CompletionRequest, LLMResponse } from '@elsium-ai/core'
import { generateId, generateTraceId } from '@elsium-ai/core'

function noopProvider() {
	return {
		complete: async (_req: CompletionRequest): Promise<LLMResponse> => ({
			id: generateId(),
			message: { role: 'assistant', content: 'Response.' },
			usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
			cost: { inputCost: 0, outputCost: 0, totalCost: 0, currency: 'USD' },
			model: 'noop',
			provider: 'noop',
			stopReason: 'end_turn',
			latencyMs: 0,
			traceId: generateTraceId(),
		}),
	}
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function getMemoryUsage() {
	if (typeof Bun !== 'undefined') {
		return process.memoryUsage()
	}
	return process.memoryUsage()
}

async function main() {
	console.log('\n  ElsiumAI Memory Benchmarks')
	console.log('  ══════════════════════════════════════════\n')

	// Baseline memory
	global.gc?.()
	const baseline = getMemoryUsage()
	console.log('  Baseline Memory')
	console.log(`    RSS:       ${formatBytes(baseline.rss)}`)
	console.log(`    Heap Used: ${formatBytes(baseline.heapUsed)}`)
	console.log(`    Heap Total:${formatBytes(baseline.heapTotal)}\n`)

	// Single agent
	const provider = noopProvider()
	const agent = defineAgent(
		{
			name: 'single-agent',
			system: 'You are a test agent.',
			model: 'noop',
		},
		{ complete: (req) => provider.complete(req) },
	)

	global.gc?.()
	const singleAgent = getMemoryUsage()
	const singleDelta = singleAgent.heapUsed - baseline.heapUsed
	console.log('  Single Agent')
	console.log(`    Heap Delta: ${formatBytes(singleDelta)}`)
	console.log(`    target: < 10MB  ${singleDelta < 10 * 1024 * 1024 ? '✓ PASS' : '✗ FAIL'}\n`)

	// 100 agents
	const agents = []
	for (let i = 0; i < 100; i++) {
		agents.push(
			defineAgent(
				{
					name: `agent-${i}`,
					system: `You are agent number ${i}.`,
					model: 'noop',
				},
				{ complete: (req) => provider.complete(req) },
			),
		)
	}

	global.gc?.()
	const hundredAgents = getMemoryUsage()
	const hundredDelta = hundredAgents.heapUsed - singleAgent.heapUsed
	const perAgent = hundredDelta / 100
	console.log('  100 Agents')
	console.log(`    Total Heap Delta: ${formatBytes(hundredDelta)}`)
	console.log(`    Per Agent:        ${formatBytes(perAgent)}`)
	console.log(`    target: < 10MB/agent  ${perAgent < 10 * 1024 * 1024 ? '✓ PASS' : '✗ FAIL'}\n`)

	// Agents with memory config
	const heavyAgents = []
	for (let i = 0; i < 100; i++) {
		heavyAgents.push(
			defineAgent(
				{
					name: `heavy-agent-${i}`,
					system: `You are agent ${i} with memory. `.repeat(10),
					model: 'noop',
					memory: { strategy: 'sliding-window', maxMessages: 100 },
				},
				{
					complete: (req) => provider.complete(req),
				},
			),
		)
	}

	global.gc?.()
	const heavyMem = getMemoryUsage()
	const heavyDelta = heavyMem.heapUsed - hundredAgents.heapUsed
	const perHeavy = heavyDelta / 100
	console.log('  100 Agents (with memory config)')
	console.log(`    Total Heap Delta: ${formatBytes(heavyDelta)}`)
	console.log(`    Per Agent:        ${formatBytes(perHeavy)}`)
	console.log(`    target: < 10MB/agent  ${perHeavy < 10 * 1024 * 1024 ? '✓ PASS' : '✗ FAIL'}\n`)

	// Final summary
	const final = getMemoryUsage()
	console.log('  Final Memory')
	console.log(`    RSS:        ${formatBytes(final.rss)}`)
	console.log(`    Heap Used:  ${formatBytes(final.heapUsed)}`)
	console.log(`    Heap Total: ${formatBytes(final.heapTotal)}`)
	console.log()
}

main()
