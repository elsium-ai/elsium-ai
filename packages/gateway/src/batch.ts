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
					results[index] = {
						index,
						success: false,
						error: 'Batch cancelled',
					}
					totalFailed++
					return
				}

				let lastError: string | undefined
				for (let attempt = 0; attempt <= retryPerItem; attempt++) {
					try {
						const response = await gateway.complete(requests[index])
						results[index] = { index, success: true, response }
						totalSucceeded++
						return
					} catch (err) {
						lastError = err instanceof Error ? err.message : String(err)
						if (attempt < retryPerItem && err instanceof ElsiumError && err.retryable) {
							continue
						}
						break
					}
				}

				results[index] = { index, success: false, error: lastError }
				totalFailed++
			}

			return new Promise<BatchResult>((resolve) => {
				function scheduleNext() {
					while (running < concurrency && nextIndex < requests.length) {
						if (signal?.aborted) {
							// Mark remaining as cancelled
							for (let i = nextIndex; i < requests.length; i++) {
								results[i] = { index: i, success: false, error: 'Batch cancelled' }
								totalFailed++
							}
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
