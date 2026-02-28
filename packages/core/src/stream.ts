import type { StopReason, StreamCheckpoint, StreamEvent, TokenUsage } from './types'
import { generateId } from './utils'

export interface ResilientStreamOptions {
	checkpointIntervalMs?: number
	maxRetries?: number
	onCheckpoint?: (checkpoint: StreamCheckpoint) => void
	onPartialRecovery?: (text: string, error: Error) => void
}

export class ElsiumStream implements AsyncIterable<StreamEvent> {
	private readonly source: AsyncIterable<StreamEvent>

	constructor(source: AsyncIterable<StreamEvent>) {
		this.source = source
	}

	async *[Symbol.asyncIterator](): AsyncIterableIterator<StreamEvent> {
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
		return new Promise<string>((resolve, reject) => {
			const parts: string[] = []
			const timer = setTimeout(() => {
				resolve(parts.join(''))
			}, timeoutMs)

			const run = async () => {
				try {
					for await (const event of this.source) {
						if (event.type === 'text_delta') {
							parts.push(event.text)
						}
					}
					clearTimeout(timer)
					resolve(parts.join(''))
				} catch (err) {
					clearTimeout(timer)
					if (parts.length > 0) {
						resolve(parts.join(''))
					} else {
						reject(err)
					}
				}
			}
			run()
		})
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

						const now = Date.now()
						if (now - lastCheckpointTime >= checkpointIntervalMs && textAccumulator.length > 0) {
							const checkpoint: StreamCheckpoint = {
								id: generateId('ckpt'),
								timestamp: now,
								text: textAccumulator,
								tokensSoFar: Math.ceil(textAccumulator.length / 4),
								eventIndex,
							}
							onCheckpoint?.(checkpoint)
							yield { type: 'checkpoint' as const, checkpoint }
							lastCheckpointTime = now
						}
					}
				} catch (err) {
					const error = err instanceof Error ? err : new Error(String(err))
					if (textAccumulator.length > 0) {
						onPartialRecovery?.(textAccumulator, error)
						yield { type: 'recovery' as const, partialText: textAccumulator, error }
					} else {
						yield { type: 'error' as const, error }
					}
				}
			},
		}

		return new ElsiumStream(resilientSource)
	}
}

export type StreamTransformer = (source: AsyncIterable<StreamEvent>) => AsyncIterable<StreamEvent>

export function createStream(
	executor: (emit: (event: StreamEvent) => void) => Promise<void>,
): ElsiumStream {
	let resolve: ((value: IteratorResult<StreamEvent>) => void) | null = null
	const buffer: StreamEvent[] = []
	let done = false
	let error: Error | null = null

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
			buffer.push(event)
		}
	}

	executor(emit)
		.then(() => {
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
