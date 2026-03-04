import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { extractText, generateId, generateTraceId, retry, sleep } from './utils'

describe('generateId', () => {
	it('returns a string', () => {
		expect(typeof generateId()).toBe('string')
	})

	it('uses the default prefix "els"', () => {
		const id = generateId()
		expect(id.startsWith('els_')).toBe(true)
	})

	it('uses a custom prefix when provided', () => {
		const id = generateId('req')
		expect(id.startsWith('req_')).toBe(true)
	})

	it('contains a timestamp segment and a random hex segment', () => {
		const id = generateId('pfx')
		const parts = id.split('_')
		// format: pfx_<timestamp36>_<randomHex>
		expect(parts).toHaveLength(3)
		expect(parts[0]).toBe('pfx')
		expect(parts[1].length).toBeGreaterThan(0)
		expect(parts[2].length).toBe(8) // 4 bytes = 8 hex chars
	})

	it('generates unique ids on successive calls', () => {
		const ids = new Set(Array.from({ length: 100 }, () => generateId()))
		expect(ids.size).toBe(100)
	})
})

describe('generateTraceId', () => {
	it('returns a string', () => {
		expect(typeof generateTraceId()).toBe('string')
	})

	it('starts with "trc_"', () => {
		expect(generateTraceId().startsWith('trc_')).toBe(true)
	})

	it('has the expected structure: trc_<timestamp36>_<randomHex>', () => {
		const id = generateTraceId()
		const parts = id.split('_')
		expect(parts).toHaveLength(3)
		expect(parts[0]).toBe('trc')
		expect(parts[1].length).toBeGreaterThan(0)
		expect(parts[2].length).toBe(12) // 6 bytes = 12 hex chars
	})

	it('generates unique trace ids on successive calls', () => {
		const ids = new Set(Array.from({ length: 100 }, () => generateTraceId()))
		expect(ids.size).toBe(100)
	})
})

describe('extractText', () => {
	it('returns the string as-is when content is a string', () => {
		expect(extractText('hello world')).toBe('hello world')
	})

	it('returns an empty string for an empty string input', () => {
		expect(extractText('')).toBe('')
	})

	it('extracts and concatenates text parts from a ContentPart array', () => {
		const parts = [
			{ type: 'text', text: 'Hello, ' },
			{ type: 'text', text: 'world!' },
		]
		expect(extractText(parts)).toBe('Hello, world!')
	})

	it('ignores non-text parts', () => {
		const parts = [
			{ type: 'text', text: 'relevant' },
			{ type: 'image', url: 'http://example.com/img.png' },
			{ type: 'tool_use', id: 'tool-1' },
		]
		expect(extractText(parts)).toBe('relevant')
	})

	it('ignores text parts that have no text property', () => {
		const parts = [{ type: 'text' }, { type: 'text', text: 'present' }]
		expect(extractText(parts)).toBe('present')
	})

	it('returns an empty string for an empty array', () => {
		expect(extractText([])).toBe('')
	})

	it('returns an empty string when array has no text parts', () => {
		const parts = [{ type: 'image', url: 'http://example.com/img.png' }]
		expect(extractText(parts)).toBe('')
	})
})

describe('sleep', () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('resolves after the specified delay', async () => {
		let resolved = false
		const promise = sleep(1000).then(() => {
			resolved = true
		})

		expect(resolved).toBe(false)
		await vi.advanceTimersByTimeAsync(1000)
		await promise
		expect(resolved).toBe(true)
	})

	it('does not resolve before the delay has elapsed', async () => {
		let resolved = false
		sleep(500).then(() => {
			resolved = true
		})

		await vi.advanceTimersByTimeAsync(499)
		expect(resolved).toBe(false)
	})

	it('returns a Promise', () => {
		const result = sleep(0)
		expect(result).toBeInstanceOf(Promise)
		vi.advanceTimersByTime(0)
	})
})

describe('retry', () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('resolves immediately if the function succeeds on the first attempt', async () => {
		const fn = vi.fn().mockResolvedValue('result')
		const promise = retry(fn, { maxRetries: 3 })
		await vi.runAllTimersAsync()
		expect(await promise).toBe('result')
		expect(fn).toHaveBeenCalledTimes(1)
	})

	it('retries when shouldRetry returns true and eventually resolves', async () => {
		const fn = vi
			.fn()
			.mockRejectedValueOnce({ retryable: true })
			.mockRejectedValueOnce({ retryable: true })
			.mockResolvedValue('ok')

		const promise = retry(fn, { maxRetries: 3, baseDelayMs: 10 })
		await vi.runAllTimersAsync()
		expect(await promise).toBe('ok')
		expect(fn).toHaveBeenCalledTimes(3)
	})

	it('throws immediately when shouldRetry returns false', async () => {
		const error = { retryable: false, message: 'not retryable' }
		const fn = vi.fn().mockRejectedValue(error)

		const resultPromise = retry(fn, { maxRetries: 3 }).catch((e) => e)
		await vi.runAllTimersAsync()
		const result = await resultPromise
		expect(result).toBe(error)
		expect(fn).toHaveBeenCalledTimes(1)
	})

	it('throws after exhausting maxRetries', async () => {
		const error = { retryable: true, message: 'always fails' }
		const fn = vi.fn().mockRejectedValue(error)

		const resultPromise = retry(fn, { maxRetries: 2, baseDelayMs: 10 }).catch((e) => e)
		await vi.runAllTimersAsync()
		const result = await resultPromise
		expect(result).toBe(error)
		// initial attempt + 2 retries = 3 total calls
		expect(fn).toHaveBeenCalledTimes(3)
	})

	it('uses custom shouldRetry predicate', async () => {
		const error = new Error('custom retryable error')
		const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValue('custom ok')

		const promise = retry(fn, {
			maxRetries: 2,
			baseDelayMs: 10,
			shouldRetry: (e) => e instanceof Error && e.message === 'custom retryable error',
		})
		await vi.runAllTimersAsync()
		expect(await promise).toBe('custom ok')
		expect(fn).toHaveBeenCalledTimes(2)
	})

	it('respects retryAfterMs on the error object', async () => {
		const setTimeoutSpy = vi.spyOn(global, 'setTimeout')
		const error = { retryable: true, retryAfterMs: 5000 }
		const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValue('done')

		const promise = retry(fn, { maxRetries: 1, baseDelayMs: 100, maxDelayMs: 30000 })
		await vi.runAllTimersAsync()
		await promise

		// The delay used should be based on retryAfterMs (5000) with jitter applied,
		// so at least one setTimeout should have been called with a value >= 2500 (50% jitter lower bound).
		const delays = setTimeoutSpy.mock.calls.map((call) => call[1] as number)
		expect(delays.some((d) => d >= 2500)).toBe(true)
		setTimeoutSpy.mockRestore()
	})

	it('caps delay at maxDelayMs', async () => {
		const setTimeoutSpy = vi.spyOn(global, 'setTimeout')
		const error = { retryable: true }
		const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValue('capped')

		const promise = retry(fn, { maxRetries: 1, baseDelayMs: 100000, maxDelayMs: 500 })
		await vi.runAllTimersAsync()
		await promise

		// delay = min(100000 * 2^0, 500) = 500, with jitter: 500 * (0.5..1.0) = 250..500
		const delays = setTimeoutSpy.mock.calls.map((call) => call[1] as number)
		expect(delays.every((d) => d <= 500)).toBe(true)
		setTimeoutSpy.mockRestore()
	})

	it('uses default maxRetries of 3', async () => {
		const error = { retryable: true }
		const fn = vi.fn().mockRejectedValue(error)

		const resultPromise = retry(fn, { baseDelayMs: 1 }).catch((e) => e)
		await vi.runAllTimersAsync()
		const result = await resultPromise
		expect(result).toBe(error)
		// default maxRetries=3: 1 initial + 3 retries = 4 calls
		expect(fn).toHaveBeenCalledTimes(4)
	})
})
