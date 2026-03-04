import { describe, expect, it } from 'vitest'
import { err, isErr, isOk, ok, tryCatch, tryCatchSync, unwrap, unwrapOr } from './result'

describe('ok', () => {
	it('creates an Ok result with the given value', () => {
		const result = ok(42)
		expect(result.ok).toBe(true)
		expect(result.value).toBe(42)
	})

	it('works with string values', () => {
		const result = ok('hello')
		expect(result.ok).toBe(true)
		expect(result.value).toBe('hello')
	})

	it('works with object values', () => {
		const value = { name: 'test', count: 1 }
		const result = ok(value)
		expect(result.ok).toBe(true)
		expect(result.value).toBe(value)
	})

	it('works with null', () => {
		const result = ok(null)
		expect(result.ok).toBe(true)
		expect(result.value).toBeNull()
	})

	it('works with undefined', () => {
		const result = ok(undefined)
		expect(result.ok).toBe(true)
		expect(result.value).toBeUndefined()
	})
})

describe('err', () => {
	it('creates an Err result with the given error', () => {
		const error = new Error('something went wrong')
		const result = err(error)
		expect(result.ok).toBe(false)
		expect(result.error).toBe(error)
	})

	it('works with string errors', () => {
		const result = err('a string error')
		expect(result.ok).toBe(false)
		expect(result.error).toBe('a string error')
	})

	it('works with custom error objects', () => {
		const customError = { code: 'CUSTOM', message: 'oops' }
		const result = err(customError)
		expect(result.ok).toBe(false)
		expect(result.error).toBe(customError)
	})
})

describe('isOk', () => {
	it('returns true for an Ok result', () => {
		expect(isOk(ok(1))).toBe(true)
	})

	it('returns false for an Err result', () => {
		expect(isOk(err(new Error('fail')))).toBe(false)
	})

	it('narrows type to Ok when true', () => {
		const result = ok('value')
		if (isOk(result)) {
			expect(result.value).toBe('value')
		}
	})
})

describe('isErr', () => {
	it('returns true for an Err result', () => {
		expect(isErr(err(new Error('fail')))).toBe(true)
	})

	it('returns false for an Ok result', () => {
		expect(isErr(ok(1))).toBe(false)
	})

	it('narrows type to Err when true', () => {
		const error = new Error('bad')
		const result = err(error)
		if (isErr(result)) {
			expect(result.error).toBe(error)
		}
	})
})

describe('unwrap', () => {
	it('returns the value for an Ok result', () => {
		expect(unwrap(ok(99))).toBe(99)
	})

	it('throws the error for an Err result when error is an Error instance', () => {
		const error = new Error('unwrap failed')
		expect(() => unwrap(err(error))).toThrow(error)
	})

	it('wraps a non-Error error in a new Error when throwing', () => {
		const result = err('string error')
		expect(() => unwrap(result)).toThrow('string error')
	})

	it('wraps a numeric error in a new Error when throwing', () => {
		const result = err(404)
		expect(() => unwrap(result)).toThrow('404')
	})
})

describe('unwrapOr', () => {
	it('returns the value for an Ok result', () => {
		expect(unwrapOr(ok(10), 0)).toBe(10)
	})

	it('returns the fallback for an Err result', () => {
		expect(unwrapOr(err(new Error('fail')), 42)).toBe(42)
	})

	it('returns the fallback when the value is undefined and result is Err', () => {
		expect(unwrapOr(err('oops'), 'default')).toBe('default')
	})

	it('does not return the fallback when the Ok value is falsy (0)', () => {
		expect(unwrapOr(ok(0), 99)).toBe(0)
	})

	it('does not return the fallback when the Ok value is null', () => {
		expect(unwrapOr(ok(null), 'fallback')).toBeNull()
	})
})

describe('tryCatch', () => {
	it('returns Ok with the resolved value when the promise resolves', async () => {
		const result = await tryCatch(() => Promise.resolve('success'))
		expect(result.ok).toBe(true)
		expect(isOk(result) && result.value).toBe('success')
	})

	it('returns Err with the thrown Error when the promise rejects with an Error', async () => {
		const error = new Error('async failure')
		const result = await tryCatch(() => Promise.reject(error))
		expect(result.ok).toBe(false)
		expect(isErr(result) && result.error).toBe(error)
	})

	it('wraps a non-Error rejection in a new Error', async () => {
		const result = await tryCatch(() => Promise.reject('plain string'))
		expect(result.ok).toBe(false)
		if (isErr(result)) {
			expect(result.error).toBeInstanceOf(Error)
			expect(result.error.message).toBe('plain string')
		}
	})

	it('wraps a numeric rejection in a new Error', async () => {
		const result = await tryCatch(() => Promise.reject(500))
		expect(result.ok).toBe(false)
		if (isErr(result)) {
			expect(result.error).toBeInstanceOf(Error)
			expect(result.error.message).toBe('500')
		}
	})

	it('handles async functions that throw synchronously inside', async () => {
		const result = await tryCatch(async () => {
			throw new Error('sync throw inside async')
		})
		expect(result.ok).toBe(false)
		if (isErr(result)) {
			expect(result.error.message).toBe('sync throw inside async')
		}
	})
})

describe('tryCatchSync', () => {
	it('returns Ok with the value when the function succeeds', () => {
		const result = tryCatchSync(() => 42)
		expect(result.ok).toBe(true)
		expect(isOk(result) && result.value).toBe(42)
	})

	it('returns Err with the thrown Error when the function throws an Error', () => {
		const error = new Error('sync failure')
		const result = tryCatchSync(() => {
			throw error
		})
		expect(result.ok).toBe(false)
		expect(isErr(result) && result.error).toBe(error)
	})

	it('wraps a non-Error thrown value in a new Error', () => {
		const result = tryCatchSync(() => {
			throw 'thrown string'
		})
		expect(result.ok).toBe(false)
		if (isErr(result)) {
			expect(result.error).toBeInstanceOf(Error)
			expect(result.error.message).toBe('thrown string')
		}
	})

	it('works with functions returning objects', () => {
		const value = { a: 1, b: 2 }
		const result = tryCatchSync(() => value)
		expect(isOk(result) && result.value).toBe(value)
	})
})
