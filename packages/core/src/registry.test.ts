import { describe, expect, it } from 'vitest'
import { createRegistry } from './index'

// ─── createRegistry ─────────────────────────────────────────────

describe('createRegistry', () => {
	it('registers and retrieves an item', () => {
		const registry = createRegistry<() => string>('test')
		const factory = () => 'hello'

		registry.register('greeting', factory)
		expect(registry.get('greeting')).toBe(factory)
	})

	it('returns undefined for unknown keys', () => {
		const registry = createRegistry<string>('test')
		expect(registry.get('nonexistent')).toBeUndefined()
	})

	it('lists registered keys', () => {
		const registry = createRegistry<number>('test')

		registry.register('a', 1)
		registry.register('b', 2)
		registry.register('c', 3)

		const keys = registry.list()
		expect(keys).toEqual(['a', 'b', 'c'])
	})

	it('returns empty list when nothing is registered', () => {
		const registry = createRegistry<number>('test')
		expect(registry.list()).toEqual([])
	})

	it('has() returns true for registered keys', () => {
		const registry = createRegistry<string>('test')
		registry.register('key1', 'value')

		expect(registry.has('key1')).toBe(true)
		expect(registry.has('key2')).toBe(false)
	})

	it('unregisters an existing key', () => {
		const registry = createRegistry<string>('test')
		registry.register('key1', 'value')

		expect(registry.has('key1')).toBe(true)

		const deleted = registry.unregister('key1')
		expect(deleted).toBe(true)
		expect(registry.has('key1')).toBe(false)
		expect(registry.get('key1')).toBeUndefined()
	})

	it('unregister returns false for unknown keys', () => {
		const registry = createRegistry<string>('test')
		expect(registry.unregister('nonexistent')).toBe(false)
	})

	it('overwrites value on duplicate register', () => {
		const registry = createRegistry<string>('test')
		registry.register('key', 'first')
		registry.register('key', 'second')

		expect(registry.get('key')).toBe('second')
	})

	describe('prototype pollution guard', () => {
		it('rejects __proto__ on register', () => {
			const registry = createRegistry<string>('test')
			registry.register('__proto__', 'malicious')

			expect(registry.has('__proto__')).toBe(false)
			expect(registry.get('__proto__')).toBeUndefined()
			expect(registry.list()).toEqual([])
		})

		it('rejects constructor on register', () => {
			const registry = createRegistry<string>('test')
			registry.register('constructor', 'malicious')

			expect(registry.has('constructor')).toBe(false)
			expect(registry.get('constructor')).toBeUndefined()
		})

		it('rejects prototype on register', () => {
			const registry = createRegistry<string>('test')
			registry.register('prototype', 'malicious')

			expect(registry.has('prototype')).toBe(false)
			expect(registry.get('prototype')).toBeUndefined()
		})

		it('returns false for unregister of blocked keys', () => {
			const registry = createRegistry<string>('test')
			expect(registry.unregister('__proto__')).toBe(false)
			expect(registry.unregister('constructor')).toBe(false)
			expect(registry.unregister('prototype')).toBe(false)
		})
	})
})
