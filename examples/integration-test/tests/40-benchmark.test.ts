import {
	createCircuitBreaker,
	createDedup,
	createPolicySet,
	modelAccessPolicy,
	policyMiddleware,
} from '@elsium-ai/core'
import { createBulkhead, gateway, registerProviderFactory } from '@elsium-ai/gateway'
import { auditMiddleware, createAuditTrail, createCostEngine } from '@elsium-ai/observe'
import { mockProvider } from '@elsium-ai/testing'
/**
 * Test 40: Performance Benchmark
 * Verifies: cold start, middleware overhead, throughput — validates README claims
 */
import { describe, expect, it } from 'vitest'

describe('40 — Performance Benchmark', () => {
	it('cold start: all core imports resolve in < 50ms', () => {
		const start = performance.now()

		// Simulate cold-start by exercising all factory functions
		const audit = createAuditTrail()
		const cb = createCircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 10_000 })
		const dedup = createDedup({ ttlMs: 1000 })
		const policies = createPolicySet([modelAccessPolicy(['gpt-4o'])])
		const engine = createCostEngine()
		const bulkhead = createBulkhead({ maxConcurrent: 10 })

		const elapsed = performance.now() - start

		// Verify all objects were created
		expect(audit.count).toBe(0)
		expect(cb.state).toBe('closed')
		expect(typeof dedup.deduplicate).toBe('function')
		expect(policies.policies).toContain('model-access')
		expect(typeof engine.middleware).toBe('function')
		expect(typeof bulkhead.execute).toBe('function')

		// README claims ~2ms cold start — allow generous 50ms for CI
		expect(elapsed).toBeLessThan(50)
		console.log(`  Cold start (all factories): ${elapsed.toFixed(2)}ms`)
	})

	it('middleware overhead: < 0.05ms per call through 3-middleware pipeline', async () => {
		registerProviderFactory('bench-mock', () =>
			mockProvider({ defaultResponse: { content: 'ok' } }),
		)

		const audit = createAuditTrail()
		const policies = createPolicySet([modelAccessPolicy(['bench-mock-model'])])
		const engine = createCostEngine()

		const gw = gateway({
			provider: 'bench-mock',
			apiKey: 'test',
			model: 'bench-mock-model',
			middleware: [policyMiddleware(policies), auditMiddleware(audit), engine.middleware()],
		})

		// Warm up
		for (let i = 0; i < 10; i++) {
			await gw.complete({ messages: [{ role: 'user', content: 'hi' }] })
		}

		const iterations = 1000
		const start = performance.now()

		for (let i = 0; i < iterations; i++) {
			await gw.complete({ messages: [{ role: 'user', content: 'hi' }] })
		}

		const total = performance.now() - start
		const perCall = total / iterations

		// README claims ~0.003ms overhead — allow 0.05ms for test environment
		expect(perCall).toBeLessThan(0.05)
		console.log(`  Middleware overhead: ${perCall.toFixed(4)}ms/call (${iterations} iterations)`)
	})

	it('throughput: > 50K audit log events per second', () => {
		const audit = createAuditTrail({ hashChain: true })

		const iterations = 50_000
		const start = performance.now()

		for (let i = 0; i < iterations; i++) {
			audit.log('llm_call', { model: 'test', i })
		}

		const elapsed = performance.now() - start
		const opsPerSec = Math.round((iterations / elapsed) * 1000)

		expect(opsPerSec).toBeGreaterThan(50_000)
		console.log(`  Audit trail throughput: ${opsPerSec.toLocaleString()} ops/sec (hash-chained)`)
	})

	it('throughput: > 100K policy evaluations per second', () => {
		const policies = createPolicySet([
			modelAccessPolicy(['gpt-4o', 'gpt-4o-mini', 'claude-sonnet-4-6']),
		])

		const iterations = 100_000
		const start = performance.now()

		for (let i = 0; i < iterations; i++) {
			policies.evaluate({ model: 'gpt-4o' })
		}

		const elapsed = performance.now() - start
		const opsPerSec = Math.round((iterations / elapsed) * 1000)

		expect(opsPerSec).toBeGreaterThan(100_000)
		console.log(`  Policy evaluation throughput: ${opsPerSec.toLocaleString()} ops/sec`)
	})

	it('circuit breaker: > 200K operations per second', async () => {
		const cb = createCircuitBreaker({
			failureThreshold: 1000,
			resetTimeoutMs: 60_000,
		})

		const iterations = 50_000
		const start = performance.now()

		for (let i = 0; i < iterations; i++) {
			await cb.execute(async () => 'ok')
		}

		const elapsed = performance.now() - start
		const opsPerSec = Math.round((iterations / elapsed) * 1000)

		expect(opsPerSec).toBeGreaterThan(200_000)
		console.log(`  Circuit breaker throughput: ${opsPerSec.toLocaleString()} ops/sec`)
	})
})
