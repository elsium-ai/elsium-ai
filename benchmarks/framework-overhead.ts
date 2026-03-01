#!/usr/bin/env bun

/**
 * Benchmark: Framework Overhead — Enterprise Grade
 *
 * Measures real P50/P95/P99 latencies for the ElsiumAI framework
 * with a zero-latency provider to isolate framework overhead from network time.
 *
 * Scenarios:
 *   1. Bare completion (no middleware)
 *   2. Full middleware stack (logging + cost + xray + security + audit + policy)
 *   3. Concurrent load (100 parallel requests)
 *   4. Middleware scaling (1, 3, 5, 7 layers)
 *   5. Memory under sustained load
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineAgent } from '@elsium-ai/agents'
import type { CompletionRequest, LLMResponse, Logger, Middleware } from '@elsium-ai/core'
import {
	createCircuitBreaker,
	createPolicySet,
	generateId,
	generateTraceId,
	modelAccessPolicy,
	policyMiddleware,
} from '@elsium-ai/core'
import {
	composeMiddleware,
	costTrackingMiddleware,
	loggingMiddleware,
	securityMiddleware,
	xrayMiddleware,
} from '@elsium-ai/gateway'
import { auditMiddleware, createAuditTrail, observe } from '@elsium-ai/observe'

// ─── Environment ────────────────────────────────────────────────

const ENV = {
	runtime: typeof Bun !== 'undefined' ? `Bun ${Bun.version}` : `Node ${process.version}`,
	platform: `${process.platform} ${process.arch}`,
	cpus: (() => {
		const cpus = require('node:os').cpus()
		return `${cpus[0]?.model?.trim() ?? 'unknown'} (${cpus.length} cores)`
	})(),
	memory: `${Math.round(require('node:os').totalmem() / (1024 * 1024 * 1024))}GB`,
}

// ─── Noop Provider ──────────────────────────────────────────────

function noopProvider() {
	return {
		complete: async (_req: CompletionRequest): Promise<LLMResponse> => ({
			id: generateId(),
			message: { role: 'assistant' as const, content: 'Response from mock provider.' },
			usage: { inputTokens: 150, outputTokens: 50, totalTokens: 200 },
			cost: { inputCost: 0.00045, outputCost: 0.00075, totalCost: 0.0012, currency: 'USD' },
			model: 'noop',
			provider: 'noop',
			stopReason: 'end_turn' as const,
			latencyMs: 0,
			traceId: generateTraceId(),
		}),
	}
}

// ─── Silent logger (suppresses output during benchmarks) ────────

const silentLogger: Logger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
	child: () => silentLogger,
}

// ─── Stats ──────────────────────────────────────────────────────

interface Stats {
	avg: number
	min: number
	max: number
	p50: number
	p95: number
	p99: number
	opsPerSec: number
	samples: number
}

function computeStats(results: number[]): Stats {
	const sorted = [...results].sort((a, b) => a - b)
	const sum = sorted.reduce((a, b) => a + b, 0)
	const avg = sum / sorted.length
	return {
		avg,
		min: sorted[0],
		max: sorted[sorted.length - 1],
		p50: sorted[Math.floor(sorted.length * 0.5)],
		p95: sorted[Math.floor(sorted.length * 0.95)],
		p99: sorted[Math.floor(sorted.length * 0.99)],
		opsPerSec: Math.round(1000 / avg),
		samples: sorted.length,
	}
}

function fmt(ms: number): string {
	return ms < 0.01 ? `${(ms * 1000).toFixed(1)}μs` : `${ms.toFixed(3)}ms`
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

// ─── Benchmark Harness ──────────────────────────────────────────

async function measure(
	name: string,
	fn: () => Promise<void>,
	opts: { warmup?: number; iterations?: number } = {},
): Promise<Stats> {
	const warmup = opts.warmup ?? 50
	const iterations = opts.iterations ?? 1000

	// Warmup phase — discard results
	for (let i = 0; i < warmup; i++) await fn()

	// Measurement phase
	const results: number[] = []
	for (let i = 0; i < iterations; i++) {
		const start = performance.now()
		await fn()
		results.push(performance.now() - start)
	}

	return computeStats(results)
}

// ─── Build Middleware Stacks ────────────────────────────────────

function buildMiddlewareStack(layers: string[]): { middleware: Middleware; description: string } {
	const stack: Middleware[] = []

	for (const layer of layers) {
		switch (layer) {
			case 'logging':
				stack.push(loggingMiddleware(silentLogger))
				break
			case 'cost':
				stack.push(costTrackingMiddleware())
				break
			case 'xray':
				stack.push(xrayMiddleware({ maxHistory: 100 }))
				break
			case 'security':
				stack.push(
					securityMiddleware({
						promptInjection: true,
						jailbreakDetection: true,
						secretRedaction: true,
					}),
				)
				break
			case 'audit': {
				const trail = createAuditTrail({ hashChain: true, maxEvents: 10_000 })
				stack.push(auditMiddleware(trail))
				break
			}
			case 'policy': {
				const policies = createPolicySet([
					modelAccessPolicy(['noop', 'claude-sonnet-4-6', 'gpt-4o']),
				])
				stack.push(policyMiddleware(policies))
				break
			}
		}
	}

	return {
		middleware: composeMiddleware(stack),
		description: layers.join(' + '),
	}
}

// ─── Scenario: Bare Completion ──────────────────────────────────

async function scenarioBareCompletion(): Promise<Stats> {
	const provider = noopProvider()
	const agent = defineAgent(
		{ name: 'bare-agent', system: 'You are a test agent.', model: 'noop' },
		{ complete: (req) => provider.complete(req) },
	)

	return measure('Bare completion', () => agent.run('Hello, respond briefly.'))
}

// ─── Scenario: Direct Gateway Call (no agent) ───────────────────

async function scenarioDirectGateway(): Promise<Stats> {
	const provider = noopProvider()

	const request: CompletionRequest = {
		messages: [{ role: 'user', content: 'Hello, respond briefly.' }],
	}

	return measure('Direct gateway', async () => {
		await provider.complete(request)
	})
}

// ─── Scenario: With Middleware Stack ────────────────────────────

async function scenarioWithMiddleware(layers: string[]): Promise<Stats> {
	const provider = noopProvider()
	const { middleware } = buildMiddlewareStack(layers)

	const request: CompletionRequest = {
		messages: [{ role: 'user', content: 'Hello, respond briefly. This is a normal user request.' }],
	}

	const baseCtx = {
		request,
		provider: 'noop',
		model: 'noop',
		startTime: 0,
		metadata: {},
	}

	return measure(`Middleware: ${layers.join('+')}`, async () => {
		const ctx = { ...baseCtx, traceId: generateTraceId(), startTime: Date.now() }
		await middleware(ctx, () => provider.complete(request))
	})
}

// ─── Scenario: Concurrent Load ──────────────────────────────────

async function scenarioConcurrent(concurrency: number): Promise<Stats> {
	const provider = noopProvider()
	const { middleware } = buildMiddlewareStack([
		'logging',
		'cost',
		'xray',
		'security',
		'audit',
		'policy',
	])

	const request: CompletionRequest = {
		messages: [{ role: 'user', content: 'Hello, respond briefly.' }],
	}

	const baseCtx = {
		request,
		provider: 'noop',
		model: 'noop',
		startTime: 0,
		metadata: {},
	}

	// Warmup
	for (let i = 0; i < 20; i++) {
		const ctx = { ...baseCtx, traceId: generateTraceId(), startTime: Date.now() }
		await middleware(ctx, () => provider.complete(request))
	}

	// Measure batches of concurrent requests
	const batchResults: number[] = []
	const batches = 100

	for (let b = 0; b < batches; b++) {
		const batchStart = performance.now()
		const promises = Array.from({ length: concurrency }, () => {
			const ctx = { ...baseCtx, traceId: generateTraceId(), startTime: Date.now() }
			return middleware(ctx, () => provider.complete(request))
		})
		await Promise.all(promises)
		batchResults.push((performance.now() - batchStart) / concurrency)
	}

	return computeStats(batchResults)
}

// ─── Scenario: Middleware Scaling ────────────────────────────────

async function scenarioMiddlewareScaling(): Promise<Map<number, Stats>> {
	const provider = noopProvider()
	const results = new Map<number, Stats>()

	const allLayers = ['logging', 'cost', 'xray', 'security', 'audit', 'policy']

	for (const count of [0, 1, 2, 3, 4, 5, 6]) {
		const layers = allLayers.slice(0, count)

		if (count === 0) {
			// No middleware — direct provider call
			const request: CompletionRequest = {
				messages: [{ role: 'user', content: 'Hello.' }],
			}
			const stats = await measure('no-middleware', async () => {
				await provider.complete(request)
			})
			results.set(count, stats)
		} else {
			const { middleware } = buildMiddlewareStack(layers)
			const request: CompletionRequest = {
				messages: [{ role: 'user', content: 'Hello, respond briefly.' }],
			}
			const baseCtx = {
				request,
				provider: 'noop',
				model: 'noop',
				startTime: 0,
				metadata: {},
			}

			const stats = await measure(`${count}-middleware`, async () => {
				const ctx = { ...baseCtx, traceId: generateTraceId(), startTime: Date.now() }
				await middleware(ctx, () => provider.complete(request))
			})
			results.set(count, stats)
		}
	}

	return results
}

// ─── Scenario: Memory Under Load ────────────────────────────────

async function scenarioMemory(): Promise<{
	baseline: NodeJS.MemoryUsage
	after1k: NodeJS.MemoryUsage
	after10k: NodeJS.MemoryUsage
	perRequestBytes: number
}> {
	const provider = noopProvider()
	const trail = createAuditTrail({ hashChain: true, maxEvents: 10_000 })
	const tracer = observe({ output: [], samplingRate: 1.0 })
	const { middleware } = buildMiddlewareStack(['logging', 'cost', 'xray', 'security', 'policy'])
	// Add audit separately since we need a reference to the trail
	const auditMw = auditMiddleware(trail)
	const fullMiddleware = composeMiddleware([middleware, auditMw])

	const request: CompletionRequest = {
		messages: [{ role: 'user', content: 'Hello, respond briefly.' }],
	}
	const baseCtx = {
		request,
		provider: 'noop',
		model: 'noop',
		startTime: 0,
		metadata: {},
	}

	global.gc?.()
	const baseline = process.memoryUsage()

	// 1K requests
	for (let i = 0; i < 1000; i++) {
		const span = tracer.startSpan('request', 'request')
		const ctx = { ...baseCtx, traceId: generateTraceId(), startTime: Date.now() }
		await fullMiddleware(ctx, () => provider.complete(request))
		span.end()
	}

	global.gc?.()
	const after1k = process.memoryUsage()

	// 9K more (total 10K)
	for (let i = 0; i < 9000; i++) {
		const span = tracer.startSpan('request', 'request')
		const ctx = { ...baseCtx, traceId: generateTraceId(), startTime: Date.now() }
		await fullMiddleware(ctx, () => provider.complete(request))
		span.end()
	}

	global.gc?.()
	const after10k = process.memoryUsage()

	const heapGrowth = after10k.heapUsed - baseline.heapUsed
	const perRequestBytes = Math.round(heapGrowth / 10_000)

	return { baseline, after1k, after10k, perRequestBytes }
}

// ─── Scenario: Circuit Breaker Throughput ───────────────────────

async function scenarioCircuitBreaker(): Promise<Stats> {
	const cb = createCircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 30_000 })

	return measure(
		'Circuit breaker',
		async () => {
			await cb.execute(async () => 'ok')
		},
		{ iterations: 10_000 },
	)
}

// ─── Report ─────────────────────────────────────────────────────

function printHeader() {
	console.log()
	console.log('  ╔══════════════════════════════════════════════════════════════════╗')
	console.log('  ║          ElsiumAI Framework Overhead — Benchmark Report         ║')
	console.log('  ╚══════════════════════════════════════════════════════════════════╝')
	console.log()
	console.log('  Methodology')
	console.log('  ──────────────────────────────────────────────────────────────────')
	console.log(`  Runtime:      ${ENV.runtime}`)
	console.log(`  Platform:     ${ENV.platform}`)
	console.log(`  CPU:          ${ENV.cpus}`)
	console.log(`  Memory:       ${ENV.memory}`)
	console.log('  Provider:     noop (zero-latency mock — isolates framework overhead)')
	console.log('  Warmup:       50 iterations discarded')
	console.log('  Iterations:   1,000 per scenario (100 batches for concurrency)')
	console.log()
}

function printStats(label: string, s: Stats, target?: { maxP95: number }) {
	const pass = target ? s.p95 <= target.maxP95 : undefined
	const passStr =
		pass === undefined
			? ''
			: pass
				? '  ✓ PASS'
				: `  ✗ FAIL (target: P95 < ${fmt(target?.maxP95 ?? 0)})`

	console.log(`  ${label}`)
	console.log(
		`    P50: ${fmt(s.p50).padStart(10)}    P95: ${fmt(s.p95).padStart(10)}    P99: ${fmt(s.p99).padStart(10)}${passStr}`,
	)
	console.log(
		`    Avg: ${fmt(s.avg).padStart(10)}    Min: ${fmt(s.min).padStart(10)}    Max: ${fmt(s.max).padStart(10)}    ops/s: ${s.opsPerSec.toLocaleString()}`,
	)
	console.log()
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
	printHeader()

	// 1. Baseline overhead
	console.log('  1. Framework Overhead (vs raw provider call)')
	console.log('  ──────────────────────────────────────────────────────────────────')

	const directStats = await scenarioDirectGateway()
	printStats('Direct provider call (baseline)', directStats)

	const bareStats = await scenarioBareCompletion()
	printStats('Agent completion (no middleware)', bareStats, { maxP95: 5 })

	// 2. Individual middleware
	console.log('  2. Individual Middleware Cost')
	console.log('  ──────────────────────────────────────────────────────────────────')

	for (const layer of ['logging', 'cost', 'xray', 'security', 'audit', 'policy']) {
		const stats = await scenarioWithMiddleware([layer])
		printStats(`+ ${layer}`, stats)
	}

	// 3. Full middleware stack
	console.log('  3. Full Middleware Stack')
	console.log('  ──────────────────────────────────────────────────────────────────')

	const fullStack = await scenarioWithMiddleware([
		'logging',
		'cost',
		'xray',
		'security',
		'audit',
		'policy',
	])
	printStats('All middleware enabled', fullStack, { maxP95: 15 })

	// 4. Middleware scaling curve
	console.log('  4. Middleware Scaling (overhead vs layer count)')
	console.log('  ──────────────────────────────────────────────────────────────────')

	const scalingResults = await scenarioMiddlewareScaling()
	const layers = ['(none)', 'logging', '+cost', '+xray', '+security', '+audit', '+policy']
	console.log(
		`  ${'Layers'.padEnd(14)} ${'P50'.padStart(10)} ${'P95'.padStart(10)} ${'P99'.padStart(10)} ${'ops/s'.padStart(10)}`,
	)
	console.log(`  ${'─'.repeat(56)}`)
	for (const [count, stats] of scalingResults) {
		console.log(
			`  ${layers[count].padEnd(14)} ${fmt(stats.p50).padStart(10)} ${fmt(stats.p95).padStart(10)} ${fmt(stats.p99).padStart(10)} ${stats.opsPerSec.toLocaleString().padStart(10)}`,
		)
	}
	console.log()

	// 5. Concurrent load
	console.log('  5. Concurrent Load (full middleware stack)')
	console.log('  ──────────────────────────────────────────────────────────────────')

	let concurrent100Stats: Stats | null = null
	for (const concurrency of [10, 50, 100]) {
		const stats = await scenarioConcurrent(concurrency)
		if (concurrency === 100) concurrent100Stats = stats
		printStats(`${concurrency} concurrent requests`, stats)
	}

	// 6. Circuit breaker throughput
	console.log('  6. Component Throughput')
	console.log('  ──────────────────────────────────────────────────────────────────')

	const cbStats = await scenarioCircuitBreaker()
	printStats('Circuit breaker (execute)', cbStats)

	// 7. Memory under sustained load
	console.log('  7. Memory Under Sustained Load (full stack + tracing + audit)')
	console.log('  ──────────────────────────────────────────────────────────────────')

	const mem = await scenarioMemory()
	console.log(
		'  GC forced between measurements. Audit: 10K events (hash chain). Tracer: 10K spans.',
	)
	console.log()
	console.log(
		`  ${'Checkpoint'.padEnd(24)} ${'Heap Used'.padStart(12)} ${'Delta'.padStart(12)} ${'RSS'.padStart(12)}`,
	)
	console.log(`  ${'─'.repeat(60)}`)
	console.log(
		`  ${'Baseline'.padEnd(24)} ${formatBytes(mem.baseline.heapUsed).padStart(12)} ${'—'.padStart(12)} ${formatBytes(mem.baseline.rss).padStart(12)}`,
	)
	console.log(
		`  ${'After 1K requests'.padEnd(24)} ${formatBytes(mem.after1k.heapUsed).padStart(12)} ${`+${formatBytes(mem.after1k.heapUsed - mem.baseline.heapUsed)}`.padStart(12)} ${formatBytes(mem.after1k.rss).padStart(12)}`,
	)
	console.log(
		`  ${'After 10K requests'.padEnd(24)} ${formatBytes(mem.after10k.heapUsed).padStart(12)} ${`+${formatBytes(mem.after10k.heapUsed - mem.baseline.heapUsed)}`.padStart(12)} ${formatBytes(mem.after10k.rss).padStart(12)}`,
	)
	console.log()
	console.log(`  Per-request heap growth: ~${formatBytes(mem.perRequestBytes)}`)
	console.log()

	// Summary — Framework Cost (Isolated)
	console.log('  ══════════════════════════════════════════════════════════════════')
	console.log('  Framework Cost (Isolated)')
	console.log('  ──────────────────────────────────────────────────────────────────')
	console.log('  Measured with zero-latency mock provider to isolate framework overhead.')
	console.log('  These numbers represent the cost of the framework itself — not network I/O,')
	console.log('  not provider latency, not real crypto exports, not external storage.')
	console.log()
	console.log(
		`  ${'Metric'.padEnd(40)} ${'P50'.padStart(10)} ${'P95'.padStart(10)} ${'Conditions'.padStart(30)}`,
	)
	console.log(`  ${'─'.repeat(90)}`)
	console.log(
		`  ${'Core completion path'.padEnd(40)} ${fmt(bareStats.p50).padStart(10)} ${fmt(bareStats.p95).padStart(10)} ${'agent, no middleware'.padStart(30)}`,
	)
	console.log(
		`  ${'Full governance stack'.padEnd(40)} ${fmt(fullStack.p50).padStart(10)} ${fmt(fullStack.p95).padStart(10)} ${'all 6 layers'.padStart(30)}`,
	)
	console.log(
		`  ${'Under concurrency'.padEnd(40)} ${fmt((concurrent100Stats ?? fullStack).p50).padStart(10)} ${fmt((concurrent100Stats ?? fullStack).p95).padStart(10)} ${'100 parallel, full stack'.padStart(30)}`,
	)
	console.log()

	// Real-world context
	console.log('  Real-World Context')
	console.log('  ──────────────────────────────────────────────────────────────────')
	const typicalLlmMs = 500
	const overheadMs = fullStack.p95 / 1000 // convert μs approximation
	const pct = (fullStack.p95 / 1000 / typicalLlmMs) * 100
	console.log('  Typical LLM network latency:     200–800ms')
	console.log(`  ElsiumAI overhead at P95:         ${fmt(fullStack.p95)}`)
	console.log(
		`  Framework cost contribution:      <${pct < 0.01 ? '0.01' : pct.toFixed(3)}% of total request time`,
	)
	console.log()

	// Memory
	console.log('  Memory')
	console.log('  ──────────────────────────────────────────────────────────────────')
	const heapGrowth = mem.after10k.heapUsed - mem.baseline.heapUsed
	console.log(`  Heap growth after 10K requests:   ${formatBytes(heapGrowth)}`)
	console.log(`  Per-request heap growth:          ~${formatBytes(mem.perRequestBytes)}`)
	console.log(
		'  Conditions:                       full stack + tracing (10K spans) + audit (hash chain)',
	)
	console.log('  GC:                               forced between measurements')
	console.log('  Audit entries retained:            10,000 (in-memory, capped)')
	console.log('  Tracer spans retained:             10,000 (in-memory, capped)')
	console.log()

	// Component throughput
	console.log('  Component Throughput (synthetic, internal state transitions)')
	console.log('  ──────────────────────────────────────────────────────────────────')
	console.log(`  Circuit breaker:                  ${cbStats.opsPerSec.toLocaleString()} ops/s`)
	console.log('  (Pure state machine transitions — not real LLM calls)')
	console.log()
	console.log('  ══════════════════════════════════════════════════════════════════')
	console.log()

	// ─── Export JSON Results ────────────────────────────────────────
	const c100 = concurrent100Stats ?? fullStack
	const results = {
		version: '0.1.0',
		timestamp: new Date().toISOString(),
		environment: ENV,
		scenarios: {
			directProvider: roundStats(directStats),
			agentCompletion: roundStats(bareStats),
			fullMiddlewareStack: roundStats(fullStack),
			concurrent100: roundStats(c100),
			circuitBreaker: roundStats(cbStats),
		},
		middleware: {
			logging: roundStats(await scenarioWithMiddleware(['logging'])),
			cost: roundStats(await scenarioWithMiddleware(['cost'])),
			xray: roundStats(await scenarioWithMiddleware(['xray'])),
			security: roundStats(await scenarioWithMiddleware(['security'])),
			audit: roundStats(await scenarioWithMiddleware(['audit'])),
			policy: roundStats(await scenarioWithMiddleware(['policy'])),
		},
		memory: {
			heapGrowth10k: mem.after10k.heapUsed - mem.baseline.heapUsed,
			perRequestBytes: mem.perRequestBytes,
			rss10k: mem.after10k.rss,
		},
		thresholds: {
			agentCompletionP95: { limit: 5, unit: 'ms', actual: bareStats.p95 },
			fullStackP95: { limit: 15, unit: 'ms', actual: fullStack.p95 },
		},
	}

	const outPath = join(import.meta.dir, 'results', 'latest.json')
	writeFileSync(outPath, JSON.stringify(results, null, '\t'))
	console.log(`  Results written to: ${outPath}`)
	console.log()
}

function roundStats(s: Stats) {
	return {
		p50: round(s.p50),
		p95: round(s.p95),
		p99: round(s.p99),
		avg: round(s.avg),
		min: round(s.min),
		max: round(s.max),
		opsPerSec: s.opsPerSec,
		samples: s.samples,
	}
}

function round(n: number) {
	return Math.round(n * 10000) / 10000
}

main().catch(console.error)
