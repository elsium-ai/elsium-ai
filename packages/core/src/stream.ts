import type { StopReason, StreamCheckpoint, StreamEvent, TokenUsage } from './types'
import { generateId } from './utils'

export interface ResilientStreamOptions {
	checkpointIntervalMs?: number
	onCheckpoint?: (checkpoint: StreamCheckpoint) => void
	onPartialRecovery?: (text: string, error: Error) => void
}

function shouldEmitCheckpoint(
	lastCheckpointTime: number,
	intervalMs: number,
	textLength: number,
): boolean {
	const elapsed = Date.now() - lastCheckpointTime
	return elapsed >= intervalMs && textLength > 0
}

function createCheckpoint(
	textAccumulator: string,
	eventIndex: number,
	now: number,
): StreamCheckpoint {
	return {
		id: generateId('ckpt'),
		timestamp: now,
		text: textAccumulator,
		tokensSoFar: Math.ceil(textAccumulator.length / 1.5),
		eventIndex,
	}
}

function toError(err: unknown): Error {
	return err instanceof Error ? err : new Error(String(err))
}

function* emitErrorEvent(
	err: unknown,
	textAccumulator: string,
	onPartialRecovery?: (text: string, error: Error) => void,
) {
	const error = toError(err)
	if (textAccumulator.length > 0) {
		onPartialRecovery?.(textAccumulator, error)
		yield { type: 'recovery' as const, partialText: textAccumulator, error }
	} else {
		yield { type: 'error' as const, error }
	}
}

export class ElsiumStream implements AsyncIterable<StreamEvent> {
	private readonly source: AsyncIterable<StreamEvent>
	private iterating = false

	constructor(source: AsyncIterable<StreamEvent>) {
		this.source = source
	}

	async *[Symbol.asyncIterator](): AsyncIterableIterator<StreamEvent> {
		if (this.iterating) {
			throw new Error('ElsiumStream supports only a single consumer')
		}
		this.iterating = true
		yield* this.source
	}

	text(): AsyncIterable<string> {
		const source = this.source
		return {
			async *[Symbol.asyncIterator]() {
				for await (const event of source) {
					if (event.type === 'text_delta') {
						yield event.text
					}
				}
			},
		}
	}

	async toText(): Promise<string> {
		const parts: string[] = []
		for await (const text of this.text()) {
			parts.push(text)
		}
		return parts.join('')
	}

	async toTextWithTimeout(timeoutMs: number): Promise<string> {
		const parts: string[] = []
		const deadline = Date.now() + timeoutMs
		const iterator = this.source[Symbol.asyncIterator]()

		try {
			while (true) {
				const remaining = deadline - Date.now()
				if (remaining <= 0) break

				let timer: ReturnType<typeof setTimeout> | undefined
				const timeoutPromise = new Promise<{ value: undefined; done: true }>((resolve) => {
					timer = setTimeout(() => resolve({ value: undefined, done: true }), remaining)
				})

				const result = await Promise.race([iterator.next(), timeoutPromise])
				if (timer !== undefined) clearTimeout(timer)

				if (result.done) break

				const event = result.value as StreamEvent
				if (event.type === 'text_delta') {
					parts.push(event.text)
				}
			}
		} catch (err) {
			if (parts.length === 0) throw err
		} finally {
			await iterator.return?.()
		}

		return parts.join('')
	}

	async toResponse(): Promise<{
		text: string
		usage: TokenUsage | null
		stopReason: StopReason | null
	}> {
		const parts: string[] = []
		let usage: TokenUsage | null = null
		let stopReason: StopReason | null = null

		for await (const event of this.source) {
			switch (event.type) {
				case 'text_delta':
					parts.push(event.text)
					break
				case 'message_end':
					usage = event.usage
					stopReason = event.stopReason
					break
			}
		}

		return { text: parts.join(''), usage, stopReason }
	}

	pipe(transform: StreamTransformer): ElsiumStream {
		return new ElsiumStream(transform(this.source))
	}

	resilient(options: ResilientStreamOptions = {}): ElsiumStream {
		const { checkpointIntervalMs = 1000, onCheckpoint, onPartialRecovery } = options
		const source = this.source

		const resilientSource: AsyncIterable<StreamEvent> = {
			async *[Symbol.asyncIterator]() {
				let lastCheckpointTime = Date.now()
				let textAccumulator = ''
				let eventIndex = 0

				try {
					for await (const event of source) {
						eventIndex++

						if (event.type === 'text_delta') {
							textAccumulator += event.text
						}

						yield event

						if (
							shouldEmitCheckpoint(lastCheckpointTime, checkpointIntervalMs, textAccumulator.length)
						) {
							const now = Date.now()
							const checkpoint = createCheckpoint(textAccumulator, eventIndex, now)
							onCheckpoint?.(checkpoint)
							yield { type: 'checkpoint' as const, checkpoint }
							lastCheckpointTime = now
						}
					}
				} catch (err) {
					yield* emitErrorEvent(err, textAccumulator, onPartialRecovery)
				}
			},
		}

		return new ElsiumStream(resilientSource)
	}
}

export type StreamTransformer = (source: AsyncIterable<StreamEvent>) => AsyncIterable<StreamEvent>

const MAX_BUFFER_SIZE = 10_000

export function createStream(
	executor: (emit: (event: StreamEvent) => void) => Promise<void>,
): ElsiumStream {
	let resolve: ((value: IteratorResult<StreamEvent>) => void) | null = null
	const buffer: StreamEvent[] = []
	let done = false
	let error: Error | null = null
	let dropped = 0

	const source: AsyncIterable<StreamEvent> = {
		[Symbol.asyncIterator]() {
			return {
				next(): Promise<IteratorResult<StreamEvent>> {
					if (buffer.length > 0) {
						const value = buffer.shift() as StreamEvent
						return Promise.resolve({ value, done: false })
					}
					if (done) {
						return Promise.resolve({ value: undefined, done: true })
					}
					if (error) {
						return Promise.reject(error)
					}
					return new Promise((r) => {
						resolve = r
					})
				},
			}
		},
	}

	const emit = (event: StreamEvent) => {
		if (resolve) {
			const r = resolve
			resolve = null
			r({ value: event, done: false })
		} else {
			if (buffer.length < MAX_BUFFER_SIZE) {
				buffer.push(event)
			} else {
				dropped++
			}
		}
	}

	executor(emit)
		.then(() => {
			if (dropped > 0) {
				emit({
					type: 'error',
					error: new Error(`Stream buffer overflow: ${dropped} events dropped`),
				})
			}
			done = true
			if (resolve) {
				const r = resolve
				resolve = null
				r({ value: undefined, done: true })
			}
		})
		.catch((e) => {
			error = e instanceof Error ? e : new Error(String(e))
			if (resolve) {
				resolve({ value: { type: 'error', error: error } as StreamEvent, done: false })
				resolve = null
			}
		})

	return new ElsiumStream(source)
}
