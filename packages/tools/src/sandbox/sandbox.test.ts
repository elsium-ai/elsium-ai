import { threadId } from 'node:worker_threads'
import { afterEach, describe, expect, it } from 'vitest'
import { createSandboxRunner, createWorkerSandboxRunner } from './runner'
import type { SandboxConfig } from './types'

const HANDLERS = new URL('./__test_handlers__/', import.meta.url)
const handler = (name: string) => new URL(`./${name}`, HANDLERS)

const runners: Array<{ dispose(): Promise<void> }> = []

afterEach(async () => {
	while (runners.length > 0) {
		const r = runners.pop()
		await r?.dispose()
	}
})

function track<T extends { dispose(): Promise<void> }>(runner: T): T {
	runners.push(runner)
	return runner
}

const modes = ['worker', 'process'] as const

describe('createWorkerSandboxRunner — functional', () => {
	it('invokes a handler module and returns its result', async () => {
		const runner = track(
			createWorkerSandboxRunner({ mode: 'worker', handler: handler('echo.mjs') }, 5_000),
		)
		const result = (await runner.invoke({ hello: 'world' })) as { received: { hello: string } }
		expect(result.received).toEqual({ hello: 'world' })
	})

	it('serializes concurrent invocations through the same worker', async () => {
		const runner = track(
			createWorkerSandboxRunner({ mode: 'worker', handler: handler('echo.mjs') }, 5_000),
		)
		const results = (await Promise.all(
			Array.from({ length: 5 }, (_, i) => runner.invoke({ index: i })),
		)) as Array<{ received: { index: number } }>
		expect(results.map((r) => r.received.index)).toEqual([0, 1, 2, 3, 4])
	})

	it('propagates handler errors with name and message', async () => {
		const runner = track(
			createWorkerSandboxRunner({ mode: 'worker', handler: handler('throws.mjs') }, 5_000),
		)
		await expect(runner.invoke({ q: 'x' })).rejects.toMatchObject({
			name: 'TypeError',
			message: expect.stringContaining('fixture error'),
		})
	})

	it('rejects when the handler module has no default export', async () => {
		const runner = track(
			createWorkerSandboxRunner({ mode: 'worker', handler: handler('no-export.mjs') }, 5_000),
		)
		await expect(runner.invoke({})).rejects.toThrow(/must export a default function/)
	})

	it('rejects when the handler module does not exist', async () => {
		const runner = track(
			createWorkerSandboxRunner({ mode: 'worker', handler: handler('does-not-exist.mjs') }, 5_000),
		)
		await expect(runner.invoke({})).rejects.toBeInstanceOf(Error)
	})

	it('terminates the worker on timeout and throws TIMEOUT', async () => {
		const runner = track(
			createWorkerSandboxRunner(
				{ mode: 'worker', handler: handler('slow.mjs'), timeoutMs: 100 },
				5_000,
			),
		)
		await expect(runner.invoke({ ms: 30_000 })).rejects.toMatchObject({
			code: 'TIMEOUT',
		})
	})

	it('respawns a fresh worker after a process.exit()-driven worker death', async () => {
		const echoRunner = track(
			createWorkerSandboxRunner({ mode: 'worker', handler: handler('echo.mjs') }, 5_000),
		)
		const crashRunner = track(
			createWorkerSandboxRunner({ mode: 'worker', handler: handler('crash.mjs') }, 5_000),
		)
		const first = (await echoRunner.invoke({ a: 1 })) as { received: { a: number } }
		expect(first.received.a).toBe(1)
		await expect(crashRunner.invoke({})).rejects.toThrow(/code 7/)
		await expect(crashRunner.invoke({})).rejects.toThrow(/code 7/)
		const second = (await echoRunner.invoke({ a: 2 })) as { received: { a: number } }
		expect(second.received.a).toBe(2)
	})

	it('aborts an in-flight invocation when the external signal aborts', async () => {
		const runner = track(
			createWorkerSandboxRunner({ mode: 'worker', handler: handler('slow.mjs') }, 30_000),
		)
		const controller = new AbortController()
		setTimeout(() => controller.abort(), 50)
		await expect(runner.invoke({ ms: 30_000 }, controller.signal)).rejects.toThrow(/aborted/)
	})

	it('refuses invocations after dispose', async () => {
		const runner = createWorkerSandboxRunner(
			{ mode: 'worker', handler: handler('echo.mjs') },
			5_000,
		)
		await runner.invoke({ before: true })
		await runner.dispose()
		await expect(runner.invoke({ after: true })).rejects.toThrow(/disposed/)
	})

	it('dispose is idempotent', async () => {
		const runner = createWorkerSandboxRunner(
			{ mode: 'worker', handler: handler('echo.mjs') },
			5_000,
		)
		await runner.dispose()
		await expect(runner.dispose()).resolves.toBeUndefined()
	})
})

describe('createWorkerSandboxRunner — isolation guarantees', () => {
	it('runs the handler in a different thread (process isolation)', async () => {
		const runner = track(
			createWorkerSandboxRunner({ mode: 'worker', handler: handler('identity.mjs') }, 5_000),
		)
		const result = (await runner.invoke({})) as {
			pid: number
			threadId: number
			isMainThread: boolean
		}
		expect(result.pid).toBe(process.pid)
		expect(result.threadId).not.toBe(threadId)
		expect(result.isMainThread).toBe(false)
	})

	it('does NOT expose host globalThis values to the sandbox (closure-state isolation)', async () => {
		const globalRef = globalThis as unknown as { __elsium_test_secret?: string }
		globalRef.__elsium_test_secret = 'host-only-secret'
		try {
			const runner = track(
				createWorkerSandboxRunner(
					{ mode: 'worker', handler: handler('closure-attempt.mjs') },
					5_000,
				),
			)
			const result = (await runner.invoke({})) as {
				hostSecretVisible: boolean
				hostSecretValue: unknown
			}
			expect(result.hostSecretVisible).toBe(false)
			expect(result.hostSecretValue).toBeNull()
		} finally {
			globalRef.__elsium_test_secret = undefined
		}
	})

	it('survives a handler that calls process.exit() — main process keeps running', async () => {
		const runner = track(
			createWorkerSandboxRunner({ mode: 'worker', handler: handler('crash.mjs') }, 5_000),
		)
		await expect(runner.invoke({})).rejects.toThrow(/code 7/)
		expect(typeof process.pid).toBe('number')
	})
})

describe.each(modes)('createSandboxRunner — %s mode', (mode) => {
	const cfg = (m: 'worker' | 'process'): SandboxConfig => ({
		mode: m,
		handler: handler('echo.mjs'),
	})

	it('invokes a handler module and returns its result', async () => {
		const runner = track(createSandboxRunner(cfg(mode), 5_000))
		const result = (await runner.invoke({ hello: 'world' })) as { received: { hello: string } }
		expect(result.received).toEqual({ hello: 'world' })
	})

	it('serializes concurrent invocations through the same runner', async () => {
		const runner = track(createSandboxRunner(cfg(mode), 5_000))
		const results = (await Promise.all(
			Array.from({ length: 5 }, (_, i) => runner.invoke({ index: i })),
		)) as Array<{ received: { index: number } }>
		expect(results.map((r) => r.received.index)).toEqual([0, 1, 2, 3, 4])
	})

	it('propagates handler errors with name and message', async () => {
		const runner = track(createSandboxRunner({ mode, handler: handler('throws.mjs') }, 5_000))
		await expect(runner.invoke({ q: 'x' })).rejects.toMatchObject({
			name: 'TypeError',
			message: expect.stringContaining('fixture error'),
		})
	})

	it('rejects when the handler module has no default export', async () => {
		const runner = track(createSandboxRunner({ mode, handler: handler('no-export.mjs') }, 5_000))
		await expect(runner.invoke({})).rejects.toThrow(/must export a default function/)
	})

	it('rejects when the handler module does not exist', async () => {
		const runner = track(
			createSandboxRunner({ mode, handler: handler('does-not-exist.mjs') }, 5_000),
		)
		await expect(runner.invoke({})).rejects.toBeInstanceOf(Error)
	})

	it('terminates on timeout and throws TIMEOUT', async () => {
		const runner = track(
			createSandboxRunner({ mode, handler: handler('slow.mjs'), timeoutMs: 200 }, 5_000),
		)
		await expect(runner.invoke({ ms: 30_000 })).rejects.toMatchObject({
			code: 'TIMEOUT',
		})
	})

	it('aborts an in-flight invocation when the external signal aborts', async () => {
		const runner = track(createSandboxRunner({ mode, handler: handler('slow.mjs') }, 30_000))
		const controller = new AbortController()
		setTimeout(() => controller.abort(), 50)
		await expect(runner.invoke({ ms: 30_000 }, controller.signal)).rejects.toThrow(/aborted/)
	})

	it('survives a handler that calls process.exit() — main process keeps running', async () => {
		const runner = track(createSandboxRunner({ mode, handler: handler('crash.mjs') }, 5_000))
		await expect(runner.invoke({})).rejects.toThrow(/code 7/)
		expect(typeof process.pid).toBe('number')
	})

	it('refuses invocations after dispose', async () => {
		const runner = createSandboxRunner(cfg(mode), 5_000)
		await runner.invoke({ before: true })
		await runner.dispose()
		await expect(runner.invoke({ after: true })).rejects.toThrow(/disposed/)
	})

	it('dispose is idempotent', async () => {
		const runner = createSandboxRunner(cfg(mode), 5_000)
		await runner.dispose()
		await expect(runner.dispose()).resolves.toBeUndefined()
	})

	if (mode === 'worker') {
		it('runs the handler in a different thread', async () => {
			const runner = track(createSandboxRunner({ mode, handler: handler('identity.mjs') }, 5_000))
			const result = (await runner.invoke({})) as {
				pid: number
				threadId: number
				isMainThread: boolean
			}
			expect(result.pid).toBe(process.pid)
			expect(result.threadId).not.toBe(threadId)
			expect(result.isMainThread).toBe(false)
		})

		it('does NOT expose host globalThis values to the sandbox', async () => {
			const globalRef = globalThis as unknown as { __elsium_test_secret?: string }
			globalRef.__elsium_test_secret = 'host-only-secret'
			try {
				const runner = track(
					createSandboxRunner({ mode, handler: handler('closure-attempt.mjs') }, 5_000),
				)
				const result = (await runner.invoke({})) as {
					hostSecretVisible: boolean
					hostSecretValue: unknown
				}
				expect(result.hostSecretVisible).toBe(false)
				expect(result.hostSecretValue).toBeNull()
			} finally {
				globalRef.__elsium_test_secret = undefined
			}
		})
	}
})
