import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { env, envBool, envNumber } from './config'
import { ElsiumError } from './errors'

describe('env', () => {
	const originalEnv = process.env

	beforeEach(() => {
		vi.stubGlobal('process', { env: {} })
	})

	afterEach(() => {
		vi.stubGlobal('process', { env: originalEnv })
	})

	it('returns the env var value when it exists', () => {
		vi.stubGlobal('process', { env: { MY_VAR: 'hello' } })
		expect(env('MY_VAR')).toBe('hello')
	})

	it('returns the fallback when the env var is not set and a fallback is provided', () => {
		vi.stubGlobal('process', { env: {} })
		expect(env('MISSING_VAR', 'default-value')).toBe('default-value')
	})

	it('throws ElsiumError with CONFIG_ERROR when the env var is missing and no fallback', () => {
		vi.stubGlobal('process', { env: {} })
		expect(() => env('MISSING_VAR')).toThrow(ElsiumError)
		expect(() => env('MISSING_VAR')).toThrow('Missing required environment variable: MISSING_VAR')
	})

	it('throws ElsiumError with code CONFIG_ERROR on missing required var', () => {
		vi.stubGlobal('process', { env: {} })
		try {
			env('MISSING_VAR')
			expect.fail('expected to throw')
		} catch (e) {
			expect(e).toBeInstanceOf(ElsiumError)
			expect((e as ElsiumError).code).toBe('CONFIG_ERROR')
			expect((e as ElsiumError).retryable).toBe(false)
			expect((e as ElsiumError).metadata).toEqual({ variable: 'MISSING_VAR' })
		}
	})

	it('treats the string "undefined" as a missing value and uses fallback', () => {
		vi.stubGlobal('process', { env: { UNDEF_VAR: 'undefined' } })
		expect(env('UNDEF_VAR', 'fallback')).toBe('fallback')
	})

	it('treats the string "undefined" as a missing value and throws without fallback', () => {
		vi.stubGlobal('process', { env: { UNDEF_VAR: 'undefined' } })
		expect(() => env('UNDEF_VAR')).toThrow(ElsiumError)
	})

	it('returns an empty string when env var is set to an empty string', () => {
		vi.stubGlobal('process', { env: { EMPTY_VAR: '' } })
		expect(env('EMPTY_VAR', 'fallback')).toBe('')
	})
})

describe('envNumber', () => {
	const originalEnv = process.env

	beforeEach(() => {
		vi.stubGlobal('process', { env: {} })
	})

	afterEach(() => {
		vi.stubGlobal('process', { env: originalEnv })
	})

	it('parses and returns a valid integer env var', () => {
		vi.stubGlobal('process', { env: { PORT: '8080' } })
		expect(envNumber('PORT')).toBe(8080)
	})

	it('parses and returns a valid float env var', () => {
		vi.stubGlobal('process', { env: { RATIO: '3.14' } })
		expect(envNumber('RATIO')).toBeCloseTo(3.14)
	})

	it('parses zero correctly', () => {
		vi.stubGlobal('process', { env: { ZERO: '0' } })
		expect(envNumber('ZERO')).toBe(0)
	})

	it('parses negative numbers correctly', () => {
		vi.stubGlobal('process', { env: { NEG: '-42' } })
		expect(envNumber('NEG')).toBe(-42)
	})

	it('returns the fallback when the env var is not set', () => {
		vi.stubGlobal('process', { env: {} })
		expect(envNumber('MISSING_NUM', 99)).toBe(99)
	})

	it('throws ElsiumError with CONFIG_ERROR when env var is missing and no fallback', () => {
		vi.stubGlobal('process', { env: {} })
		try {
			envNumber('MISSING_NUM')
			expect.fail('expected to throw')
		} catch (e) {
			expect(e).toBeInstanceOf(ElsiumError)
			expect((e as ElsiumError).code).toBe('CONFIG_ERROR')
			expect((e as ElsiumError).retryable).toBe(false)
		}
	})

	it('throws ElsiumError when the env var is not a valid number', () => {
		vi.stubGlobal('process', { env: { BAD_NUM: 'not-a-number' } })
		try {
			envNumber('BAD_NUM')
			expect.fail('expected to throw')
		} catch (e) {
			expect(e).toBeInstanceOf(ElsiumError)
			expect((e as ElsiumError).code).toBe('CONFIG_ERROR')
			expect((e as ElsiumError).message).toContain('not a valid finite number')
			expect((e as ElsiumError).retryable).toBe(false)
			expect((e as ElsiumError).metadata).toEqual({ variable: 'BAD_NUM', value: 'not-a-number' })
		}
	})

	it('throws ElsiumError when the env var is "Infinity"', () => {
		vi.stubGlobal('process', { env: { INF: 'Infinity' } })
		expect(() => envNumber('INF')).toThrow(ElsiumError)
	})

	it('throws ElsiumError when the env var is NaN string', () => {
		vi.stubGlobal('process', { env: { NAN: 'NaN' } })
		expect(() => envNumber('NAN')).toThrow(ElsiumError)
	})

	it('treats the string "undefined" as missing and uses fallback', () => {
		vi.stubGlobal('process', { env: { NUM: 'undefined' } })
		expect(envNumber('NUM', 5)).toBe(5)
	})
})

describe('envBool', () => {
	const originalEnv = process.env

	beforeEach(() => {
		vi.stubGlobal('process', { env: {} })
	})

	afterEach(() => {
		vi.stubGlobal('process', { env: originalEnv })
	})

	it('returns true for "true"', () => {
		vi.stubGlobal('process', { env: { FLAG: 'true' } })
		expect(envBool('FLAG')).toBe(true)
	})

	it('returns true for "1"', () => {
		vi.stubGlobal('process', { env: { FLAG: '1' } })
		expect(envBool('FLAG')).toBe(true)
	})

	it('returns true for "yes"', () => {
		vi.stubGlobal('process', { env: { FLAG: 'yes' } })
		expect(envBool('FLAG')).toBe(true)
	})

	it('returns true for "TRUE" (case-insensitive)', () => {
		vi.stubGlobal('process', { env: { FLAG: 'TRUE' } })
		expect(envBool('FLAG')).toBe(true)
	})

	it('returns true for "YES" (case-insensitive)', () => {
		vi.stubGlobal('process', { env: { FLAG: 'YES' } })
		expect(envBool('FLAG')).toBe(true)
	})

	it('returns false for "false"', () => {
		vi.stubGlobal('process', { env: { FLAG: 'false' } })
		expect(envBool('FLAG')).toBe(false)
	})

	it('returns false for "0"', () => {
		vi.stubGlobal('process', { env: { FLAG: '0' } })
		expect(envBool('FLAG')).toBe(false)
	})

	it('returns false for "no"', () => {
		vi.stubGlobal('process', { env: { FLAG: 'no' } })
		expect(envBool('FLAG')).toBe(false)
	})

	it('returns false for "FALSE" (case-insensitive)', () => {
		vi.stubGlobal('process', { env: { FLAG: 'FALSE' } })
		expect(envBool('FLAG')).toBe(false)
	})

	it('returns false for "NO" (case-insensitive)', () => {
		vi.stubGlobal('process', { env: { FLAG: 'NO' } })
		expect(envBool('FLAG')).toBe(false)
	})

	it('returns the fallback when the env var is not set', () => {
		vi.stubGlobal('process', { env: {} })
		expect(envBool('MISSING_BOOL', true)).toBe(true)
		expect(envBool('MISSING_BOOL', false)).toBe(false)
	})

	it('throws ElsiumError with CONFIG_ERROR when env var is missing and no fallback', () => {
		vi.stubGlobal('process', { env: {} })
		try {
			envBool('MISSING_BOOL')
			expect.fail('expected to throw')
		} catch (e) {
			expect(e).toBeInstanceOf(ElsiumError)
			expect((e as ElsiumError).code).toBe('CONFIG_ERROR')
			expect((e as ElsiumError).retryable).toBe(false)
		}
	})

	it('throws ElsiumError for an unrecognized boolean string', () => {
		vi.stubGlobal('process', { env: { FLAG: 'maybe' } })
		try {
			envBool('FLAG')
			expect.fail('expected to throw')
		} catch (e) {
			expect(e).toBeInstanceOf(ElsiumError)
			expect((e as ElsiumError).code).toBe('CONFIG_ERROR')
			expect((e as ElsiumError).message).toContain('unrecognized boolean value')
			expect((e as ElsiumError).retryable).toBe(false)
			expect((e as ElsiumError).metadata).toEqual({ variable: 'FLAG', value: 'maybe' })
		}
	})

	it('throws ElsiumError for arbitrary string like "enabled"', () => {
		vi.stubGlobal('process', { env: { FLAG: 'enabled' } })
		expect(() => envBool('FLAG')).toThrow(ElsiumError)
	})

	it('treats the string "undefined" as missing and uses fallback', () => {
		vi.stubGlobal('process', { env: { BOOL: 'undefined' } })
		expect(envBool('BOOL', false)).toBe(false)
	})
})
