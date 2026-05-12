/**
 * Fair queuing per-agent (R6).
 *
 * Token-bucket rate limiter where each identified agent has its own bucket.
 * Prevents one greedy agent from starving others on the same shared LLM
 * quota — the existing bulkhead in this package is global and cannot do
 * this per identity.
 *
 * Buckets are refilled continuously based on `refillRatePerSec`. Requests
 * consume one token. When the bucket is empty, the middleware waits up to
 * `waitTimeoutMs` for a token to become available, then either fails (throw)
 * or proceeds depending on `onTimeout`.
 *
 * Agent identification is pluggable via `identifyAgent`. Default reads
 * `ctx.metadata.agentName` (string) and falls back to '_default' when absent.
 *
 * In-process implementation only. Distributed fairness across instances is
 * a separate concern (Redis lua scripts, token-bucket service) and lives
 * outside the framework — the user implements that.
 */

import type { Middleware, MiddlewareContext, MiddlewareNext } from '@elsium-ai/core'
import { ElsiumError, sleep } from '@elsium-ai/core'

// ─── Config ─────────────────────────────────────────────────────

export interface BucketConfig {
	/** Maximum tokens the bucket can hold. */
	readonly capacity: number
	/** Tokens added per second (continuous refill). */
	readonly refillRatePerSec: number
}

export interface FairQueueConfig {
	/** Default bucket parameters applied to every agent. */
	readonly perAgent: BucketConfig
	/**
	 * Per-agent overrides. If an agent's name is in this map, its bucket uses
	 * these parameters instead of `perAgent`.
	 */
	readonly overrides?: Readonly<Record<string, BucketConfig>>
	/** How long to wait for a token before giving up. Default 5 s. */
	readonly waitTimeoutMs?: number
	/** Behavior when waitTimeoutMs elapses. Default 'throw'. */
	readonly onTimeout?: 'throw' | 'proceed'
	/**
	 * Extract the agent identity from the middleware context. Default reads
	 * `ctx.metadata.agentName`. Return undefined / empty to use the
	 * '_default' shared bucket.
	 */
	readonly identifyAgent?: (ctx: MiddlewareContext) => string | undefined
}

// ─── Bucket state (snapshot for observability) ─────────────────

export interface BucketState {
	readonly agent: string
	readonly tokens: number
	readonly capacity: number
	readonly refillRatePerSec: number
	readonly lastRefillAt: number
}

// ─── Internal bucket ───────────────────────────────────────────

interface Bucket {
	tokens: number
	capacity: number
	refillRatePerSec: number
	lastRefillAt: number
}

function refill(bucket: Bucket, now: number): void {
	const elapsedSec = (now - bucket.lastRefillAt) / 1000
	if (elapsedSec <= 0) return
	const added = elapsedSec * bucket.refillRatePerSec
	bucket.tokens = Math.min(bucket.capacity, bucket.tokens + added)
	bucket.lastRefillAt = now
}

function tryConsume(bucket: Bucket, now: number): boolean {
	refill(bucket, now)
	if (bucket.tokens >= 1) {
		bucket.tokens -= 1
		return true
	}
	return false
}

function timeToNextToken(bucket: Bucket): number {
	if (bucket.refillRatePerSec <= 0) return Number.POSITIVE_INFINITY
	const needed = 1 - bucket.tokens
	if (needed <= 0) return 0
	return Math.ceil((needed / bucket.refillRatePerSec) * 1000)
}

// ─── Engine ─────────────────────────────────────────────────────

export interface FairQueue {
	middleware(): Middleware
	getBucketState(agent: string): BucketState | null
	listBuckets(): readonly BucketState[]
}

function defaultIdentify(ctx: MiddlewareContext): string | undefined {
	const v = ctx.metadata.agentName
	return typeof v === 'string' && v.length > 0 ? v : undefined
}

const DEFAULT_AGENT = '_default'

function validateBucketConfig(c: BucketConfig, label: string): void {
	if (!Number.isFinite(c.capacity) || c.capacity <= 0) {
		throw ElsiumError.validation(`FairQueue ${label}: capacity must be a positive finite number`)
	}
	if (!Number.isFinite(c.refillRatePerSec) || c.refillRatePerSec <= 0) {
		throw ElsiumError.validation(
			`FairQueue ${label}: refillRatePerSec must be a positive finite number`,
		)
	}
}

export function createFairQueue(config: FairQueueConfig): FairQueue {
	validateBucketConfig(config.perAgent, 'perAgent')
	for (const [name, cfg] of Object.entries(config.overrides ?? {})) {
		validateBucketConfig(cfg, `overrides.${name}`)
	}

	const buckets = new Map<string, Bucket>()
	const identify = config.identifyAgent ?? defaultIdentify
	const waitTimeoutMs = config.waitTimeoutMs ?? 5_000
	const onTimeout = config.onTimeout ?? 'throw'

	function bucketFor(agent: string): Bucket {
		const existing = buckets.get(agent)
		if (existing) return existing
		const cfg = config.overrides?.[agent] ?? config.perAgent
		const created: Bucket = {
			tokens: cfg.capacity,
			capacity: cfg.capacity,
			refillRatePerSec: cfg.refillRatePerSec,
			lastRefillAt: Date.now(),
		}
		buckets.set(agent, created)
		return created
	}

	async function waitForToken(bucket: Bucket): Promise<boolean> {
		const deadline = Date.now() + waitTimeoutMs
		while (Date.now() < deadline) {
			if (tryConsume(bucket, Date.now())) return true
			const wait = Math.min(timeToNextToken(bucket), deadline - Date.now())
			if (wait <= 0) break
			await sleep(Math.max(1, wait))
		}
		return tryConsume(bucket, Date.now())
	}

	return {
		middleware(): Middleware {
			return async (ctx: MiddlewareContext, next: MiddlewareNext) => {
				const agent = identify(ctx) ?? DEFAULT_AGENT
				const bucket = bucketFor(agent)

				if (tryConsume(bucket, Date.now())) {
					return next(ctx)
				}

				const acquired = await waitForToken(bucket)
				if (!acquired) {
					if (onTimeout === 'proceed') {
						return next(ctx)
					}
					throw ElsiumError.rateLimit(agent, timeToNextToken(bucket))
				}
				return next(ctx)
			}
		},

		getBucketState(agent: string): BucketState | null {
			const b = buckets.get(agent)
			if (!b) return null
			refill(b, Date.now())
			return {
				agent,
				tokens: b.tokens,
				capacity: b.capacity,
				refillRatePerSec: b.refillRatePerSec,
				lastRefillAt: b.lastRefillAt,
			}
		},

		listBuckets(): readonly BucketState[] {
			const now = Date.now()
			const out: BucketState[] = []
			for (const [agent, b] of buckets) {
				refill(b, now)
				out.push({
					agent,
					tokens: b.tokens,
					capacity: b.capacity,
					refillRatePerSec: b.refillRatePerSec,
					lastRefillAt: b.lastRefillAt,
				})
			}
			return out
		},
	}
}
