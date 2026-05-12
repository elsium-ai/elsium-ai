/**
 * CostStore port + in-memory reference adapter (O2b).
 *
 * Decoupled from the legacy createCostEngine façade. CostStore is the
 * async-first contract for cost attribution across processes / instances.
 *
 * Persistence is the user's responsibility — this package ships ONLY the
 * in-memory adapter (LocalCostStore). To run multi-instance with shared
 * budget, implement CostStore against your backend of choice (SQLite,
 * Postgres, Redis, DynamoDB, …). See docs/guides/persistent-stores.md.
 *
 * Reservation/commit/release lets callers pre-reserve a budget before
 * the LLM call commits, so concurrent requests racing against the same
 * tenant cap don't double-spend. The in-memory adapter handles this
 * trivially within one process; a Postgres adapter would use SELECT
 * FOR UPDATE or a Redis Lua script.
 */

import { ElsiumError, generateId } from '@elsium-ai/core'

// ─── Attribution dimensions ─────────────────────────────────────

export type CostDimensionKey =
	| 'model'
	| 'agent'
	| 'user'
	| 'feature'
	| 'tenant'
	| 'workflow'
	| 'workflowStep'
	| 'traceId'

export interface CostAttribution {
	readonly model: string
	readonly tenant?: string
	readonly agent?: string
	readonly user?: string
	readonly feature?: string
	readonly workflow?: string
	readonly workflowStep?: string
	readonly traceId?: string
}

export interface CostRecord {
	readonly attribution: CostAttribution
	readonly cost: number
	readonly inputTokens: number
	readonly outputTokens: number
	readonly timestamp: number
}

export interface CostBucket {
	readonly key: string
	readonly cost: number
	readonly tokens: number
	readonly calls: number
	readonly firstAt: number
	readonly lastAt: number
}

export interface TimeWindow {
	readonly fromMs: number
	readonly toMs: number
}

export interface ReservationToken {
	readonly id: string
	readonly attribution: CostAttribution
	readonly reservedAmount: number
	readonly expiresAt: number
}

// ─── Port ───────────────────────────────────────────────────────

export interface CostStore {
	record(rec: CostRecord): Promise<void>
	aggregate(
		by: CostDimensionKey,
		filter?: Partial<CostAttribution>,
		window?: TimeWindow,
	): Promise<readonly CostBucket[]>
	reserve(attribution: CostAttribution, estimatedCost: number): Promise<ReservationToken>
	commit(token: ReservationToken, actualCost: number): Promise<void>
	release(token: ReservationToken): Promise<void>
}

// ─── In-memory reference adapter ────────────────────────────────

export interface LocalCostStoreOptions {
	/** TTL for reservations that are never committed or released. Default 60s. */
	readonly reservationTtlMs?: number
	/**
	 * Optional clock injection for deterministic tests. Defaults to Date.now.
	 */
	readonly now?: () => number
}

function dimensionValue(attr: CostAttribution, dim: CostDimensionKey): string | undefined {
	switch (dim) {
		case 'model':
			return attr.model
		case 'agent':
			return attr.agent
		case 'user':
			return attr.user
		case 'feature':
			return attr.feature
		case 'tenant':
			return attr.tenant
		case 'workflow':
			return attr.workflow
		case 'workflowStep':
			return attr.workflowStep
		case 'traceId':
			return attr.traceId
	}
}

function matchesFilter(rec: CostRecord, filter: Partial<CostAttribution> | undefined): boolean {
	if (!filter) return true
	for (const [key, value] of Object.entries(filter)) {
		if (value === undefined) continue
		if (rec.attribution[key as keyof CostAttribution] !== value) return false
	}
	return true
}

function matchesWindow(rec: CostRecord, window: TimeWindow | undefined): boolean {
	if (!window) return true
	return rec.timestamp >= window.fromMs && rec.timestamp <= window.toMs
}

export function createLocalCostStore(options: LocalCostStoreOptions = {}): CostStore {
	const now = options.now ?? (() => Date.now())
	const reservationTtlMs = options.reservationTtlMs ?? 60_000

	const records: CostRecord[] = []
	const reservations = new Map<string, { token: ReservationToken; expiresAt: number }>()

	function purgeExpiredReservations(): void {
		const t = now()
		for (const [id, r] of reservations) {
			if (r.expiresAt <= t) reservations.delete(id)
		}
	}

	return {
		async record(rec: CostRecord): Promise<void> {
			records.push({
				...rec,
				attribution: { ...rec.attribution },
			})
		},

		async aggregate(
			by: CostDimensionKey,
			filter?: Partial<CostAttribution>,
			window?: TimeWindow,
		): Promise<readonly CostBucket[]> {
			const buckets = new Map<
				string,
				{ cost: number; tokens: number; calls: number; firstAt: number; lastAt: number }
			>()

			for (const rec of records) {
				if (!matchesFilter(rec, filter)) continue
				if (!matchesWindow(rec, window)) continue
				const key = dimensionValue(rec.attribution, by)
				if (key === undefined) continue

				const existing = buckets.get(key)
				const totalTokens = rec.inputTokens + rec.outputTokens
				if (existing) {
					existing.cost += rec.cost
					existing.tokens += totalTokens
					existing.calls += 1
					existing.firstAt = Math.min(existing.firstAt, rec.timestamp)
					existing.lastAt = Math.max(existing.lastAt, rec.timestamp)
				} else {
					buckets.set(key, {
						cost: rec.cost,
						tokens: totalTokens,
						calls: 1,
						firstAt: rec.timestamp,
						lastAt: rec.timestamp,
					})
				}
			}

			return Array.from(buckets, ([key, b]) => ({ key, ...b }))
		},

		async reserve(attribution: CostAttribution, estimatedCost: number): Promise<ReservationToken> {
			if (!Number.isFinite(estimatedCost) || estimatedCost < 0) {
				throw ElsiumError.validation(
					`CostStore.reserve: estimatedCost must be a non-negative finite number, got ${estimatedCost}`,
				)
			}
			purgeExpiredReservations()
			const token: ReservationToken = {
				id: generateId('rsv'),
				attribution: { ...attribution },
				reservedAmount: estimatedCost,
				expiresAt: now() + reservationTtlMs,
			}
			reservations.set(token.id, { token, expiresAt: token.expiresAt })
			return token
		},

		async commit(token: ReservationToken, actualCost: number): Promise<void> {
			if (!Number.isFinite(actualCost) || actualCost < 0) {
				throw ElsiumError.validation(
					`CostStore.commit: actualCost must be a non-negative finite number, got ${actualCost}`,
				)
			}
			if (!reservations.has(token.id)) {
				throw ElsiumError.validation(
					`CostStore.commit: reservation "${token.id}" not found (expired or already released?)`,
				)
			}
			reservations.delete(token.id)
			records.push({
				attribution: { ...token.attribution },
				cost: actualCost,
				inputTokens: 0,
				outputTokens: 0,
				timestamp: now(),
			})
		},

		async release(token: ReservationToken): Promise<void> {
			reservations.delete(token.id)
		},
	}
}
