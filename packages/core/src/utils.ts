import { randomBytes } from 'node:crypto'
function cryptoHex(bytes: number): string {
	return randomBytes(bytes).toString('hex')
}

export function generateId(prefix = 'els'): string {
	const timestamp = Date.now().toString(36)
	const random = cryptoHex(4)
	return `${prefix}_${timestamp}_${random}`
}

// Counter scoped to each call site via cryptoHex for uniqueness.
// No global counter needed — timestamp + random provides sufficient uniqueness.
export function generateTraceId(): string {
	const timestamp = Date.now().toString(36)
	const random = cryptoHex(6)
	return `trc_${timestamp}_${random}`
}

export function extractText(content: string | { type: string; text?: string }[]): string {
	if (typeof content === 'string') return content
	return content
		.filter((part) => part.type === 'text' && part.text)
		.map((part) => (part as { text: string }).text)
		.join('')
}

export async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

function getRetryDelay(
	error: unknown,
	attempt: number,
	baseDelayMs: number,
	maxDelayMs: number,
): number {
	if (
		error &&
		typeof error === 'object' &&
		'retryAfterMs' in error &&
		typeof (error as { retryAfterMs: number }).retryAfterMs === 'number'
	) {
		return (error as { retryAfterMs: number }).retryAfterMs
	}
	return Math.min(baseDelayMs * 2 ** attempt, maxDelayMs)
}

export function retry<T>(
	fn: () => Promise<T>,
	options: {
		maxRetries?: number
		baseDelayMs?: number
		maxDelayMs?: number
		shouldRetry?: (error: unknown) => boolean
	} = {},
): Promise<T> {
	const {
		maxRetries = 3,
		baseDelayMs = 1000,
		maxDelayMs = 30000,
		shouldRetry = (error: unknown) => {
			if (error && typeof error === 'object' && 'retryable' in error) {
				return (error as { retryable: boolean }).retryable === true
			}
			return false
		},
	} = options

	return (async () => {
		let lastError: unknown
		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				return await fn()
			} catch (error) {
				lastError = error
				if (attempt === maxRetries || !shouldRetry(error)) {
					throw error
				}
				const delay = getRetryDelay(error, attempt, baseDelayMs, maxDelayMs)
				const jitter = delay * (0.5 + Math.random() * 0.5)
				await sleep(jitter)
			}
		}
		throw lastError
	})()
}
