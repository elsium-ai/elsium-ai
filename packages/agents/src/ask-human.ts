import { ElsiumError, generateId } from '@elsium-ai/core'

export type AskHumanStatus = 'approved' | 'rejected' | 'timeout' | 'custom'

export interface AskHumanDecision<TOption extends string = string> {
	status: AskHumanStatus
	option?: TOption
	reason?: string
	decidedBy?: string
	decidedAt: number
}

export interface AskHumanRequest<TOption extends string = string> {
	id: string
	question: string
	options: readonly TOption[]
	context?: Record<string, unknown>
	createdAt: number
	timeoutMs: number
}

export interface AskHumanRecord<TOption extends string = string> {
	request: AskHumanRequest<TOption>
	decision?: AskHumanDecision<TOption>
	status: 'pending' | 'decided'
}

export interface AskHumanStore {
	save(record: AskHumanRecord): Promise<void>
	get(id: string): Promise<AskHumanRecord | undefined>
	listPending(): Promise<AskHumanRecord[]>
	delete(id: string): Promise<boolean>
}

export interface InMemoryAskHumanStoreConfig {
	clock?: () => number
}

export function createInMemoryAskHumanStore(
	_config: InMemoryAskHumanStoreConfig = {},
): AskHumanStore {
	const records = new Map<string, AskHumanRecord>()
	return {
		async save(record) {
			records.set(record.request.id, record)
		},
		async get(id) {
			return records.get(id)
		},
		async listPending() {
			return Array.from(records.values()).filter((r) => r.status === 'pending')
		},
		async delete(id) {
			return records.delete(id)
		},
	}
}

export type AskHumanResponder<TOption extends string = string> = (
	request: AskHumanRequest<TOption>,
) => Promise<AskHumanDecision<TOption>>

export interface AskHumanOptions<TOption extends string = string> {
	question: string
	options: readonly TOption[]
	context?: Record<string, unknown>
	timeoutMs?: number
	onTimeout?: 'reject' | 'timeout'
	store?: AskHumanStore
	responder?: AskHumanResponder<TOption>
	requestId?: string
}

const DEFAULT_TIMEOUT_MS = 24 * 60 * 60 * 1000

function parseDuration(value: string | number): number {
	if (typeof value === 'number') return value
	const match = value.match(/^(\d+)(ms|s|m|h|d)$/)
	if (!match)
		throw new ElsiumError({
			code: 'CONFIG_ERROR',
			message: `Bad duration: ${value}`,
			retryable: false,
		})
	const n = Number.parseInt(match[1], 10)
	const unit = match[2]
	if (unit === 'ms') return n
	if (unit === 's') return n * 1000
	if (unit === 'm') return n * 60 * 1000
	if (unit === 'h') return n * 60 * 60 * 1000
	return n * 24 * 60 * 60 * 1000
}

export async function askHuman<TOption extends string = string>(
	options: AskHumanOptions<TOption> & { timeoutMs?: string | number },
): Promise<AskHumanDecision<TOption>> {
	if (!options.question || typeof options.question !== 'string') {
		throw new ElsiumError({
			code: 'CONFIG_ERROR',
			message: 'askHuman requires a non-empty question',
			retryable: false,
		})
	}
	if (!options.options?.length) {
		throw new ElsiumError({
			code: 'CONFIG_ERROR',
			message: 'askHuman requires at least one option',
			retryable: false,
		})
	}

	const requestId = options.requestId ?? `human_${generateId('').slice(1)}`
	const timeoutMs = options.timeoutMs ? parseDuration(options.timeoutMs) : DEFAULT_TIMEOUT_MS

	const request: AskHumanRequest<TOption> = {
		id: requestId,
		question: options.question,
		options: options.options,
		context: options.context,
		createdAt: Date.now(),
		timeoutMs,
	}

	if (options.store) {
		await options.store.save({ request: request as AskHumanRequest, status: 'pending' })
	}

	let decision: AskHumanDecision<TOption> | undefined

	if (options.responder) {
		const responderPromise = options.responder(request)
		const timeoutPromise = new Promise<AskHumanDecision<TOption>>((resolve) => {
			setTimeout(() => {
				resolve({
					status: options.onTimeout === 'reject' ? 'rejected' : 'timeout',
					reason: `no response within ${timeoutMs}ms`,
					decidedAt: Date.now(),
				})
			}, timeoutMs).unref?.()
		})
		decision = await Promise.race([responderPromise, timeoutPromise])
	} else if (options.store) {
		decision = await pollForDecision(requestId, options.store, timeoutMs, options.onTimeout)
	} else {
		throw new ElsiumError({
			code: 'CONFIG_ERROR',
			message: 'askHuman requires either a responder callback or a store',
			retryable: false,
		})
	}

	if (options.store) {
		await options.store.save({
			request: request as AskHumanRequest,
			decision: decision as AskHumanDecision,
			status: 'decided',
		})
	}

	return decision
}

async function pollForDecision<TOption extends string>(
	requestId: string,
	store: AskHumanStore,
	timeoutMs: number,
	onTimeout: 'reject' | 'timeout' | undefined,
): Promise<AskHumanDecision<TOption>> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		const record = await store.get(requestId)
		if (record?.decision) return record.decision as AskHumanDecision<TOption>
		await new Promise((r) => setTimeout(r, 250))
	}
	return {
		status: onTimeout === 'reject' ? 'rejected' : 'timeout',
		reason: `no response within ${timeoutMs}ms`,
		decidedAt: Date.now(),
	}
}

export async function resolveAskHuman(
	store: AskHumanStore,
	requestId: string,
	decision: Omit<AskHumanDecision, 'decidedAt'>,
): Promise<void> {
	const record = await store.get(requestId)
	if (!record) {
		throw new ElsiumError({
			code: 'VALIDATION_ERROR',
			message: `askHuman request "${requestId}" not found`,
			retryable: false,
		})
	}
	record.decision = { ...decision, decidedAt: Date.now() }
	record.status = 'decided'
	await store.save(record)
}
