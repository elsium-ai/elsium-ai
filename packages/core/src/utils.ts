let traceCounter = 0

export function generateId(prefix = 'els'): string {
	const timestamp = Date.now().toString(36)
	const random = Math.random().toString(36).substring(2, 8)
	return `${prefix}_${timestamp}_${random}`
}

export function generateTraceId(): string {
	traceCounter++
	const timestamp = Date.now().toString(36)
	const counter = traceCounter.toString(36).padStart(4, '0')
	const random = Math.random().toString(36).substring(2, 6)
	return `trc_${timestamp}_${counter}_${random}`
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
		shouldRetry = () => true,
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
				const delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs)
				const jitter = delay * (0.5 + Math.random() * 0.5)
				await sleep(jitter)
			}
		}
		throw lastError
	})()
}
