import { Worker } from 'node:worker_threads'
import { ElsiumError, generateId } from '@elsium-ai/core'
import { buildSandboxEnv } from './sandbox-env'
import type { SandboxConfig, SandboxRunner } from './types'

const WORKER_SCRIPT = `
const { parentPort, workerData } = require('node:worker_threads')

if (!parentPort) throw new Error('worker-runner must be run as a worker thread')

const { handlerPath } = workerData
let handlerPromise = null

async function loadHandler() {
	if (!handlerPromise) {
		handlerPromise = (async () => {
			const mod = await import(handlerPath)
			const fn = (mod && (mod.default || mod.handler)) || null
			if (typeof fn !== 'function') {
				throw new Error(
					'Sandbox handler module must export a default function or a named "handler" function: ' + handlerPath,
				)
			}
			return fn
		})().catch((err) => {
			handlerPromise = null
			throw err
		})
	}
	return handlerPromise
}

parentPort.on('message', async (msg) => {
	if (!msg || msg.type !== 'invoke') return
	try {
		const handler = await loadHandler()
		const result = await handler(msg.input)
		parentPort.postMessage({
			type: 'result',
			invocationId: msg.invocationId,
			success: true,
			data: result,
		})
	} catch (err) {
		parentPort.postMessage({
			type: 'result',
			invocationId: msg.invocationId,
			success: false,
			error: {
				name: (err && err.name) || 'Error',
				message: (err && err.message) || String(err),
				stack: err && err.stack,
			},
		})
	}
})
`

interface WorkerResultMessage {
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
	worker: Worker | null
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

function attachWorkerListeners(worker: Worker, state: RunnerState): void {
	worker.on('message', (msg: WorkerResultMessage) => {
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

	worker.on('error', (err) => {
		state.worker = null
		rejectPending(state, err)
	})

	worker.on('exit', (code) => {
		if (state.worker === worker) state.worker = null
		if (code !== 0) {
			rejectPending(state, new Error(`Sandbox worker exited with code ${code}`))
		}
	})
}

function ensureWorker(
	state: RunnerState,
	handlerPath: string,
	env: Record<string, string>,
): Worker {
	if (state.worker) return state.worker
	const w = new Worker(WORKER_SCRIPT, {
		eval: true,
		workerData: { handlerPath },
		env,
	})
	attachWorkerListeners(w, state)
	w.unref()
	state.worker = w
	return w
}

function killWorker(state: RunnerState): void {
	const dying = state.worker
	state.worker = null
	if (dying) {
		dying.terminate().catch(() => {
			/* worker may already be dead */
		})
	}
}

function postInvocation(
	state: RunnerState,
	worker: Worker,
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
			killWorker(state)
			pending.reject(ElsiumError.timeout(`sandbox(${handlerPath})`, timeoutMs))
		}, timeoutMs)

		if (signal) {
			abortHandler = () => {
				if (state.pending?.id !== invocationId) return
				const pending = state.pending
				state.pending = null
				killWorker(state)
				pending.reject(new Error('Sandbox invocation aborted'))
			}
			signal.addEventListener('abort', abortHandler, { once: true })
		}

		try {
			worker.postMessage({ type: 'invoke', invocationId, input })
		} catch (err) {
			if (state.pending?.id === invocationId) state.pending = null
			cleanup()
			reject(err instanceof Error ? err : new Error(String(err)))
		}
	})
}

export function createWorkerSandboxRunner(
	config: SandboxConfig,
	defaultTimeoutMs: number,
): SandboxRunner {
	const handlerPath = typeof config.handler === 'string' ? config.handler : config.handler.href
	const timeoutMs = config.timeoutMs ?? defaultTimeoutMs
	const workerEnv = buildSandboxEnv(config.env)

	const state: RunnerState = {
		worker: null,
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
		const worker = ensureWorker(state, handlerPath, workerEnv)
		const invocationId = generateId('si')
		return postInvocation(state, worker, invocationId, input, timeoutMs, handlerPath, signal)
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
			const w = state.worker
			state.worker = null
			rejectPending(state, new Error('Sandbox runner disposed'))
			if (w) {
				try {
					await w.terminate()
				} catch {
					/* already dead */
				}
			}
		},
	}
}
