import type { Middleware, MiddlewareContext, MiddlewareNext } from '@elsium-ai/core'
import { ElsiumError } from '@elsium-ai/core'

export interface BulkheadConfig {
	maxConcurrent?: number
	maxQueued?: number
	queueTimeoutMs?: number
}

export interface Bulkhead {
	execute<T>(fn: () => Promise<T>): Promise<T>
	readonly active: number
	readonly queued: number
}

export function createBulkhead(config?: BulkheadConfig): Bulkhead {
	const maxConcurrent = config?.maxConcurrent ?? 10
	const maxQueued = config?.maxQueued ?? 50
	const queueTimeoutMs = config?.queueTimeoutMs ?? 30_000

	let activeCount = 0
	const queue: Array<{ resolve: () => void; reject: (err: Error) => void }> = []

	function tryDequeue(): void {
		while (activeCount < maxConcurrent && queue.length > 0) {
			activeCount++
			const next = queue.shift()
			if (next) next.resolve()
		}
	}

	return {
		get active(): number {
			return activeCount
		},

		get queued(): number {
			return queue.length
		},

		async execute<T>(fn: () => Promise<T>): Promise<T> {
			if (activeCount < maxConcurrent) {
				activeCount++
			} else if (queue.length >= maxQueued) {
				throw ElsiumError.rateLimit('bulkhead')
			} else {
				await new Promise<void>((resolve, reject) => {
					const entry = { resolve, reject }
					queue.push(entry)

					const timer = setTimeout(() => {
						const idx = queue.indexOf(entry)
						if (idx !== -1) {
							queue.splice(idx, 1)
							reject(
								new ElsiumError({
									code: 'TIMEOUT',
									message: `Bulkhead queue timeout after ${queueTimeoutMs}ms`,
									retryable: true,
								}),
							)
						}
					}, queueTimeoutMs)

					// Clean up timer when resolved
					const origResolve = entry.resolve
					entry.resolve = () => {
						clearTimeout(timer)
						origResolve()
					}
				})
			}

			try {
				return await fn()
			} finally {
				activeCount--
				tryDequeue()
			}
		},
	}
}

export function bulkheadMiddleware(config?: BulkheadConfig): Middleware {
	const bulkhead = createBulkhead(config)

	return async (ctx: MiddlewareContext, next: MiddlewareNext) => {
		return bulkhead.execute(() => next(ctx))
	}
}
