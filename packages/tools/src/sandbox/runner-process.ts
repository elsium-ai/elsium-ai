import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { ElsiumError, generateId } from '@elsium-ai/core'
import type { SandboxConfig, SandboxRunner } from './types'

const FORK_ENTRY = fileURLToPath(new URL('./fork-entry.mjs', import.meta.url))

interface ProcessResultMessage {
	type: 'result'
	invocationId: string
	success: boolean
	data?: unknown
	error?: { name: string; message: string; stack?: string }
}

interface PendingInvocation {
	id: string
	resolve: (value: unknown) => void
	reject: (reason: unknown) => void
}

interface RunnerState {
	child: ReturnType<typeof fork> | null
	pending: PendingInvocation | null
	chain: Promise<unknown>
	disposed: boolean
}

function rejectPending(state: RunnerState, error: unknown): void {
	if (!state.pending) return
	const pending = state.pending
	state.pending = null
	pending.reject(error)
}

function attachChildListeners(child: ReturnType<typeof fork>, state: RunnerState): void {
	child.on('message', (msg: ProcessResultMessage) => {
		if (msg?.type !== 'result') return
		const pending = state.pending
		if (!pending || pending.id !== msg.invocationId) return
		state.pending = null
		if (msg.success) {
			pending.resolve(msg.data)
		} else {
			const error = new Error(msg.error?.message ?? 'Sandbox handler failed')
			if (msg.error?.name) error.name = msg.error.name
			if (msg.error?.stack) error.stack = msg.error.stack
			pending.reject(error)
		}
	})

	child.on('error', (err) => {
		state.child = null
		rejectPending(state, err)
	})

	child.on('exit', (code) => {
		if (state.child === child) state.child = null
		if (code !== 0) {
			rejectPending(state, new Error(`Sandbox process exited with code ${code}`))
		}
	})
}

function ensureChild(state: RunnerState, handlerPath: string): ReturnType<typeof fork> {
	if (state.child) return state.child
	const child = fork(FORK_ENTRY, [], {
		env: { ...process.env, ELS_HANDLER_PATH: handlerPath },
		stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
	})
	attachChildListeners(child, state)
	child.unref()
	state.child = child
	return child
}

function killChild(state: RunnerState): void {
	const dying = state.child
	state.child = null
	if (dying) {
		dying.kill('SIGTERM')
	}
}

function postInvocation(
	state: RunnerState,
	child: ReturnType<typeof fork>,
	invocationId: string,
	input: unknown,
	timeoutMs: number,
	handlerPath: string,
	signal: AbortSignal | undefined,
): Promise<unknown> {
	return new Promise<unknown>((resolve, reject) => {
		let timer: ReturnType<typeof setTimeout> | null = null
		let abortHandler: (() => void) | null = null

		const cleanup = () => {
			if (timer) clearTimeout(timer)
			if (signal && abortHandler) signal.removeEventListener('abort', abortHandler)
		}

		state.pending = {
			id: invocationId,
			resolve: (v) => {
				cleanup()
				resolve(v)
			},
			reject: (e) => {
				cleanup()
				reject(e)
			},
		}

		timer = setTimeout(() => {
			if (state.pending?.id !== invocationId) return
			const pending = state.pending
			state.pending = null
			killChild(state)
			pending.reject(ElsiumError.timeout(`sandbox(${handlerPath})`, timeoutMs))
		}, timeoutMs)

		if (signal) {
			abortHandler = () => {
				if (state.pending?.id !== invocationId) return
				const pending = state.pending
				state.pending = null
				killChild(state)
				pending.reject(new Error('Sandbox invocation aborted'))
			}
			signal.addEventListener('abort', abortHandler, { once: true })
		}

		try {
			child.send({ type: 'invoke', invocationId, input })
		} catch (err) {
			if (state.pending?.id === invocationId) state.pending = null
			cleanup()
			reject(err instanceof Error ? err : new Error(String(err)))
		}
	})
}

export function createProcessSandboxRunner(
	config: SandboxConfig,
	defaultTimeoutMs: number,
): SandboxRunner {
	const handlerPath = typeof config.handler === 'string' ? config.handler : config.handler.href
	const timeoutMs = config.timeoutMs ?? defaultTimeoutMs

	const state: RunnerState = {
		child: null,
		pending: null,
		chain: Promise.resolve(),
		disposed: false,
	}

	async function runOnce(input: unknown, signal?: AbortSignal): Promise<unknown> {
		if (state.disposed) {
			throw new Error('Sandbox runner has been disposed')
		}
		if (signal?.aborted) {
			throw new Error('Sandbox invocation aborted')
		}
		const child = ensureChild(state, handlerPath)
		const invocationId = generateId('si')
		return postInvocation(state, child, invocationId, input, timeoutMs, handlerPath, signal)
	}

	return {
		async invoke(input: unknown, signal?: AbortSignal): Promise<unknown> {
			const previous = state.chain.catch(() => undefined)
			const next = previous.then(() => runOnce(input, signal))
			state.chain = next.catch(() => undefined)
			return next
		},

		async dispose(): Promise<void> {
			state.disposed = true
			const c = state.child
			state.child = null
			rejectPending(state, new Error('Sandbox runner disposed'))
			if (c) {
				try {
					c.kill('SIGTERM')
				} catch {
					/* already dead */
				}
			}
		},
	}
}
