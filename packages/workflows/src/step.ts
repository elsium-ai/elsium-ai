import { ElsiumError, sleep } from '@elsium-ai/core'
import type { z } from 'zod'
import type { RetryConfig, StepConfig, StepContext, StepResult } from './types'

export function step<TInput, TOutput>(
	name: string,
	config: Omit<StepConfig<TInput, TOutput>, 'name'>,
): StepConfig<TInput, TOutput> {
	return { name, ...config }
}

export async function executeStep<TInput, TOutput>(
	stepConfig: StepConfig<TInput, TOutput>,
	rawInput: unknown,
	context: StepContext,
): Promise<StepResult<TOutput>> {
	const startTime = performance.now()
	let retryCount = 0

	// Validate input if schema provided
	if (stepConfig.input) {
		const parsed = stepConfig.input.safeParse(rawInput)
		if (!parsed.success) {
			return {
				name: stepConfig.name,
				status: 'failed',
				error: `Input validation failed: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')}`,
				durationMs: Math.round(performance.now() - startTime),
				retryCount: 0,
			}
		}
	}

	const input = rawInput as TInput

	// Check condition
	if (stepConfig.condition && !stepConfig.condition(input, context)) {
		return {
			name: stepConfig.name,
			status: 'skipped',
			durationMs: Math.round(performance.now() - startTime),
			retryCount: 0,
		}
	}

	const retryConfig = stepConfig.retry
	const maxRetries = retryConfig?.maxRetries ?? 0

	while (true) {
		try {
			const result = await executeWithTimeout(
				() => stepConfig.handler(input, context),
				stepConfig.timeoutMs,
				stepConfig.name,
			)

			return {
				name: stepConfig.name,
				status: 'completed',
				data: result,
				durationMs: Math.round(performance.now() - startTime),
				retryCount,
			}
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error))

			if (retryCount < maxRetries && shouldRetryError(err, retryConfig)) {
				retryCount++
				const delay = calculateBackoff(retryCount, retryConfig)
				await sleep(delay)
				continue
			}

			// Try fallback
			if (stepConfig.fallback) {
				try {
					const fallbackResult = await stepConfig.fallback(err, input)
					return {
						name: stepConfig.name,
						status: 'completed',
						data: fallbackResult,
						durationMs: Math.round(performance.now() - startTime),
						retryCount,
					}
				} catch (fallbackError) {
					return {
						name: stepConfig.name,
						status: 'failed',
						error: `Fallback failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
						durationMs: Math.round(performance.now() - startTime),
						retryCount,
					}
				}
			}

			return {
				name: stepConfig.name,
				status: 'failed',
				error: err.message,
				durationMs: Math.round(performance.now() - startTime),
				retryCount,
			}
		}
	}
}

async function executeWithTimeout<T>(
	fn: () => Promise<T>,
	timeoutMs: number | undefined,
	stepName: string,
): Promise<T> {
	if (!timeoutMs) return fn()

	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), timeoutMs)

	try {
		return await Promise.race([
			fn(),
			new Promise<never>((_, reject) => {
				controller.signal.addEventListener('abort', () => {
					reject(ElsiumError.timeout(stepName, timeoutMs))
				})
			}),
		])
	} finally {
		clearTimeout(timer)
	}
}

function shouldRetryError(error: Error, config?: RetryConfig): boolean {
	if (!config) return false
	if (config.shouldRetry) return config.shouldRetry(error)
	if (error instanceof ElsiumError) return error.retryable
	return true
}

function calculateBackoff(attempt: number, config?: RetryConfig): number {
	const baseDelay = config?.baseDelayMs ?? 1000
	const maxDelay = config?.maxDelayMs ?? 30_000
	const delay = Math.min(baseDelay * 2 ** (attempt - 1), maxDelay)
	return delay * (0.5 + Math.random() * 0.5)
}
