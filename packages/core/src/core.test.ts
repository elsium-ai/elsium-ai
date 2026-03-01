import { describe, expect, it, vi } from 'vitest'
import {
	ElsiumError,
	ElsiumStream,
	createLogger,
	createStream,
	env,
	envBool,
	envNumber,
	err,
	extractText,
	generateId,
	generateTraceId,
	isErr,
	isOk,
	ok,
	retry,
	tryCatch,
	tryCatchSync,
	unwrap,
	unwrapOr,
} from './index'

// ─── ElsiumError ─────────────────────────────────────────────────

describe('ElsiumError', () => {
	it('creates error with all details', () => {
		const error = new ElsiumError({
			code: 'PROVIDER_ERROR',
			message: 'Something went wrong',
			provider: 'anthropic',
			statusCode: 500,
			retryable: true,
		})

		expect(error.code).toBe('PROVIDER_ERROR')
		expect(error.message).toBe('Something went wrong')
		expect(error.provider).toBe('anthropic')
		expect(error.statusCode).toBe(500)
		expect(error.retryable).toBe(true)
		expect(error.name).toBe('ElsiumError')
	})

	it('serializes to JSON', () => {
		const error = ElsiumError.rateLimit('openai', 5000)
		const json = error.toJSON()

		expect(json.code).toBe('RATE_LIMIT')
		expect(json.provider).toBe('openai')
		expect(json.retryable).toBe(true)
		expect(json.retryAfterMs).toBe(5000)
	})

	it('creates static factory errors', () => {
		expect(ElsiumError.authError('anthropic').code).toBe('AUTH_ERROR')
		expect(ElsiumError.timeout('openai', 30000).code).toBe('TIMEOUT')
		expect(ElsiumError.validation('bad input').code).toBe('VALIDATION_ERROR')
		expect(ElsiumError.budgetExceeded(1000, 500).code).toBe('BUDGET_EXCEEDED')
	})
})

// ─── Result ──────────────────────────────────────────────────────

describe('Result', () => {
	it('creates Ok result', () => {
		const result = ok(42)
		expect(isOk(result)).toBe(true)
		expect(isErr(result)).toBe(false)
		expect(unwrap(result)).toBe(42)
	})

	it('creates Err result', () => {
		const result = err(new Error('fail'))
		expect(isOk(result)).toBe(false)
		expect(isErr(result)).toBe(true)
		expect(() => unwrap(result)).toThrow('fail')
	})

	it('unwrapOr returns fallback on error', () => {
		expect(unwrapOr(ok(42), 0)).toBe(42)
		expect(unwrapOr(err(new Error('fail')), 0)).toBe(0)
	})

	it('tryCatch catches async errors', async () => {
		const result = await tryCatch(async () => {
			throw new Error('async fail')
		})
		expect(isErr(result)).toBe(true)
		if (!result.ok) {
			expect(result.error.message).toBe('async fail')
		}
	})

	it('tryCatchSync catches sync errors', () => {
		const result = tryCatchSync(() => {
			throw new Error('sync fail')
		})
		expect(isErr(result)).toBe(true)
	})

	it('tryCatch returns Ok on success', async () => {
		const result = await tryCatch(async () => 42)
		expect(isOk(result)).toBe(true)
		if (result.ok) {
			expect(result.value).toBe(42)
		}
	})
})

// ─── Logger ──────────────────────────────────────────────────────

describe('Logger', () => {
	it('logs at correct levels', () => {
		const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
		const logger = createLogger({ level: 'info' })

		logger.info('hello')
		expect(spy).toHaveBeenCalledOnce()

		spy.mockRestore()
	})

	it('filters below minimum level', () => {
		const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
		const logger = createLogger({ level: 'warn' })

		logger.debug('should not appear')
		logger.info('should not appear')
		expect(spy).not.toHaveBeenCalled()

		spy.mockRestore()
	})

	it('creates child logger with context', () => {
		const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
		const logger = createLogger({ level: 'info' })
		const child = logger.child({ traceId: 'abc' })

		child.info('test')
		expect(spy).toHaveBeenCalledOnce()
		const logged = JSON.parse(spy.mock.calls[0][0] as string)
		expect(logged.traceId).toBe('abc')

		spy.mockRestore()
	})
})

// ─── Utils ───────────────────────────────────────────────────────

describe('Utils', () => {
	it('generates unique IDs', () => {
		const id1 = generateId()
		const id2 = generateId()
		expect(id1).not.toBe(id2)
		expect(id1.startsWith('els_')).toBe(true)
	})

	it('generates trace IDs', () => {
		const traceId = generateTraceId()
		expect(traceId.startsWith('trc_')).toBe(true)
	})

	it('generates IDs with custom prefix', () => {
		const id = generateId('msg')
		expect(id.startsWith('msg_')).toBe(true)
	})

	it('extracts text from string content', () => {
		expect(extractText('hello')).toBe('hello')
	})

	it('extracts text from content parts', () => {
		const parts = [
			{ type: 'text' as const, text: 'hello ' },
			{ type: 'image' as const },
			{ type: 'text' as const, text: 'world' },
		]
		expect(extractText(parts)).toBe('hello world')
	})

	it('retries on failure', async () => {
		let attempts = 0
		const result = await retry(
			async () => {
				attempts++
				if (attempts < 3) throw new Error('fail')
				return 'success'
			},
			{ maxRetries: 3, baseDelayMs: 10, shouldRetry: () => true },
		)
		expect(result).toBe('success')
		expect(attempts).toBe(3)
	})

	it('respects retryAfterMs on error', async () => {
		let attempts = 0
		const startTime = Date.now()
		const result = await retry(
			async () => {
				attempts++
				if (attempts < 2) {
					const error = new Error('rate limited') as Error & { retryAfterMs: number }
					error.retryAfterMs = 50
					throw error
				}
				return 'success'
			},
			{ maxRetries: 3, baseDelayMs: 1000, shouldRetry: () => true },
		)
		const elapsed = Date.now() - startTime
		expect(result).toBe('success')
		expect(attempts).toBe(2)
		// The delay should be based on retryAfterMs (50ms) not baseDelayMs (1000ms)
		expect(elapsed).toBeLessThan(500)
	})

	it('stops retrying when shouldRetry returns false', async () => {
		let attempts = 0
		await expect(
			retry(
				async () => {
					attempts++
					throw new Error('permanent')
				},
				{
					maxRetries: 5,
					baseDelayMs: 10,
					shouldRetry: () => false,
				},
			),
		).rejects.toThrow('permanent')
		expect(attempts).toBe(1)
	})
})

// ─── Config ──────────────────────────────────────────────────────

describe('Config', () => {
	it('reads environment variables', () => {
		process.env.TEST_VAR = 'hello'
		expect(env('TEST_VAR')).toBe('hello')
		process.env.TEST_VAR = undefined
	})

	it('uses fallback when env var missing', () => {
		expect(env('MISSING_VAR', 'default')).toBe('default')
	})

	it('throws on missing required env var', () => {
		expect(() => env('MISSING_VAR')).toThrow('Missing required environment variable')
	})

	it('parses number env vars', () => {
		process.env.TEST_NUM = '42'
		expect(envNumber('TEST_NUM')).toBe(42)
		process.env.TEST_NUM = undefined
	})

	it('throws on invalid number env var', () => {
		process.env.TEST_NUM = 'not_a_number'
		expect(() => envNumber('TEST_NUM')).toThrow('not a valid finite number')
		process.env.TEST_NUM = undefined
	})

	it('parses boolean env vars', () => {
		process.env.TEST_BOOL = 'true'
		expect(envBool('TEST_BOOL')).toBe(true)
		process.env.TEST_BOOL = '0'
		expect(envBool('TEST_BOOL')).toBe(false)
		process.env.TEST_BOOL = undefined
	})

	it('envNumber returns fallback when env var is missing', () => {
		process.env.MISSING_NUM_VAR = undefined
		expect(envNumber('MISSING_NUM_VAR', 99)).toBe(99)
	})

	it('envNumber throws when env var is missing and no fallback', () => {
		process.env.MISSING_NUM_VAR = undefined
		expect(() => envNumber('MISSING_NUM_VAR')).toThrow('Missing required environment variable')
	})

	it('envBool returns fallback when env var is missing', () => {
		process.env.MISSING_BOOL_VAR = undefined
		expect(envBool('MISSING_BOOL_VAR', true)).toBe(true)
		expect(envBool('MISSING_BOOL_VAR', false)).toBe(false)
	})

	it('envBool throws when env var is missing and no fallback', () => {
		process.env.MISSING_BOOL_VAR = undefined
		expect(() => envBool('MISSING_BOOL_VAR')).toThrow('Missing required environment variable')
	})

	it('envBool recognizes "1" and "yes" as true', () => {
		process.env.TEST_BOOL_1 = '1'
		expect(envBool('TEST_BOOL_1')).toBe(true)
		process.env.TEST_BOOL_1 = 'yes'
		expect(envBool('TEST_BOOL_1')).toBe(true)
		process.env.TEST_BOOL_1 = 'no'
		expect(envBool('TEST_BOOL_1')).toBe(false)
		process.env.TEST_BOOL_1 = 'false'
		expect(envBool('TEST_BOOL_1')).toBe(false)
		process.env.TEST_BOOL_1 = undefined
	})
})

// ─── Stream ──────────────────────────────────────────────────────

describe('ElsiumStream', () => {
	it('collects text from stream', async () => {
		const stream = createStream(async (emit) => {
			emit({ type: 'message_start', id: 'msg_1', model: 'test' })
			emit({ type: 'text_delta', text: 'Hello' })
			emit({ type: 'text_delta', text: ' World' })
			emit({
				type: 'message_end',
				usage: {
					inputTokens: 10,
					outputTokens: 5,
					totalTokens: 15,
				},
				stopReason: 'end_turn',
			})
		})

		const text = await stream.toText()
		expect(text).toBe('Hello World')
	})

	it('collects full response from stream', async () => {
		const stream = createStream(async (emit) => {
			emit({ type: 'message_start', id: 'msg_1', model: 'test' })
			emit({ type: 'text_delta', text: 'Hi' })
			emit({
				type: 'message_end',
				usage: {
					inputTokens: 10,
					outputTokens: 2,
					totalTokens: 12,
				},
				stopReason: 'end_turn',
			})
		})

		const response = await stream.toResponse()
		expect(response.text).toBe('Hi')
		expect(response.usage?.totalTokens).toBe(12)
		expect(response.stopReason).toBe('end_turn')
	})

	it('iterates text chunks', async () => {
		const stream = createStream(async (emit) => {
			emit({ type: 'text_delta', text: 'A' })
			emit({ type: 'text_delta', text: 'B' })
		})

		const chunks: string[] = []
		for await (const chunk of stream.text()) {
			chunks.push(chunk)
		}
		expect(chunks).toEqual(['A', 'B'])
	})

	it('toResponse returns null usage/stopReason when no message_end', async () => {
		const stream = createStream(async (emit) => {
			emit({ type: 'text_delta', text: 'Only text' })
		})

		const response = await stream.toResponse()
		expect(response.text).toBe('Only text')
		expect(response.usage).toBeNull()
		expect(response.stopReason).toBeNull()
	})

	it('pipe transforms stream events', async () => {
		const stream = createStream(async (emit) => {
			emit({ type: 'text_delta', text: 'hello' })
			emit({ type: 'text_delta', text: ' world' })
		})

		const uppercased = stream.pipe((source) => ({
			async *[Symbol.asyncIterator]() {
				for await (const event of source) {
					if (event.type === 'text_delta') {
						yield { ...event, text: event.text.toUpperCase() }
					} else {
						yield event
					}
				}
			},
		}))

		const text = await uppercased.toText()
		expect(text).toBe('HELLO WORLD')
	})

	it('pipe returns a new ElsiumStream', async () => {
		const stream = createStream(async (emit) => {
			emit({ type: 'text_delta', text: 'test' })
		})

		const piped = stream.pipe((source) => source)
		expect(piped).toBeInstanceOf(ElsiumStream)

		const text = await piped.toText()
		expect(text).toBe('test')
	})
})

// ─── ElsiumError providerError + toJSON ──────────────────────────

describe('ElsiumError.providerError', () => {
	it('creates provider error with all fields', () => {
		const cause = new Error('network issue')
		const error = ElsiumError.providerError('Request failed', {
			provider: 'openai',
			statusCode: 500,
			retryable: true,
			cause,
		})

		expect(error.code).toBe('PROVIDER_ERROR')
		expect(error.message).toBe('Request failed')
		expect(error.provider).toBe('openai')
		expect(error.statusCode).toBe(500)
		expect(error.retryable).toBe(true)
		expect(error.cause).toBe(cause)
	})

	it('toJSON includes all serializable fields', () => {
		const error = ElsiumError.providerError('Request failed', {
			provider: 'anthropic',
			statusCode: 503,
			retryable: true,
		})

		const json = error.toJSON()
		expect(json.name).toBe('ElsiumError')
		expect(json.code).toBe('PROVIDER_ERROR')
		expect(json.message).toBe('Request failed')
		expect(json.provider).toBe('anthropic')
		expect(json.statusCode).toBe(503)
		expect(json.retryable).toBe(true)
	})

	it('toJSON includes metadata when present', () => {
		const error = ElsiumError.budgetExceeded(1000, 500)
		const json = error.toJSON()

		expect(json.metadata).toEqual({ spent: 1000, budget: 500 })
	})

	it('toJSON handles undefined optional fields', () => {
		const error = new ElsiumError({
			code: 'UNKNOWN',
			message: 'minimal error',
			retryable: false,
		})

		const json = error.toJSON()
		expect(json.provider).toBeUndefined()
		expect(json.model).toBeUndefined()
		expect(json.statusCode).toBeUndefined()
		expect(json.retryAfterMs).toBeUndefined()
		expect(json.metadata).toBeUndefined()
	})
})

// ─── Logger child() ──────────────────────────────────────────────

describe('Logger child()', () => {
	it('child logger inherits parent level', () => {
		const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
		const parent = createLogger({ level: 'warn' })
		const child = parent.child({ service: 'test' })

		child.info('should not appear')
		expect(spy).not.toHaveBeenCalled()

		spy.mockRestore()
	})

	it('child logger merges context', () => {
		const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
		const parent = createLogger({ level: 'info', context: { app: 'elsium' } })
		const child = parent.child({ service: 'gateway', traceId: 'trc_123' })

		child.info('test message')

		expect(spy).toHaveBeenCalledOnce()
		const logged = JSON.parse(spy.mock.calls[0][0] as string)
		expect(logged.app).toBe('elsium')
		expect(logged.service).toBe('gateway')
		expect(logged.traceId).toBe('trc_123')

		spy.mockRestore()
	})

	it('child logger uses warn via console.warn', () => {
		const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
		const logger = createLogger({ level: 'info' })
		const child = logger.child({ module: 'test' })

		child.warn('warning message')
		expect(spy).toHaveBeenCalledOnce()

		spy.mockRestore()
	})

	it('child logger uses error via console.error', () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
		const logger = createLogger({ level: 'info' })
		const child = logger.child({ module: 'test' })

		child.error('error message')
		expect(spy).toHaveBeenCalledOnce()

		spy.mockRestore()
	})
})
