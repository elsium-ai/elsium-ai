import type { MiddlewareContext } from '@elsium-ai/core'
import { ElsiumError } from '@elsium-ai/core'
import { describe, expect, it, vi } from 'vitest'
import { createFairQueue } from './fair-queue'

function ctx(agentName: string): MiddlewareContext {
	return {
		request: { messages: [{ role: 'user', content: 'hi' }] },
		provider: 'p',
		model: 'm',
		traceId: 't',
		startTime: performance.now(),
		metadata: { agentName },
	}
}

describe('createFairQueue — config validation', () => {
	it('throws on non-positive capacity', () => {
		expect(() => createFairQueue({ perAgent: { capacity: 0, refillRatePerSec: 1 } })).toThrow(
			/capacity/,
		)
	})

	it('throws on non-positive refill rate', () => {
		expect(() => createFairQueue({ perAgent: { capacity: 5, refillRatePerSec: 0 } })).toThrow(
			/refillRatePerSec/,
		)
	})

	it('validates per-agent overrides too', () => {
		expect(() =>
			createFairQueue({
				perAgent: { capacity: 5, refillRatePerSec: 1 },
				overrides: { naughty: { capacity: -1, refillRatePerSec: 1 } },
			}),
		).toThrow(/overrides.naughty/)
	})
})

describe('createFairQueue — basic consumption', () => {
	it('first request passes through immediately', async () => {
		const q = createFairQueue({ perAgent: { capacity: 2, refillRatePerSec: 1 } })
		const next = vi.fn(async () => 'ok' as never)
		const mw = q.middleware()
		const r = await mw(ctx('agent-a'), next)
		expect(r).toBe('ok')
		expect(next).toHaveBeenCalled()
	})

	it('each agent has an independent bucket', async () => {
		const q = createFairQueue({ perAgent: { capacity: 1, refillRatePerSec: 0.01 } })
		const mw = q.middleware()

		// Agent A consumes its single token
		await mw(ctx('a'), async () => 'ok' as never)
		// Agent B still has a full bucket and should pass immediately
		const start = Date.now()
		await mw(ctx('b'), async () => 'ok' as never)
		expect(Date.now() - start).toBeLessThan(100)
	})
})

describe('createFairQueue — blocking and timeout', () => {
	it('onTimeout=throw rejects when no tokens arrive within waitTimeoutMs', async () => {
		const q = createFairQueue({
			perAgent: { capacity: 1, refillRatePerSec: 0.01 }, // ~100s per token
			waitTimeoutMs: 30,
			onTimeout: 'throw',
		})
		const mw = q.middleware()
		// Drain the token
		await mw(ctx('a'), async () => 'ok' as never)
		// Next call must wait, then throw
		await expect(mw(ctx('a'), async () => 'ok' as never)).rejects.toBeInstanceOf(ElsiumError)
	})

	it('onTimeout=proceed lets the call through after exhaustion', async () => {
		const q = createFairQueue({
			perAgent: { capacity: 1, refillRatePerSec: 0.01 },
			waitTimeoutMs: 30,
			onTimeout: 'proceed',
		})
		const mw = q.middleware()
		await mw(ctx('a'), async () => 'ok' as never)
		const r = await mw(ctx('a'), async () => 'second' as never)
		expect(r).toBe('second')
	})

	it('waits and acquires a token when refill happens within timeout', async () => {
		const q = createFairQueue({
			perAgent: { capacity: 1, refillRatePerSec: 50 }, // 20ms per token
			waitTimeoutMs: 200,
		})
		const mw = q.middleware()
		await mw(ctx('a'), async () => 'first' as never)
		const r = await mw(ctx('a'), async () => 'second' as never)
		expect(r).toBe('second')
	})
})

describe('createFairQueue — per-agent overrides', () => {
	it('overrides apply only to the named agent', async () => {
		const q = createFairQueue({
			perAgent: { capacity: 1, refillRatePerSec: 1 },
			overrides: { 'heavy-agent': { capacity: 10, refillRatePerSec: 10 } },
		})
		const mw = q.middleware()

		// Heavy agent can make several requests rapidly
		for (let i = 0; i < 5; i++) {
			await mw(ctx('heavy-agent'), async () => 'ok' as never)
		}
		const state = q.getBucketState('heavy-agent')
		expect(state?.capacity).toBe(10)
		expect(state?.tokens).toBeLessThanOrEqual(10)

		const lightState = q.getBucketState('other')
		expect(lightState).toBeNull() // hasn't been touched
	})
})

describe('createFairQueue — identifyAgent customization', () => {
	it('custom identifier wins over the default metadata.agentName lookup', async () => {
		const q = createFairQueue({
			perAgent: { capacity: 1, refillRatePerSec: 1 },
			identifyAgent: (c) => `tenant:${c.tenant?.tenantId ?? 'anon'}`,
		})
		const mw = q.middleware()
		await mw(
			{
				request: { messages: [{ role: 'user', content: 'hi' }] },
				provider: 'p',
				model: 'm',
				traceId: 't',
				startTime: performance.now(),
				metadata: {},
				tenant: { tenantId: 'acme' },
			},
			async () => 'ok' as never,
		)
		expect(q.getBucketState('tenant:acme')).not.toBeNull()
	})

	it('falls back to _default when identifier returns undefined', async () => {
		const q = createFairQueue({ perAgent: { capacity: 1, refillRatePerSec: 1 } })
		const mw = q.middleware()
		await mw(
			{
				request: { messages: [{ role: 'user', content: 'hi' }] },
				provider: 'p',
				model: 'm',
				traceId: 't',
				startTime: performance.now(),
				metadata: {}, // no agentName
			},
			async () => 'ok' as never,
		)
		expect(q.getBucketState('_default')).not.toBeNull()
	})
})

describe('createFairQueue — observability', () => {
	it('listBuckets enumerates all touched agents', async () => {
		const q = createFairQueue({ perAgent: { capacity: 5, refillRatePerSec: 1 } })
		const mw = q.middleware()
		await mw(ctx('a'), async () => 'ok' as never)
		await mw(ctx('b'), async () => 'ok' as never)
		const list = q.listBuckets()
		expect(list.map((b) => b.agent).sort()).toEqual(['a', 'b'])
	})

	it('getBucketState returns null for untouched agents', () => {
		const q = createFairQueue({ perAgent: { capacity: 5, refillRatePerSec: 1 } })
		expect(q.getBucketState('never-used')).toBeNull()
	})
})
