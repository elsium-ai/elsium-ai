import { ElsiumError } from './errors'

export interface ShutdownConfig {
	drainTimeoutMs?: number
	signals?: string[]
	onDrainStart?: () => void
	onDrainComplete?: () => void
	onForceShutdown?: () => void
}

export interface ShutdownManager {
	trackOperation<T>(fn: () => Promise<T>): Promise<T>
	shutdown(): Promise<void>
	readonly inFlight: number
	readonly isShuttingDown: boolean
}

export function createShutdownManager(config?: ShutdownConfig): ShutdownManager {
	const drainTimeoutMs = config?.drainTimeoutMs ?? 30_000
	const signals = config?.signals ?? ['SIGTERM', 'SIGINT']

	if (drainTimeoutMs < 0 || !Number.isFinite(drainTimeoutMs)) {
		throw new ElsiumError({
			code: 'CONFIG_ERROR',
			message: 'drainTimeoutMs must be >= 0 and finite',
			retryable: false,
		})
	}

	let shuttingDown = false
	let inFlightCount = 0
	let drainResolve: (() => void) | null = null

	function checkDrained(): void {
		if (inFlightCount === 0 && drainResolve) {
			drainResolve()
			drainResolve = null
		}
	}

	async function shutdown(): Promise<void> {
		if (shuttingDown) return
		shuttingDown = true

		config?.onDrainStart?.()

		if (inFlightCount === 0) {
			config?.onDrainComplete?.()
			return
		}

		const drainPromise = new Promise<void>((resolve) => {
			drainResolve = resolve
		})

		const timeoutPromise = new Promise<'timeout'>((resolve) => {
			setTimeout(() => resolve('timeout'), drainTimeoutMs)
		})

		const result = await Promise.race([drainPromise.then(() => 'drained' as const), timeoutPromise])

		if (result === 'timeout') {
			config?.onForceShutdown?.()
		} else {
			config?.onDrainComplete?.()
		}
	}

	const manager: ShutdownManager = {
		get inFlight(): number {
			return inFlightCount
		},

		get isShuttingDown(): boolean {
			return shuttingDown
		},

		async trackOperation<T>(fn: () => Promise<T>): Promise<T> {
			if (shuttingDown) {
				throw new ElsiumError({
					code: 'VALIDATION_ERROR',
					message: 'Server is shutting down, not accepting new operations',
					retryable: true,
				})
			}

			inFlightCount++
			try {
				return await fn()
			} finally {
				inFlightCount--
				checkDrained()
			}
		},

		shutdown,
	}

	// Register signal handlers for graceful shutdown
	if (typeof process !== 'undefined' && process.on) {
		for (const signal of signals) {
			process.on(signal, () => {
				manager.shutdown()
			})
		}
	}

	return manager
}
