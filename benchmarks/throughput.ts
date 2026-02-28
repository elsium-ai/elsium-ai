/**
 * Benchmark: Completion overhead & throughput
 * Measures framework overhead on top of LLM call latency.
 * Target: < 5ms overhead per completion
 */

import { defineAgent } from '@elsium-ai/agents'
import type { CompletionRequest, LLMResponse } from '@elsium-ai/core'
import { generateId, generateTraceId } from '@elsium-ai/core'
import { observe } from '@elsium-ai/observe'

// Simulated provider with zero latency to isolate framework overhead
function noopProvider() {
	let calls = 0
	return {
		complete: async (_req: CompletionRequest): Promise<LLMResponse> => {
			calls++
			return {
				id: generateId(),
				message: { role: 'assistant', content: 'Response from mock.' },
				usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
				cost: { inputCost: 0, outputCost: 0, totalCost: 0, currency: 'USD' },
				model: 'noop',
				provider: 'noop',
				stopReason: 'end_turn',
				latencyMs: 0,
				traceId: generateTraceId(),
			}
		},
		getCalls: () => calls,
	}
}

async function benchmarkCompletionOverhead(iterations: number) {
	const provider = noopProvider()
	const agent = defineAgent(
		{
			name: 'bench-agent',
			system: 'You are a test agent.',
			model: 'noop',
		},
		{ complete: (req) => provider.complete(req) },
	)

	const results: number[] = []

	for (let i = 0; i < iterations; i++) {
		const start = performance.now()
		await agent.run('Hello')
		const elapsed = performance.now() - start
		results.push(elapsed)
	}

	return results
}

async function benchmarkWithMultipleAgents(iterations: number) {
	const provider = noopProvider()

	// Create 10 agents and round-robin between them
	const agents = Array.from({ length: 10 }, (_, i) =>
		defineAgent(
			{
				name: `bench-agent-${i}`,
				system: `You are test agent number ${i}.`,
				model: 'noop',
			},
			{ complete: (req) => provider.complete(req) },
		),
	)

	const results: number[] = []

	for (let i = 0; i < iterations; i++) {
		const agent = agents[i % agents.length]
		const start = performance.now()
		await agent.run('Hello')
		const elapsed = performance.now() - start
		results.push(elapsed)
	}

	return results
}

async function benchmarkWithTracing(iterations: number) {
	const provider = noopProvider()
	const tracer = observe({ output: [], samplingRate: 1.0 })

	const agent = defineAgent(
		{
			name: 'bench-traced-agent',
			system: 'You are a test agent.',
			model: 'noop',
		},
		{ complete: (req) => provider.complete(req) },
	)

	const results: number[] = []

	for (let i = 0; i < iterations; i++) {
		const span = tracer.startSpan('agent.run')
		const start = performance.now()
		await agent.run('Hello')
		span.end()
		const elapsed = performance.now() - start
		results.push(elapsed)
	}

	return results
}

function stats(results: number[]) {
	const sorted = [...results].sort((a, b) => a - b)
	const avg = results.reduce((a, b) => a + b, 0) / results.length
	const ops = 1000 / avg
	return {
		avg: avg.toFixed(3),
		min: sorted[0].toFixed(3),
		max: sorted[sorted.length - 1].toFixed(3),
		p50: sorted[Math.floor(sorted.length * 0.5)].toFixed(3),
		p99: sorted[Math.floor(sorted.length * 0.99)].toFixed(3),
		ops: ops.toFixed(0),
	}
}

async function main() {
	const iterations = 1000

	console.log('\n  ElsiumAI Throughput Benchmarks')
	console.log('  ══════════════════════════════════════════')
	console.log(`  Iterations: ${iterations}\n`)

	// Warmup
	await benchmarkCompletionOverhead(10)

	console.log('  Agent Completion (no tools, no tracing)')
	const basic = await benchmarkCompletionOverhead(iterations)
	const basicStats = stats(basic)
	console.log(`    avg: ${basicStats.avg}ms  p50: ${basicStats.p50}ms  p99: ${basicStats.p99}ms`)
	console.log(`    ops/sec: ${basicStats.ops}`)
	console.log(`    target: < 5ms  ${Number(basicStats.avg) < 5 ? '✓ PASS' : '✗ FAIL'}\n`)

	console.log('  Agent Completion (10 agents, round-robin)')
	const multiAgent = await benchmarkWithMultipleAgents(iterations)
	const multiStats = stats(multiAgent)
	console.log(`    avg: ${multiStats.avg}ms  p50: ${multiStats.p50}ms  p99: ${multiStats.p99}ms`)
	console.log(`    ops/sec: ${multiStats.ops}\n`)

	console.log('  Agent Completion (with tracing)')
	const withTracing = await benchmarkWithTracing(iterations)
	const traceStats = stats(withTracing)
	console.log(`    avg: ${traceStats.avg}ms  p50: ${traceStats.p50}ms  p99: ${traceStats.p99}ms`)
	console.log(`    ops/sec: ${traceStats.ops}\n`)
}

main()
