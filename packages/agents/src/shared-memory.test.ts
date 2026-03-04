import { describe, expect, it } from 'vitest'
import { createSharedMemory } from './shared-memory'

describe('createSharedMemory — get/set', () => {
	it('returns undefined for a key that has never been set', () => {
		const mem = createSharedMemory()
		expect(mem.get('missing')).toBeUndefined()
	})

	it('stores and retrieves a primitive value', () => {
		const mem = createSharedMemory()
		mem.set('count', 42)
		expect(mem.get('count')).toBe(42)
	})

	it('stores and retrieves an object value', () => {
		const mem = createSharedMemory()
		const value = { output: 'hello', score: 0.9 }
		mem.set('result', value)
		expect(mem.get('result')).toEqual(value)
	})

	it('overwrites an existing key with a new value', () => {
		const mem = createSharedMemory()
		mem.set('key', 'first')
		mem.set('key', 'second')
		expect(mem.get('key')).toBe('second')
	})

	it('supports generic type parameter on get', () => {
		const mem = createSharedMemory()
		mem.set('typed', { output: 'result' })
		const entry = mem.get<{ output: string }>('typed')
		expect(entry?.output).toBe('result')
	})

	it('can store different value types under different keys simultaneously', () => {
		const mem = createSharedMemory()
		mem.set('str', 'hello')
		mem.set('num', 123)
		mem.set('obj', { x: true })
		expect(mem.get('str')).toBe('hello')
		expect(mem.get('num')).toBe(123)
		expect(mem.get('obj')).toEqual({ x: true })
	})
})

describe('createSharedMemory — getAll', () => {
	it('returns an empty object when no entries exist', () => {
		const mem = createSharedMemory()
		expect(mem.getAll()).toEqual({})
	})

	it('returns all stored key-value pairs', () => {
		const mem = createSharedMemory()
		mem.set('a', 1)
		mem.set('b', 2)
		mem.set('c', 3)
		expect(mem.getAll()).toEqual({ a: 1, b: 2, c: 3 })
	})

	it('returns a snapshot — mutations to the returned object do not affect the store', () => {
		const mem = createSharedMemory()
		mem.set('x', 10)
		const all = mem.getAll()
		all.x = 999
		expect(mem.get('x')).toBe(10)
	})
})

describe('createSharedMemory — clear', () => {
	it('removes all stored entries', () => {
		const mem = createSharedMemory()
		mem.set('a', 1)
		mem.set('b', 2)
		mem.clear()
		expect(mem.getAll()).toEqual({})
	})

	it('get returns undefined for previously set keys after clear', () => {
		const mem = createSharedMemory()
		mem.set('key', 'value')
		mem.clear()
		expect(mem.get('key')).toBeUndefined()
	})

	it('allows setting new values after clear', () => {
		const mem = createSharedMemory()
		mem.set('old', 'data')
		mem.clear()
		mem.set('new', 'fresh')
		expect(mem.get('new')).toBe('fresh')
		expect(mem.get('old')).toBeUndefined()
	})
})

describe('createSharedMemory — prototype pollution', () => {
	it('silently ignores __proto__ key', () => {
		const mem = createSharedMemory()
		mem.set('__proto__', { injected: true })
		expect(mem.get('__proto__')).toBeUndefined()
		expect(({} as Record<string, unknown>).injected).toBeUndefined()
	})

	it('silently ignores constructor key', () => {
		const mem = createSharedMemory()
		mem.set('constructor', 'evil')
		expect(mem.get('constructor')).toBeUndefined()
	})

	it('silently ignores prototype key', () => {
		const mem = createSharedMemory()
		mem.set('prototype', 'evil')
		expect(mem.get('prototype')).toBeUndefined()
	})

	it('does not include poisoned keys in getAll', () => {
		const mem = createSharedMemory()
		mem.set('__proto__', 'bad')
		mem.set('constructor', 'bad')
		mem.set('prototype', 'bad')
		mem.set('safe', 'good')
		expect(mem.getAll()).toEqual({ safe: 'good' })
	})
})
