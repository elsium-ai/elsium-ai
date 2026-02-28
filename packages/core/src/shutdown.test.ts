import { describe, expect, it, vi } from 'vitest'
import { createShutdownManager } from './shutdown'

describe('ShutdownManager', () => {
	it('starts with no in-flight operations', () => {
		const sm = createShutdownManager()
		expect(sm.inFlight).toBe(0)
		expect(sm.isShuttingDown).toBe(false)
	})

	it('tracks in-flight operations', async () => {
		const sm = createShutdownManager()

		let resolveOp: () => void
		const op = new Promise<void>((r) => {
			resolveOp = r
		})

		const tracked = sm.trackOperation(async () => {
			await op
			return 'done'
		})

		// Allow microtask to run
		await new Promise((r) => setTimeout(r, 10))
		expect(sm.inFlight).toBe(1)

		resolveOp?.()
		const result = await tracked
		expect(result).toBe('done')
		expect(sm.inFlight).toBe(0)
	})

	it('rejects new operations when shutting down', async () => {
		const sm = createShutdownManager()

		const shutdownPromise = sm.shutdown()
		await expect(sm.trackOperation(async () => 'test')).rejects.toThrow('shutting down')
		await shutdownPromise
	})

	it('waits for in-flight operations to drain', async () => {
		const sm = createShutdownManager({ drainTimeoutMs: 5000 })

		let resolveOp: () => void
		const op = sm.trackOperation(async () => {
			await new Promise<void>((r) => {
				resolveOp = r
			})
			return 'done'
		})

		const onDrainComplete = vi.fn()
		const sm2 = createShutdownManager({ drainTimeoutMs: 5000, onDrainComplete })

		const tracked = sm2.trackOperation(async () => {
			await new Promise((r) => setTimeout(r, 50))
			return 'done'
		})

		const shutdownPromise = sm2.shutdown()
		await tracked
		await shutdownPromise

		expect(onDrainComplete).toHaveBeenCalled()

		// Clean up first sm
		resolveOp?.()
		await op
	})

	it('calls onDrainStart when shutting down', async () => {
		const onDrainStart = vi.fn()
		const sm = createShutdownManager({ onDrainStart })

		await sm.shutdown()
		expect(onDrainStart).toHaveBeenCalledOnce()
	})

	it('calls onDrainComplete when no in-flight operations', async () => {
		const onDrainComplete = vi.fn()
		const sm = createShutdownManager({ onDrainComplete })

		await sm.shutdown()
		expect(onDrainComplete).toHaveBeenCalledOnce()
	})

	it('calls onForceShutdown on timeout', async () => {
		const onForceShutdown = vi.fn()
		const sm = createShutdownManager({ drainTimeoutMs: 50, onForceShutdown })

		// Start a long operation
		const op = sm.trackOperation(async () => {
			await new Promise((r) => setTimeout(r, 5000))
			return 'done'
		})

		await sm.shutdown()
		expect(onForceShutdown).toHaveBeenCalledOnce()

		// Clean up - op will reject because of shutdown
		op.catch(() => {})
	})

	it('shutdown is idempotent', async () => {
		const onDrainStart = vi.fn()
		const sm = createShutdownManager({ onDrainStart })

		await sm.shutdown()
		await sm.shutdown()
		expect(onDrainStart).toHaveBeenCalledOnce()
	})

	it('tracks multiple concurrent operations', async () => {
		const sm = createShutdownManager()

		const p1 = sm.trackOperation(async () => {
			await new Promise((r) => setTimeout(r, 20))
			return 1
		})
		const p2 = sm.trackOperation(async () => {
			await new Promise((r) => setTimeout(r, 30))
			return 2
		})

		expect(sm.inFlight).toBe(2)

		const [r1, r2] = await Promise.all([p1, p2])
		expect(r1).toBe(1)
		expect(r2).toBe(2)
		expect(sm.inFlight).toBe(0)
	})
})
