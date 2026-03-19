import { createLogger } from '@elsium-ai/core'
import type { AuditEvent } from './audit'

const log = createLogger()

export interface AuditSink {
	name: string
	filter?: (event: AuditEvent) => boolean
	send(events: AuditEvent[]): Promise<void>
	shutdown?(): Promise<void>
}

export interface AuditSinkRetryConfig {
	maxRetries?: number
	baseDelayMs?: number
	maxDelayMs?: number
}

export interface SinkManagerConfig {
	sinks: AuditSink[]
	batch?: {
		size?: number
		intervalMs?: number
	}
	retry?: AuditSinkRetryConfig
	maxBufferSize?: number
	deadLetterSink?: AuditSink
	onError?: (sinkName: string, error: unknown) => void
}

export interface SinkManager {
	dispatch(event: AuditEvent): void
	flush(): Promise<void>
	shutdown(): Promise<void>
}

function getRetryDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
	const delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs)
	return delay * (0.5 + Math.random() * 0.5)
}

async function sendWithRetry(
	sink: AuditSink,
	events: AuditEvent[],
	retryConfig: Required<AuditSinkRetryConfig>,
): Promise<void> {
	let lastError: unknown
	for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
		try {
			await sink.send(events)
			return
		} catch (error) {
			lastError = error
			if (attempt < retryConfig.maxRetries) {
				const delay = getRetryDelay(attempt, retryConfig.baseDelayMs, retryConfig.maxDelayMs)
				await new Promise((resolve) => setTimeout(resolve, delay))
			}
		}
	}
	throw lastError
}

async function deliverToSink(
	sink: AuditSink,
	events: AuditEvent[],
	retryConfig: Required<AuditSinkRetryConfig>,
	deadLetterSink: AuditSink | undefined,
	onError: ((sinkName: string, error: unknown) => void) | undefined,
): Promise<void> {
	const filtered = sink.filter ? events.filter(sink.filter) : events
	if (filtered.length === 0) return

	try {
		await sendWithRetry(sink, filtered, retryConfig)
	} catch (error) {
		log.error('Audit sink delivery failed', { sink: sink.name })
		onError?.(sink.name, error)

		if (!deadLetterSink) return
		try {
			await deadLetterSink.send(filtered)
		} catch (dlqError) {
			log.error('Dead letter sink delivery failed', { sink: deadLetterSink.name })
			onError?.(deadLetterSink.name, dlqError)
		}
	}
}

export function createSinkManager(config: SinkManagerConfig): SinkManager {
	const { sinks, onError, deadLetterSink } = config
	const batchSize = config.batch?.size ?? 50
	const batchIntervalMs = config.batch?.intervalMs ?? 5000
	const maxBufferSize = config.maxBufferSize ?? 10_000
	const retryConfig: Required<AuditSinkRetryConfig> = {
		maxRetries: config.retry?.maxRetries ?? 3,
		baseDelayMs: config.retry?.baseDelayMs ?? 1000,
		maxDelayMs: config.retry?.maxDelayMs ?? 30_000,
	}

	const buffer: AuditEvent[] = []
	const inFlight: Set<Promise<void>> = new Set()
	let flushTimer: ReturnType<typeof setInterval> | null = null

	function dispatchBatch(batch: AuditEvent[]): void {
		if (batch.length === 0 || sinks.length === 0) return

		const promises = sinks.map((sink) =>
			deliverToSink(sink, batch, retryConfig, deadLetterSink, onError),
		)

		const combined = Promise.allSettled(promises).then(() => {
			inFlight.delete(combined)
		})
		inFlight.add(combined)
	}

	function drainBuffer(): void {
		while (buffer.length > 0) {
			const batch = buffer.splice(0, batchSize)
			dispatchBatch(batch)
		}
	}

	flushTimer = setInterval(() => {
		if (buffer.length > 0) drainBuffer()
	}, batchIntervalMs)
	if (typeof flushTimer === 'object' && 'unref' in flushTimer) {
		flushTimer.unref()
	}

	return {
		dispatch(event: AuditEvent): void {
			if (buffer.length >= maxBufferSize) {
				buffer.shift()
				log.warn('Audit sink buffer full, dropping oldest event')
			}
			buffer.push(event)
			if (buffer.length >= batchSize) drainBuffer()
		},

		async flush(): Promise<void> {
			drainBuffer()
			await Promise.allSettled([...inFlight])
		},

		async shutdown(): Promise<void> {
			if (flushTimer) {
				clearInterval(flushTimer)
				flushTimer = null
			}
			drainBuffer()
			await Promise.allSettled([...inFlight])
			await Promise.allSettled(sinks.map((sink) => sink.shutdown?.()))
		},
	}
}
