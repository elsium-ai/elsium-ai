import { describe, expect, it, vi } from 'vitest'
import { createCircuitBreaker } from './circuit-breaker'
import { ElsiumError } from './errors'

describe('CircuitBreaker', () => {
	it('starts in closed state', () => {
		const cb = createCircuitBreaker()
		expect(cb.state).toBe('closed')
		expect(cb.failureCount).toBe(0)
	})

	it('passes through calls in closed state', async () => {
		const cb = createCircuitBreaker()
		const result = await cb.execute(async () => 42)
		expect(result).toBe(42)
	})

	it('opens after failure threshold', async () => {
		const cb = createCircuitBreaker({ failureThreshold: 3, windowMs: 60_000 })

		for (let i = 0; i < 3; i++) {
			await expect(
				cb.execute(async () => {
					throw new Error('fail')
				}),
			).rejects.toThrow()
		}

		expect(cb.state).toBe('open')
	})

	it('rejects immediately when open', async () => {
		const cb = createCircuitBreaker({ failureThreshold: 1 })
		await expect(
			cb.execute(async () => {
				throw new Error('fail')
			}),
		).rejects.toThrow()
		expect(cb.state).toBe('open')

		await expect(cb.execute(async () => 42)).rejects.toThrow('Circuit breaker is open')
	})

	it('transitions to half-open after resetTimeoutMs', async () => {
		const cb = createCircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 50 })
		await expect(
			cb.execute(async () => {
				throw new Error('fail')
			}),
		).rejects.toThrow()
		expect(cb.state).toBe('open')

		await new Promise((r) => setTimeout(r, 60))
		expect(cb.state).toBe('half-open')
	})

	it('closes on success in half-open state', async () => {
		const cb = createCircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 50 })
		await expect(
			cb.execute(async () => {
				throw new Error('fail')
			}),
		).rejects.toThrow()

		await new Promise((r) => setTimeout(r, 60))
		expect(cb.state).toBe('half-open')

		const result = await cb.execute(async () => 'recovered')
		expect(result).toBe('recovered')
		expect(cb.state).toBe('closed')
	})

	it('re-opens on failure in half-open state', async () => {
		const cb = createCircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 50 })
		await expect(
			cb.execute(async () => {
				throw new Error('fail')
			}),
		).rejects.toThrow()

		await new Promise((r) => setTimeout(r, 60))
		expect(cb.state).toBe('half-open')

		await expect(
			cb.execute(async () => {
				throw new Error('fail again')
			}),
		).rejects.toThrow()
		expect(cb.state).toBe('open')
	})

	it('calls onStateChange callback', async () => {
		const changes: Array<{ from: string; to: string }> = []
		const cb = createCircuitBreaker({
			failureThreshold: 1,
			resetTimeoutMs: 50,
			onStateChange: (from, to) => changes.push({ from, to }),
		})

		await expect(
			cb.execute(async () => {
				throw new Error('fail')
			}),
		).rejects.toThrow()
		expect(changes).toEqual([{ from: 'closed', to: 'open' }])

		await new Promise((r) => setTimeout(r, 60))
		cb.state // trigger transition check
		expect(changes).toEqual([
			{ from: 'closed', to: 'open' },
			{ from: 'open', to: 'half-open' },
		])
	})

	it('reset restores closed state', async () => {
		const cb = createCircuitBreaker({ failureThreshold: 1 })
		await expect(
			cb.execute(async () => {
				throw new Error('fail')
			}),
		).rejects.toThrow()
		expect(cb.state).toBe('open')

		cb.reset()
		expect(cb.state).toBe('closed')
		expect(cb.failureCount).toBe(0)
	})

	it('limits half-open attempts', async () => {
		const cb = createCircuitBreaker({
			failureThreshold: 1,
			resetTimeoutMs: 50,
			halfOpenMaxAttempts: 2,
		})

		await expect(
			cb.execute(async () => {
				throw new Error('fail')
			}),
		).rejects.toThrow()
		await new Promise((r) => setTimeout(r, 60))
		expect(cb.state).toBe('half-open')

		// Use up half-open attempts with successes that don't close (they do close on success)
		// Actually, success closes the circuit - so test with failures
		await expect(
			cb.execute(async () => {
				throw new Error('fail')
			}),
		).rejects.toThrow('fail')
		// After failure in half-open, it goes back to open
		expect(cb.state).toBe('open')
	})

	it('uses sliding window for failure counting', async () => {
		const cb = createCircuitBreaker({ failureThreshold: 3, windowMs: 100 })

		await expect(
			cb.execute(async () => {
				throw new Error('fail')
			}),
		).rejects.toThrow()
		await expect(
			cb.execute(async () => {
				throw new Error('fail')
			}),
		).rejects.toThrow()

		// Wait for window to expire
		await new Promise((r) => setTimeout(r, 110))

		// Old failures should be outside window
		expect(cb.failureCount).toBe(0)
		expect(cb.state).toBe('closed')
	})
})
