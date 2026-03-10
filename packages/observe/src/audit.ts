import { createHash } from 'node:crypto'
import type { Middleware, MiddlewareContext, MiddlewareNext } from '@elsium-ai/core'

export type AuditEventType =
	| 'llm_call'
	| 'tool_execution'
	| 'security_violation'
	| 'budget_alert'
	| 'policy_violation'
	| 'auth_event'
	| 'approval_request'
	| 'approval_decision'
	| 'config_change'
	| 'provider_failover'
	| 'circuit_breaker_state_change'

export interface AuditEvent {
	id: string
	sequenceId: number
	type: AuditEventType
	timestamp: number
	actor?: string
	traceId?: string
	data: Record<string, unknown>
	hash: string
	previousHash: string
}

export interface AuditStorageAdapter {
	append(event: AuditEvent): void | Promise<void>
	query(filter: AuditQueryFilter): AuditEvent[] | Promise<AuditEvent[]>
	count(): number | Promise<number>
	verifyIntegrity(): AuditIntegrityResult | Promise<AuditIntegrityResult>
	getLastHash?(): string | Promise<string>
}

export interface AuditQueryFilter {
	type?: AuditEventType | AuditEventType[]
	actor?: string
	traceId?: string
	fromTimestamp?: number
	toTimestamp?: number
	limit?: number
	offset?: number
}

export interface AuditIntegrityResult {
	valid: boolean
	totalEvents: number
	brokenAt?: number
	chainComplete?: boolean
}

export interface AuditBatchConfig {
	size?: number
	intervalMs?: number
}

export interface AuditTrailConfig {
	storage?: AuditStorageAdapter | 'memory'
	hashChain?: boolean
	maxEvents?: number
	batch?: AuditBatchConfig
	onError?: (error: unknown) => void
}

export interface AuditTrail {
	log(
		type: AuditEventType,
		data: Record<string, unknown>,
		options?: { actor?: string; traceId?: string },
	): void
	/** Resolves once async initialization (e.g. getLastHash) has completed. */
	ready(): Promise<void>
	query(filter: AuditQueryFilter): Promise<AuditEvent[]>
	verifyIntegrity(): Promise<AuditIntegrityResult>
	flush(): Promise<void>
	dispose(): void
	readonly count: number
	readonly pending: number
}

function computeEventHash(event: Omit<AuditEvent, 'hash'>, previousHash: string): string {
	const content = JSON.stringify({
		id: event.id,
		sequenceId: event.sequenceId,
		type: event.type,
		timestamp: event.timestamp,
		actor: event.actor,
		traceId: event.traceId,
		data: event.data,
		previousHash,
	})
	return createHash('sha256').update(content).digest('hex')
}

const ZERO_HASH = '0'.repeat(64)

class RingBuffer<T> {
	private buffer: (T | undefined)[]
	private head = 0
	private size = 0
	private readonly capacity: number

	constructor(capacity: number) {
		this.capacity = capacity
		this.buffer = new Array(capacity)
	}

	push(item: T): void {
		const index = (this.head + this.size) % this.capacity
		if (this.size === this.capacity) {
			this.head = (this.head + 1) % this.capacity
		} else {
			this.size++
		}
		this.buffer[index] = item
	}

	toArray(): T[] {
		const result: T[] = new Array(this.size)
		for (let i = 0; i < this.size; i++) {
			result[i] = this.buffer[(this.head + i) % this.capacity] as T
		}
		return result
	}

	get length(): number {
		return this.size
	}

	last(): T | undefined {
		if (this.size === 0) return undefined
		return this.buffer[(this.head + this.size - 1) % this.capacity]
	}
}

class InMemoryAuditStorage implements AuditStorageAdapter {
	private ring: RingBuffer<AuditEvent>

	constructor(maxEvents?: number) {
		this.ring = new RingBuffer(maxEvents ?? 10_000)
	}

	append(event: AuditEvent): void {
		this.ring.push(event)
	}

	query(filter: AuditQueryFilter): AuditEvent[] {
		let results = this.ring.toArray()

		if (filter.type) {
			const types = Array.isArray(filter.type) ? filter.type : [filter.type]
			results = results.filter((e) => types.includes(e.type))
		}
		if (filter.actor) {
			results = results.filter((e) => e.actor === filter.actor)
		}
		if (filter.traceId) {
			results = results.filter((e) => e.traceId === filter.traceId)
		}
		if (filter.fromTimestamp !== undefined) {
			const from = filter.fromTimestamp
			results = results.filter((e) => e.timestamp >= from)
		}
		if (filter.toTimestamp !== undefined) {
			const to = filter.toTimestamp
			results = results.filter((e) => e.timestamp <= to)
		}

		const offset = filter.offset ?? 0
		const limit = filter.limit ?? results.length
		return results.slice(offset, offset + limit)
	}

	count(): number {
		return this.ring.length
	}

	verifyIntegrity(): AuditIntegrityResult {
		const events = this.ring.toArray()
		if (events.length === 0) {
			return { valid: true, totalEvents: 0, chainComplete: true }
		}

		for (let i = 0; i < events.length; i++) {
			const event = events[i]
			const expectedHash = computeEventHash(event, event.previousHash)
			if (event.hash !== expectedHash) {
				return { valid: false, totalEvents: events.length, brokenAt: i }
			}

			if (i > 0 && event.previousHash !== events[i - 1].hash) {
				return { valid: false, totalEvents: events.length, brokenAt: i }
			}
		}

		const chainComplete = events[0].previousHash === ZERO_HASH
		return { valid: true, totalEvents: events.length, chainComplete }
	}

	getLastHash(): string {
		const last = this.ring.last()
		return last ? last.hash : ZERO_HASH
	}
}

interface PendingEntry {
	type: AuditEventType
	data: Record<string, unknown>
	timestamp: number
	actor?: string
	traceId?: string
}

export function createAuditTrail(config?: AuditTrailConfig): AuditTrail {
	const useHashChain = config?.hashChain !== false
	const storage: AuditStorageAdapter =
		config?.storage && typeof config.storage !== 'string'
			? config.storage
			: new InMemoryAuditStorage(config?.maxEvents)

	let sequenceId = 0
	let idCounter = 0
	let previousHash = ZERO_HASH

	let isReady = true
	let readyPromise: Promise<void> = Promise.resolve()

	if (useHashChain && storage.getLastHash) {
		const lastHash = storage.getLastHash()
		if (typeof lastHash === 'string') {
			previousHash = lastHash
		} else {
			isReady = false
			readyPromise = (lastHash as Promise<string>).then((hash) => {
				if (typeof hash === 'string') previousHash = hash
				isReady = true
			})
		}
	}

	const batchConfig = config?.batch
	const batchSize = batchConfig?.size ?? 100
	const batchIntervalMs = batchConfig?.intervalMs ?? 50
	const isBatched = !!batchConfig
	const pendingBuffer: PendingEntry[] = []
	let flushTimer: ReturnType<typeof setInterval> | null = null
	let flushPromise: Promise<void> = Promise.resolve()

	function buildAndAppend(entry: PendingEntry): void {
		sequenceId++
		idCounter++

		const event: Omit<AuditEvent, 'hash'> & { hash?: string; previousHash: string } = {
			id: `audit_${idCounter.toString(36)}_${entry.timestamp.toString(36)}`,
			sequenceId,
			type: entry.type,
			timestamp: entry.timestamp,
			actor: entry.actor,
			traceId: entry.traceId,
			data: entry.data,
			previousHash: useHashChain ? previousHash : ZERO_HASH,
		}

		const hash = useHashChain
			? computeEventHash(event as Omit<AuditEvent, 'hash'>, event.previousHash)
			: createHash('sha256').update(JSON.stringify(event)).digest('hex')

		const finalEvent: AuditEvent = { ...(event as Omit<AuditEvent, 'hash'>), hash }

		if (useHashChain) {
			previousHash = hash
		}

		const result = storage.append(finalEvent)
		if (result && typeof (result as Promise<void>).then === 'function') {
			flushPromise = flushPromise
				.then(() => result as Promise<void>)
				.catch((err) => config?.onError?.(err))
		}
	}

	function drainBuffer(): void {
		let entry = pendingBuffer.shift()
		while (entry) {
			buildAndAppend(entry)
			entry = pendingBuffer.shift()
		}
	}

	if (isBatched) {
		flushTimer = setInterval(() => {
			if (pendingBuffer.length > 0) drainBuffer()
		}, batchIntervalMs)
		if (typeof flushTimer === 'object' && 'unref' in flushTimer) {
			flushTimer.unref()
		}
	}

	function logEntry(
		type: AuditEventType,
		data: Record<string, unknown>,
		options?: { actor?: string; traceId?: string },
	): void {
		const entry: PendingEntry = {
			type,
			data,
			timestamp: Date.now(),
			actor: options?.actor,
			traceId: options?.traceId,
		}

		if (isBatched) {
			pendingBuffer.push(entry)
			if (pendingBuffer.length >= batchSize) drainBuffer()
			return
		}

		buildAndAppend(entry)
	}

	return {
		log(
			type: AuditEventType,
			data: Record<string, unknown>,
			options?: { actor?: string; traceId?: string },
		): void {
			if (isReady) {
				logEntry(type, data, options)
			} else {
				readyPromise = readyPromise.then(() => logEntry(type, data, options))
			}
		},

		ready(): Promise<void> {
			return readyPromise
		},

		async flush(): Promise<void> {
			await readyPromise
			drainBuffer()
			await flushPromise
		},

		dispose(): void {
			if (flushTimer) {
				clearInterval(flushTimer)
				flushTimer = null
			}
			drainBuffer()
		},

		async query(filter: AuditQueryFilter): Promise<AuditEvent[]> {
			if (isBatched) drainBuffer()
			return storage.query(filter)
		},

		async verifyIntegrity(): Promise<AuditIntegrityResult> {
			if (isBatched) drainBuffer()
			return storage.verifyIntegrity()
		},

		get count(): number {
			const result = storage.count()
			return (typeof result === 'number' ? result : 0) + pendingBuffer.length
		},

		get pending(): number {
			return pendingBuffer.length
		},
	}
}

export function auditMiddleware(auditTrail: AuditTrail): Middleware {
	return async (ctx: MiddlewareContext, next: MiddlewareNext) => {
		const startTime = performance.now()

		try {
			const response = await next(ctx)
			const latencyMs = Math.round(performance.now() - startTime)

			auditTrail.log(
				'llm_call',
				{
					provider: ctx.provider,
					model: ctx.model,
					inputTokens: response.usage.inputTokens,
					outputTokens: response.usage.outputTokens,
					totalTokens: response.usage.totalTokens,
					cost: response.cost.totalCost,
					latencyMs,
					stopReason: response.stopReason,
				},
				{ traceId: ctx.traceId },
			)

			return response
		} catch (error) {
			const latencyMs = Math.round(performance.now() - startTime)

			auditTrail.log(
				'llm_call',
				{
					provider: ctx.provider,
					model: ctx.model,
					error: error instanceof Error ? error.message : String(error),
					latencyMs,
					success: false,
				},
				{ traceId: ctx.traceId },
			)

			throw error
		}
	}
}
