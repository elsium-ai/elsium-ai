import type { CompletionRequest, LLMResponse } from '@elsium-ai/core'
import { ElsiumError, createLogger } from '@elsium-ai/core'
import type { Gateway } from './gateway'

const log = createLogger()

export interface BatchConfig {
	concurrency?: number
	retryPerItem?: number
	onProgress?: (completed: number, total: number) => void
	signal?: AbortSignal
}

export interface BatchResultItem {
	index: number
	success: boolean
	response?: LLMResponse
	error?: string
}

export interface BatchResult {
	results: BatchResultItem[]
	totalSucceeded: number
	totalFailed: number
	totalDurationMs: number
}

function makeCancelledItem(index: number): BatchResultItem {
	return { index, success: false, error: 'Batch cancelled' }
}

function makeFailedItem(index: number, error: string | undefined): BatchResultItem {
	return { index, success: false, error }
}

async function attemptRequest(
	gateway: Gateway,
	request: CompletionRequest,
	retryPerItem: number,
): Promise<{ response?: LLMResponse; error?: string }> {
	let lastError: string | undefined
	for (let attempt = 0; attempt <= retryPerItem; attempt++) {
		try {
			const response = await gateway.complete(request)
			return { response }
		} catch (err) {
			lastError = err instanceof Error ? err.message : String(err)
			const isRetryable = attempt < retryPerItem && err instanceof ElsiumError && err.retryable
			if (!isRetryable) break
		}
	}
	return { error: lastError }
}

function cancelRemaining(results: BatchResultItem[], fromIndex: number, total: number): number {
	let cancelled = 0
	for (let i = fromIndex; i < total; i++) {
		results[i] = makeCancelledItem(i)
		cancelled++
	}
	return cancelled
}

export function createBatch(
	gateway: Gateway,
	config?: BatchConfig,
): { execute(requests: CompletionRequest[]): Promise<BatchResult> } {
	const concurrency = config?.concurrency ?? 5
	const retryPerItem = config?.retryPerItem ?? 0

	return {
		async execute(requests: CompletionRequest[]): Promise<BatchResult> {
			const startTime = performance.now()
			const results: BatchResultItem[] = new Array(requests.length)
			let completed = 0
			let totalSucceeded = 0
			let totalFailed = 0

			// Semaphore-based concurrency control
			let running = 0
			let nextIndex = 0
			const signal = config?.signal

			async function processItem(index: number): Promise<void> {
				if (signal?.aborted) {
					results[index] = makeCancelledItem(index)
					totalFailed++
					return
				}

				const result = await attemptRequest(gateway, requests[index], retryPerItem)
				if (result.response) {
					results[index] = { index, success: true, response: result.response }
					totalSucceeded++
				} else {
					results[index] = makeFailedItem(index, result.error)
					totalFailed++
				}
			}

			return new Promise<BatchResult>((resolve) => {
				function scheduleNext() {
					while (running < concurrency && nextIndex < requests.length) {
						if (signal?.aborted) {
							totalFailed += cancelRemaining(results, nextIndex, requests.length)
							nextIndex = requests.length
							break
						}

						const idx = nextIndex++
						running++

						processItem(idx).then(() => {
							running--
							completed++
							config?.onProgress?.(completed, requests.length)

							if (completed === requests.length) {
								resolve({
									results,
									totalSucceeded,
									totalFailed,
									totalDurationMs: Math.round(performance.now() - startTime),
								})
							} else {
								scheduleNext()
							}
						})
					}
				}

				if (requests.length === 0) {
					resolve({
						results: [],
						totalSucceeded: 0,
						totalFailed: 0,
						totalDurationMs: 0,
					})
					return
				}

				scheduleNext()
			})
		},
	}
}
