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
	dispose(): void
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
	let shutdownPromise: Promise<void> | null = null
	const signalHandlers: Array<{ signal: string; handler: () => void }> = []

	function checkDrained(): void {
		if (inFlightCount === 0 && drainResolve) {
			drainResolve()
			drainResolve = null
		}
	}

	async function shutdown(): Promise<void> {
		if (shutdownPromise) return shutdownPromise
		shuttingDown = true

		shutdownPromise = (async () => {
			config?.onDrainStart?.()

			if (inFlightCount === 0) {
				config?.onDrainComplete?.()
				return
			}

			const drainPromise = new Promise<void>((resolve) => {
				drainResolve = resolve
			})

			let drainTimer: ReturnType<typeof setTimeout> | undefined
			const timeoutPromise = new Promise<'timeout'>((resolve) => {
				drainTimer = setTimeout(() => resolve('timeout'), drainTimeoutMs)
			})

			const result = await Promise.race([
				drainPromise.then(() => 'drained' as const),
				timeoutPromise,
			])
			if (drainTimer !== undefined) clearTimeout(drainTimer)

			if (result === 'timeout') {
				config?.onForceShutdown?.()
			} else {
				config?.onDrainComplete?.()
			}
		})()

		return shutdownPromise
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

		dispose(): void {
			for (const { signal, handler } of signalHandlers) {
				process.removeListener(signal, handler)
			}
			signalHandlers.length = 0
		},
	}

	// Register signal handlers for graceful shutdown
	if (typeof process !== 'undefined' && process.on) {
		for (const signal of signals) {
			const handler = () => {
				manager.shutdown()
			}
			signalHandlers.push({ signal, handler })
			process.on(signal, handler)
		}
	}

	return manager
}
