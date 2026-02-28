import { ElsiumError } from './errors'

export type CircuitState = 'closed' | 'open' | 'half-open'

export interface CircuitBreakerConfig {
	failureThreshold?: number
	resetTimeoutMs?: number
	halfOpenMaxAttempts?: number
	windowMs?: number
	onStateChange?: (from: CircuitState, to: CircuitState) => void
}

export interface CircuitBreaker {
	execute<T>(fn: () => Promise<T>): Promise<T>
	readonly state: CircuitState
	readonly failureCount: number
	reset(): void
}

export function createCircuitBreaker(config?: CircuitBreakerConfig): CircuitBreaker {
	const failureThreshold = config?.failureThreshold ?? 5
	const resetTimeoutMs = config?.resetTimeoutMs ?? 30_000
	const halfOpenMaxAttempts = config?.halfOpenMaxAttempts ?? 3
	const windowMs = config?.windowMs ?? 60_000
	const onStateChange = config?.onStateChange

	let currentState: CircuitState = 'closed'
	let failureTimestamps: number[] = []
	let lastOpenedAt = 0
	let halfOpenAttempts = 0

	function transition(to: CircuitState): void {
		if (currentState === to) return
		const from = currentState
		currentState = to
		onStateChange?.(from, to)
	}

	function recordFailure(): void {
		const now = Date.now()
		failureTimestamps.push(now)
		// Keep only failures within the window
		failureTimestamps = failureTimestamps.filter((t) => now - t < windowMs)

		if (failureTimestamps.length >= failureThreshold) {
			lastOpenedAt = now
			halfOpenAttempts = 0
			transition('open')
		}
	}

	function recordSuccess(): void {
		if (currentState === 'half-open') {
			failureTimestamps = []
			halfOpenAttempts = 0
			transition('closed')
		}
	}

	return {
		get state(): CircuitState {
			// Check if we should transition from open to half-open
			if (currentState === 'open' && Date.now() - lastOpenedAt >= resetTimeoutMs) {
				transition('half-open')
			}
			return currentState
		},

		get failureCount(): number {
			const now = Date.now()
			failureTimestamps = failureTimestamps.filter((t) => now - t < windowMs)
			return failureTimestamps.length
		},

		async execute<T>(fn: () => Promise<T>): Promise<T> {
			// Check state (which may transition open -> half-open)
			const state = this.state

			if (state === 'open') {
				throw new ElsiumError({
					code: 'PROVIDER_ERROR',
					message: 'Circuit breaker is open',
					retryable: true,
				})
			}

			if (state === 'half-open' && halfOpenAttempts >= halfOpenMaxAttempts) {
				lastOpenedAt = Date.now()
				transition('open')
				throw new ElsiumError({
					code: 'PROVIDER_ERROR',
					message: 'Circuit breaker is open',
					retryable: true,
				})
			}

			if (state === 'half-open') {
				halfOpenAttempts++
			}

			try {
				const result = await fn()
				recordSuccess()
				return result
			} catch (error) {
				recordFailure()
				throw error
			}
		},

		reset(): void {
			failureTimestamps = []
			halfOpenAttempts = 0
			transition('closed')
		},
	}
}
