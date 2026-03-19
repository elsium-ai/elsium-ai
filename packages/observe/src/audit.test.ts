import { describe, expect, it, vi } from 'vitest'
import type {
	AuditEvent,
	AuditIntegrityResult,
	AuditQueryFilter,
	AuditStorageAdapter,
} from './audit'
import { auditMiddleware, auditStreamMiddleware, createAuditTrail } from './audit'

describe('AuditTrail', () => {
	it('logs events and increments count', () => {
		const trail = createAuditTrail()
		expect(trail.count).toBe(0)

		trail.log('llm_call', { model: 'gpt-4o', tokens: 100 })
		expect(trail.count).toBe(1)

		trail.log('tool_execution', { tool: 'search' })
		expect(trail.count).toBe(2)
	})

	it('queries by type', async () => {
		const trail = createAuditTrail()
		trail.log('llm_call', { model: 'gpt-4o' })
		trail.log('tool_execution', { tool: 'search' })
		trail.log('llm_call', { model: 'claude' })

		const llmCalls = await trail.query({ type: 'llm_call' })
		expect(llmCalls).toHaveLength(2)

		const toolExecs = await trail.query({ type: 'tool_execution' })
		expect(toolExecs).toHaveLength(1)
	})

	it('queries by traceId', async () => {
		const trail = createAuditTrail()
		trail.log('llm_call', { model: 'gpt-4o' }, { traceId: 'trace-1' })
		trail.log('llm_call', { model: 'claude' }, { traceId: 'trace-2' })

		const results = await trail.query({ traceId: 'trace-1' })
		expect(results).toHaveLength(1)
		expect(results[0].data.model).toBe('gpt-4o')
	})

	it('queries by actor', async () => {
		const trail = createAuditTrail()
		trail.log('auth_event', { action: 'login' }, { actor: 'user-1' })
		trail.log('auth_event', { action: 'login' }, { actor: 'user-2' })

		const results = await trail.query({ actor: 'user-1' })
		expect(results).toHaveLength(1)
	})

	it('queries with limit and offset', async () => {
		const trail = createAuditTrail()
		for (let i = 0; i < 10; i++) {
			trail.log('llm_call', { index: i })
		}

		const page1 = await trail.query({ limit: 3 })
		expect(page1).toHaveLength(3)

		const page2 = await trail.query({ limit: 3, offset: 3 })
		expect(page2).toHaveLength(3)
		expect(page2[0].data.index).toBe(3)
	})

	it('queries by timestamp range', async () => {
		const trail = createAuditTrail()
		const before = Date.now()
		trail.log('llm_call', { model: 'gpt-4o' })
		const after = Date.now()

		const results = await trail.query({ fromTimestamp: before, toTimestamp: after })
		expect(results).toHaveLength(1)
	})

	it('maintains hash chain integrity', async () => {
		const trail = createAuditTrail()
		trail.log('llm_call', { model: 'gpt-4o' })
		trail.log('tool_execution', { tool: 'search' })
		trail.log('security_violation', { detail: 'injection detected' })

		const integrity = await trail.verifyIntegrity()
		expect(integrity.valid).toBe(true)
		expect(integrity.totalEvents).toBe(3)
	})

	it('events have sequential IDs', async () => {
		const trail = createAuditTrail()
		trail.log('llm_call', { a: 1 })
		trail.log('llm_call', { a: 2 })

		const events = await trail.query({})
		expect(events[0].sequenceId).toBe(1)
		expect(events[1].sequenceId).toBe(2)
	})

	it('events have hash and previousHash', async () => {
		const trail = createAuditTrail()
		trail.log('llm_call', { model: 'gpt-4o' })

		const events = await trail.query({})
		expect(events[0].hash).toBeTruthy()
		expect(events[0].previousHash).toBe('0'.repeat(64))
	})

	it('chain links events via previousHash', async () => {
		const trail = createAuditTrail()
		trail.log('llm_call', { a: 1 })
		trail.log('llm_call', { a: 2 })

		const events = await trail.query({})
		expect(events[1].previousHash).toBe(events[0].hash)
	})

	it('queries by multiple types', async () => {
		const trail = createAuditTrail()
		trail.log('llm_call', { a: 1 })
		trail.log('tool_execution', { b: 2 })
		trail.log('security_violation', { c: 3 })

		const results = await trail.query({ type: ['llm_call', 'tool_execution'] })
		expect(results).toHaveLength(2)
	})

	it('works with hashChain disabled', async () => {
		const trail = createAuditTrail({ hashChain: false })
		trail.log('llm_call', { a: 1 })
		trail.log('llm_call', { a: 2 })

		expect(trail.count).toBe(2)
	})

	it('count is correct after eviction', () => {
		const trail = createAuditTrail({ maxEvents: 5 })

		for (let i = 0; i < 8; i++) {
			trail.log('llm_call', { index: i })
		}

		expect(trail.count).toBe(5)
	})

	it('chainComplete is true without eviction, false after eviction', async () => {
		const noEviction = createAuditTrail({ maxEvents: 10 })
		for (let i = 0; i < 3; i++) {
			noEviction.log('llm_call', { index: i })
		}
		const integrityFull = await noEviction.verifyIntegrity()
		expect(integrityFull.valid).toBe(true)
		expect(integrityFull.chainComplete).toBe(true)

		const withEviction = createAuditTrail({ maxEvents: 3 })
		for (let i = 0; i < 6; i++) {
			withEviction.log('llm_call', { index: i })
		}
		const integrityEvicted = await withEviction.verifyIntegrity()
		expect(integrityEvicted.valid).toBe(true)
		expect(integrityEvicted.chainComplete).toBe(false)
	})

	it('getLastHash is used on init to resume chain', async () => {
		const preExistingHash = 'a'.repeat(64)
		const events: AuditEvent[] = []

		const adapter: AuditStorageAdapter = {
			append(event: AuditEvent) {
				events.push(event)
			},
			query(_filter: AuditQueryFilter) {
				return events
			},
			count() {
				return events.length
			},
			verifyIntegrity(): AuditIntegrityResult {
				return { valid: true, totalEvents: events.length }
			},
			getLastHash() {
				return preExistingHash
			},
		}

		const trail = createAuditTrail({ storage: adapter, hashChain: true })
		trail.log('llm_call', { model: 'test' })

		expect(events).toHaveLength(1)
		expect(events[0].previousHash).toBe(preExistingHash)
	})

	it('getLastHash works with async storage adapter', async () => {
		const preExistingHash = 'b'.repeat(64)
		const events: AuditEvent[] = []

		const adapter: AuditStorageAdapter = {
			append(event: AuditEvent) {
				events.push(event)
			},
			query(_filter: AuditQueryFilter) {
				return events
			},
			count() {
				return events.length
			},
			verifyIntegrity(): AuditIntegrityResult {
				return { valid: true, totalEvents: events.length }
			},
			getLastHash() {
				return Promise.resolve(preExistingHash)
			},
		}

		const trail = createAuditTrail({ storage: adapter, hashChain: true })

		// Log before awaiting ready() — the entry must still use the correct hash
		trail.log('llm_call', { model: 'test' })

		// Await initialization; this also drains all queued log() calls
		await trail.ready()

		expect(events).toHaveLength(1)
		expect(events[0].previousHash).toBe(preExistingHash)
	})
})

describe('AuditTrail batched mode', () => {
	it('buffers events and flushes on demand', async () => {
		const trail = createAuditTrail({ batch: { size: 100, intervalMs: 60_000 } })

		trail.log('llm_call', { model: 'gpt-4o' })
		trail.log('tool_execution', { tool: 'search' })

		expect(trail.pending).toBe(2)

		const beforeFlush = await trail.query({})
		expect(beforeFlush).toHaveLength(2)
		expect(trail.pending).toBe(0)

		trail.dispose()
	})

	it('auto-flushes when batch size is reached', () => {
		const trail = createAuditTrail({ batch: { size: 3, intervalMs: 60_000 } })

		trail.log('llm_call', { i: 0 })
		trail.log('llm_call', { i: 1 })
		expect(trail.pending).toBe(2)

		trail.log('llm_call', { i: 2 })
		expect(trail.pending).toBe(0)

		trail.dispose()
	})

	it('maintains hash chain integrity in batched mode', async () => {
		const trail = createAuditTrail({ batch: { size: 10 } })

		for (let i = 0; i < 5; i++) {
			trail.log('llm_call', { index: i })
		}

		await trail.flush()
		const integrity = await trail.verifyIntegrity()
		expect(integrity.valid).toBe(true)
		expect(integrity.totalEvents).toBe(5)
		expect(integrity.chainComplete).toBe(true)

		trail.dispose()
	})

	it('chain links events correctly in batched mode', async () => {
		const trail = createAuditTrail({ batch: { size: 10 } })

		trail.log('llm_call', { a: 1 })
		trail.log('llm_call', { a: 2 })

		await trail.flush()
		const events = await trail.query({})
		expect(events[1].previousHash).toBe(events[0].hash)

		trail.dispose()
	})

	it('count includes pending events', () => {
		const trail = createAuditTrail({ batch: { size: 100 } })

		trail.log('llm_call', { a: 1 })
		trail.log('llm_call', { a: 2 })

		expect(trail.count).toBe(2)
		expect(trail.pending).toBe(2)

		trail.dispose()
	})

	it('dispose drains buffer and stops timer', async () => {
		const trail = createAuditTrail({ batch: { size: 100, intervalMs: 10 } })

		trail.log('llm_call', { a: 1 })
		trail.dispose()

		expect(trail.pending).toBe(0)
		const events = await trail.query({})
		expect(events).toHaveLength(1)
	})

	it('flush waits for async storage writes to complete', async () => {
		let appendResolved = false
		const asyncStorage = {
			append: vi.fn().mockImplementation(
				() =>
					new Promise<void>((resolve) => {
						setTimeout(() => {
							appendResolved = true
							resolve()
						}, 50)
					}),
			),
			query: vi.fn().mockReturnValue([]),
			count: vi.fn().mockReturnValue(0),
			verifyIntegrity: vi.fn().mockReturnValue({ valid: true, totalEvents: 0 }),
		}

		const trail = createAuditTrail({ storage: asyncStorage, hashChain: false })

		trail.log('llm_call', { model: 'test' })

		expect(appendResolved).toBe(false)

		await trail.flush()

		expect(appendResolved).toBe(true)
		expect(asyncStorage.append).toHaveBeenCalledOnce()

		trail.dispose()
	})

	it('flush and dispose are safe to call on non-batched trails', async () => {
		const trail = createAuditTrail()
		trail.log('llm_call', { a: 1 })

		await trail.flush()
		trail.dispose()

		expect(trail.count).toBe(1)
		expect(trail.pending).toBe(0)
	})
})

describe('AuditTrail ring buffer eviction', () => {
	it('eviction is O(1) — count stays at max', () => {
		const trail = createAuditTrail({ maxEvents: 5 })

		for (let i = 0; i < 100; i++) {
			trail.log('llm_call', { index: i })
		}

		expect(trail.count).toBe(5)
	})

	it('preserves most recent events after eviction', async () => {
		const trail = createAuditTrail({ maxEvents: 3 })

		for (let i = 0; i < 6; i++) {
			trail.log('llm_call', { index: i })
		}

		const events = await trail.query({})
		expect(events).toHaveLength(3)
		expect(events[0].data.index).toBe(3)
		expect(events[1].data.index).toBe(4)
		expect(events[2].data.index).toBe(5)
	})
})

describe('AuditTrail context enrichment', () => {
	it('merges global context into every event', async () => {
		const trail = createAuditTrail({
			context: { env: 'production', service: 'my-app', version: '1.2.0' },
		})

		trail.log('llm_call', { model: 'gpt-4o', tokens: 100 })
		trail.log('tool_execution', { tool: 'search' })

		const events = await trail.query({})
		expect(events).toHaveLength(2)

		expect(events[0].data).toMatchObject({
			env: 'production',
			service: 'my-app',
			version: '1.2.0',
			model: 'gpt-4o',
			tokens: 100,
		})

		expect(events[1].data).toMatchObject({
			env: 'production',
			service: 'my-app',
			version: '1.2.0',
			tool: 'search',
		})
	})

	it('event-specific data overrides global context', async () => {
		const trail = createAuditTrail({
			context: { env: 'staging', source: 'default' },
		})

		trail.log('llm_call', { env: 'production', model: 'gpt-4o' })

		const events = await trail.query({})
		expect(events[0].data.env).toBe('production')
		expect(events[0].data.source).toBe('default')
	})

	it('works without context (no enrichment)', async () => {
		const trail = createAuditTrail()
		trail.log('llm_call', { model: 'gpt-4o' })

		const events = await trail.query({})
		expect(events[0].data).toEqual({ model: 'gpt-4o' })
	})
})

describe('AuditTrail async dispose', () => {
	it('dispose awaits sink manager shutdown', async () => {
		let shutdownCalled = false
		const sink = {
			name: 'test-sink',
			send: vi.fn<[unknown[]], Promise<void>>().mockResolvedValue(undefined),
			shutdown: vi.fn<[], Promise<void>>().mockImplementation(async () => {
				await new Promise((r) => setTimeout(r, 10))
				shutdownCalled = true
			}),
		}

		const trail = createAuditTrail({ sinks: [sink] })
		trail.log('llm_call', { model: 'test' })

		await trail.dispose()

		expect(shutdownCalled).toBe(true)
		expect(sink.shutdown).toHaveBeenCalledOnce()
	})

	it('dispose awaits pending async storage writes', async () => {
		let writeComplete = false
		const asyncStorage = {
			append: vi.fn().mockImplementation(
				() =>
					new Promise<void>((resolve) => {
						setTimeout(() => {
							writeComplete = true
							resolve()
						}, 20)
					}),
			),
			query: vi.fn().mockReturnValue([]),
			count: vi.fn().mockReturnValue(0),
			verifyIntegrity: vi.fn().mockReturnValue({ valid: true, totalEvents: 0 }),
		}

		const trail = createAuditTrail({ storage: asyncStorage, hashChain: false })
		trail.log('llm_call', { model: 'test' })

		await trail.dispose()

		expect(writeComplete).toBe(true)
	})
})

describe('auditMiddleware', () => {
	it('creates valid middleware', () => {
		const trail = createAuditTrail()
		const mw = auditMiddleware(trail)
		expect(typeof mw).toBe('function')
	})
})

describe('auditStreamMiddleware', () => {
	function makeCtx(overrides: Partial<Record<string, unknown>> = {}) {
		return {
			request: { messages: [{ role: 'user', content: 'Hi' }] },
			provider: 'anthropic',
			model: 'claude-sonnet-4-6',
			traceId: 'trc_123',
			startTime: performance.now(),
			metadata: {},
			...overrides,
		} as Parameters<ReturnType<typeof auditStreamMiddleware>>[0]
	}

	it('logs llm_call with usage from message_end event', async () => {
		const trail = createAuditTrail()
		const mw = auditStreamMiddleware(trail)

		async function* source() {
			yield { type: 'text_delta' as const, text: 'hello' }
			yield {
				type: 'message_end' as const,
				usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
				stopReason: 'end_turn' as const,
			}
		}

		const stream = mw(makeCtx(), source(), (_c, s) => s)
		const events = []
		for await (const event of stream) {
			events.push(event)
		}

		expect(events).toHaveLength(2)

		const logged = await trail.query({ type: 'llm_call' })
		expect(logged).toHaveLength(1)
		expect(logged[0].data).toMatchObject({
			provider: 'anthropic',
			model: 'claude-sonnet-4-6',
			inputTokens: 100,
			outputTokens: 50,
			totalTokens: 150,
			stopReason: 'end_turn',
			streaming: true,
		})
		expect(logged[0].traceId).toBe('trc_123')
	})

	it('logs error when stream fails without usage', async () => {
		const trail = createAuditTrail()
		const mw = auditStreamMiddleware(trail)

		async function* source() {
			yield { type: 'error' as const, error: new Error('provider timeout') }
		}

		const stream = mw(makeCtx(), source(), (_c, s) => s)
		for await (const _event of stream) {
			/* drain */
		}

		const logged = await trail.query({ type: 'llm_call' })
		expect(logged).toHaveLength(1)
		expect(logged[0].data).toMatchObject({
			error: 'provider timeout',
			success: false,
			streaming: true,
		})
	})

	it('does not log when stream has no message_end or error', async () => {
		const trail = createAuditTrail()
		const mw = auditStreamMiddleware(trail)

		async function* source() {
			yield { type: 'text_delta' as const, text: 'partial' }
		}

		const stream = mw(makeCtx(), source(), (_c, s) => s)
		for await (const _event of stream) {
			/* drain */
		}

		const logged = await trail.query({ type: 'llm_call' })
		expect(logged).toHaveLength(0)
	})

	it('passes all events through unchanged', async () => {
		const trail = createAuditTrail()
		const mw = auditStreamMiddleware(trail)

		async function* source() {
			yield { type: 'message_start' as const, id: 'msg_1', model: 'claude-sonnet-4-6' }
			yield { type: 'text_delta' as const, text: 'hello' }
			yield { type: 'text_delta' as const, text: ' world' }
			yield {
				type: 'message_end' as const,
				usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
				stopReason: 'end_turn' as const,
			}
		}

		const stream = mw(makeCtx(), source(), (_c, s) => s)
		const events = []
		for await (const event of stream) {
			events.push(event)
		}

		expect(events).toHaveLength(4)
		expect(events[0]).toMatchObject({ type: 'message_start' })
		expect(events[1]).toMatchObject({ type: 'text_delta', text: 'hello' })
		expect(events[2]).toMatchObject({ type: 'text_delta', text: ' world' })
		expect(events[3]).toMatchObject({ type: 'message_end' })
	})

	it('records latency', async () => {
		const trail = createAuditTrail()
		const mw = auditStreamMiddleware(trail)

		async function* source() {
			await new Promise((r) => setTimeout(r, 20))
			yield {
				type: 'message_end' as const,
				usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
				stopReason: 'end_turn' as const,
			}
		}

		const stream = mw(makeCtx(), source(), (_c, s) => s)
		for await (const _event of stream) {
			/* drain */
		}

		const logged = await trail.query({ type: 'llm_call' })
		expect(logged[0].data.latencyMs).toBeGreaterThanOrEqual(15)
	})
})
