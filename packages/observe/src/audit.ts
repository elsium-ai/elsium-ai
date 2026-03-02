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

export interface AuditTrailConfig {
	storage?: AuditStorageAdapter | 'memory'
	hashChain?: boolean
	maxEvents?: number
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
	readonly count: number
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

class InMemoryAuditStorage implements AuditStorageAdapter {
	private events: AuditEvent[] = []
	private readonly maxEvents: number

	constructor(maxEvents?: number) {
		this.maxEvents = maxEvents ?? 10_000
	}

	append(event: AuditEvent): void {
		this.events.push(event)
		if (this.events.length > this.maxEvents) {
			this.events = this.events.slice(-this.maxEvents)
		}
	}

	query(filter: AuditQueryFilter): AuditEvent[] {
		let results = [...this.events]

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
		return this.events.length
	}

	verifyIntegrity(): AuditIntegrityResult {
		if (this.events.length === 0) {
			return { valid: true, totalEvents: 0, chainComplete: true }
		}

		for (let i = 0; i < this.events.length; i++) {
			const event = this.events[i]
			const expectedHash = computeEventHash(event, event.previousHash)
			if (event.hash !== expectedHash) {
				return { valid: false, totalEvents: this.events.length, brokenAt: i }
			}

			if (i > 0 && event.previousHash !== this.events[i - 1].hash) {
				return { valid: false, totalEvents: this.events.length, brokenAt: i }
			}
		}

		const chainComplete = this.events[0].previousHash === '0'.repeat(64)
		return { valid: true, totalEvents: this.events.length, chainComplete }
	}

	getLastHash(): string {
		if (this.events.length === 0) return '0'.repeat(64)
		return this.events[this.events.length - 1].hash
	}
}

export function createAuditTrail(config?: AuditTrailConfig): AuditTrail {
	const useHashChain = config?.hashChain !== false
	const storage: AuditStorageAdapter =
		config?.storage && typeof config.storage !== 'string'
			? config.storage
			: new InMemoryAuditStorage(config?.maxEvents)

	let sequenceId = 0
	let idCounter = 0
	let previousHash = '0'.repeat(64)

	// readyPromise ensures that any log() calls arriving before an async
	// getLastHash resolves are queued and processed only after the initial
	// previousHash is known, preserving hash-chain integrity.
	// When the adapter is synchronous, isReady stays true so that log() can
	// append entries immediately without deferring to a microtask.
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

	function appendEntry(
		type: AuditEventType,
		data: Record<string, unknown>,
		options?: { actor?: string; traceId?: string },
	): void {
		sequenceId++
		idCounter++

		const event: Omit<AuditEvent, 'hash'> & { hash?: string; previousHash: string } = {
			id: `audit_${idCounter.toString(36)}_${Date.now().toString(36)}`,
			sequenceId,
			type,
			timestamp: Date.now(),
			actor: options?.actor,
			traceId: options?.traceId,
			data,
			previousHash: useHashChain ? previousHash : '0'.repeat(64),
		}

		const hash = useHashChain
			? computeEventHash(event as Omit<AuditEvent, 'hash'>, event.previousHash)
			: createHash('sha256').update(JSON.stringify(event)).digest('hex')

		const finalEvent: AuditEvent = { ...(event as Omit<AuditEvent, 'hash'>), hash }

		if (useHashChain) {
			previousHash = hash
		}

		const result = storage.append(finalEvent)
		if (result && typeof (result as Promise<void>).catch === 'function') {
			;(result as Promise<void>).catch((err) => config?.onError?.(err))
		}
	}

	return {
		log(
			type: AuditEventType,
			data: Record<string, unknown>,
			options?: { actor?: string; traceId?: string },
		): void {
			if (isReady) {
				// Synchronous path: adapter was synchronous (or had no getLastHash),
				// so the initial hash is already set — append immediately.
				appendEntry(type, data, options)
			} else {
				// Async path: chain onto readyPromise so entries are serialised and
				// processed in arrival order once the initial hash resolves.
				readyPromise = readyPromise.then(() => appendEntry(type, data, options))
			}
		},

		ready(): Promise<void> {
			return readyPromise
		},

		async query(filter: AuditQueryFilter): Promise<AuditEvent[]> {
			return storage.query(filter)
		},

		async verifyIntegrity(): Promise<AuditIntegrityResult> {
			return storage.verifyIntegrity()
		},

		get count(): number {
			const result = storage.count()
			return typeof result === 'number' ? result : 0
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
