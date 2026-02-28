import { describe, expect, it } from 'vitest'
import { createPinStore, pinOutput } from './pinning'

describe('PinStore', () => {
	it('stores and retrieves pins', () => {
		const store = createPinStore()
		const pin = {
			promptHash: 'abc',
			configHash: 'def',
			outputHash: 'ghi',
			outputText: 'hello',
			createdAt: Date.now(),
		}

		store.set('key1', pin)
		expect(store.get('key1')).toEqual(pin)
	})

	it('deletes pins', () => {
		const store = createPinStore()
		store.set('key1', {
			promptHash: 'a',
			configHash: 'b',
			outputHash: 'c',
			outputText: 'test',
			createdAt: Date.now(),
		})

		expect(store.delete('key1')).toBe(true)
		expect(store.get('key1')).toBeUndefined()
	})

	it('returns all pins', () => {
		const store = createPinStore()
		store.set('k1', {
			promptHash: 'a',
			configHash: 'b',
			outputHash: 'c',
			outputText: 't1',
			createdAt: 1,
		})
		store.set('k2', {
			promptHash: 'd',
			configHash: 'e',
			outputHash: 'f',
			outputText: 't2',
			createdAt: 2,
		})

		expect(store.getAll()).toHaveLength(2)
	})

	it('serializes to JSON', () => {
		const store = createPinStore()
		store.set('k1', {
			promptHash: 'a',
			configHash: 'b',
			outputHash: 'c',
			outputText: 't',
			createdAt: 1,
		})

		const json = store.toJSON()
		expect(JSON.parse(json)).toHaveLength(1)
	})

	it('initializes from existing pins', () => {
		const pins = [
			{ promptHash: 'a', configHash: 'b', outputHash: 'c', outputText: 'test', createdAt: 1 },
		]
		const store = createPinStore(pins)
		expect(store.getAll()).toHaveLength(1)
	})
})

describe('pinOutput', () => {
	it('creates new pin for first run', async () => {
		const store = createPinStore()

		const result = await pinOutput('test-pin', store, async () => 'hello world', {
			prompt: 'Say hello',
			model: 'gpt-4o',
		})

		expect(result.status).toBe('new')
		expect(result.pin.outputText).toBe('hello world')
		expect(result.pin.outputHash).toBeTruthy()
	})

	it('returns match for same output', async () => {
		const store = createPinStore()

		await pinOutput('test', store, async () => 'hello', { prompt: 'test' })
		const result = await pinOutput('test', store, async () => 'hello', { prompt: 'test' })

		expect(result.status).toBe('match')
		expect(result.previousPin).toBeDefined()
	})

	it('detects mismatch for different output', async () => {
		const store = createPinStore()

		await pinOutput('test', store, async () => 'hello', { prompt: 'test' })
		const result = await pinOutput('test', store, async () => 'goodbye', { prompt: 'test' })

		expect(result.status).toBe('mismatch')
		expect(result.previousPin?.outputText).toBe('hello')
		expect(result.pin.outputText).toBe('goodbye')
	})

	it('throws on mismatch when assert is true', async () => {
		const store = createPinStore()

		await pinOutput('test', store, async () => 'hello', { prompt: 'test' })

		await expect(
			pinOutput('test', store, async () => 'goodbye', { prompt: 'test' }, { assert: true }),
		).rejects.toThrow('Pin mismatch')
	})

	it('different configs produce different pins', async () => {
		const store = createPinStore()

		const r1 = await pinOutput('t1', store, async () => 'a', { prompt: 'test', temperature: 0 })
		const r2 = await pinOutput('t2', store, async () => 'b', { prompt: 'test', temperature: 1 })

		expect(r1.pin.configHash).not.toBe(r2.pin.configHash)
	})
})
