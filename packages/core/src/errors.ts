export type ErrorCode =
	| 'PROVIDER_ERROR'
	| 'RATE_LIMIT'
	| 'AUTH_ERROR'
	| 'INVALID_REQUEST'
	| 'TIMEOUT'
	| 'NETWORK_ERROR'
	| 'PARSE_ERROR'
	| 'VALIDATION_ERROR'
	| 'TOOL_ERROR'
	| 'BUDGET_EXCEEDED'
	| 'MAX_ITERATIONS'
	| 'STREAM_ERROR'
	| 'CONFIG_ERROR'
	| 'UNKNOWN'

export interface ErrorDetails {
	code: ErrorCode
	message: string
	provider?: string
	model?: string
	statusCode?: number
	retryable: boolean
	retryAfterMs?: number
	cause?: Error
	metadata?: Record<string, unknown>
}

export class ElsiumError extends Error {
	readonly code: ErrorCode
	readonly provider?: string
	readonly model?: string
	readonly statusCode?: number
	readonly retryable: boolean
	readonly retryAfterMs?: number
	readonly cause?: Error
	readonly metadata?: Record<string, unknown>

	constructor(details: ErrorDetails) {
		super(details.message)
		this.name = 'ElsiumError'
		this.code = details.code
		this.provider = details.provider
		this.model = details.model
		this.statusCode = details.statusCode
		this.retryable = details.retryable
		this.retryAfterMs = details.retryAfterMs
		this.cause = details.cause
		this.metadata = details.metadata
	}

	toJSON(): Record<string, unknown> {
		return {
			name: this.name,
			code: this.code,
			message: this.message,
			provider: this.provider,
			model: this.model,
			statusCode: this.statusCode,
			retryable: this.retryable,
			retryAfterMs: this.retryAfterMs,
			metadata: this.metadata,
		}
	}

	static providerError(
		message: string,
		opts: { provider: string; statusCode?: number; retryable?: boolean; cause?: Error },
	): ElsiumError {
		return new ElsiumError({
			code: 'PROVIDER_ERROR',
			message,
			provider: opts.provider,
			statusCode: opts.statusCode,
			retryable: opts.retryable ?? false,
			cause: opts.cause,
		})
	}

	static rateLimit(provider: string, retryAfterMs?: number): ElsiumError {
		return new ElsiumError({
			code: 'RATE_LIMIT',
			message: `Rate limited by ${provider}`,
			provider,
			statusCode: 429,
			retryable: true,
			retryAfterMs,
		})
	}

	static authError(provider: string): ElsiumError {
		return new ElsiumError({
			code: 'AUTH_ERROR',
			message: `Authentication failed for ${provider}. Check your API key.`,
			provider,
			statusCode: 401,
			retryable: false,
		})
	}

	static timeout(provider: string, timeoutMs: number): ElsiumError {
		return new ElsiumError({
			code: 'TIMEOUT',
			message: `Request to ${provider} timed out after ${timeoutMs}ms`,
			provider,
			retryable: true,
		})
	}

	static validation(message: string, metadata?: Record<string, unknown>): ElsiumError {
		return new ElsiumError({
			code: 'VALIDATION_ERROR',
			message,
			retryable: false,
			metadata,
		})
	}

	static budgetExceeded(spent: number, budget: number): ElsiumError {
		return new ElsiumError({
			code: 'BUDGET_EXCEEDED',
			message: `Token budget exceeded: spent ${spent}, budget ${budget}`,
			retryable: false,
			metadata: { spent, budget },
		})
	}
}
