import { describe, expect, it } from 'vitest'
import { ElsiumError } from '../errors'
import { createKeyRegistry } from './key-registry'
import { generateEd25519KeyPair } from './signer'

describe('createKeyRegistry', () => {
	it('adds and retrieves a trusted key', () => {
		const pair = generateEd25519KeyPair()
		const reg = createKeyRegistry()
		const entry = reg.add('k1', pair.publicKey, { label: 'main signing key' })

		expect(entry.keyId).toBe('k1')
		expect(entry.fingerprint).toBe(pair.fingerprint)
		expect(entry.label).toBe('main signing key')
		expect(reg.get('k1')?.fingerprint).toBe(pair.fingerprint)
	})

	it('seeds from trustRoots in config', () => {
		const pair = generateEd25519KeyPair()
		const reg = createKeyRegistry({
			trustRoots: [{ keyId: 'root', publicKey: pair.publicKey, label: 'root' }],
		})
		expect(reg.get('root')?.label).toBe('root')
		expect(reg.resolve('root')?.asymmetricKeyType).toBe('ed25519')
	})

	it('rejects re-adding the same keyId', () => {
		const pair = generateEd25519KeyPair()
		const reg = createKeyRegistry()
		reg.add('k1', pair.publicKey)
		expect(() => reg.add('k1', pair.publicKey)).toThrow(/already registered/)
	})

	it('rejects prototype pollution keyIds', () => {
		const pair = generateEd25519KeyPair()
		const reg = createKeyRegistry()
		expect(() => reg.add('__proto__', pair.publicKey)).toThrow(ElsiumError)
		expect(() => reg.add('constructor', pair.publicKey)).toThrow(ElsiumError)
		expect(() => reg.add('prototype', pair.publicKey)).toThrow(ElsiumError)
	})

	it('rejects empty keyIds', () => {
		const pair = generateEd25519KeyPair()
		const reg = createKeyRegistry()
		expect(() => reg.add('', pair.publicKey)).toThrow(/non-empty/)
		expect(() => reg.add('   ', pair.publicKey)).toThrow(/non-empty/)
	})

	it('removes a key', () => {
		const pair = generateEd25519KeyPair()
		const reg = createKeyRegistry()
		reg.add('k1', pair.publicKey)
		expect(reg.remove('k1')).toBe(true)
		expect(reg.get('k1')).toBeUndefined()
		expect(reg.remove('k1')).toBe(false)
	})

	it('lists all registered keys', () => {
		const a = generateEd25519KeyPair()
		const b = generateEd25519KeyPair()
		const reg = createKeyRegistry()
		reg.add('a', a.publicKey)
		reg.add('b', b.publicKey)
		const list = reg.list()
		expect(list).toHaveLength(2)
		expect(list.map((k) => k.keyId).sort()).toEqual(['a', 'b'])
	})

	it('honors notBefore validity window', () => {
		const pair = generateEd25519KeyPair()
		let now = 1000
		const reg = createKeyRegistry({ clock: () => now })
		reg.add('k1', pair.publicKey, { notBefore: 2000 })

		expect(reg.isValid('k1')).toBe(false)
		expect(reg.resolve('k1')).toBeUndefined()

		now = 2500
		expect(reg.isValid('k1')).toBe(true)
		expect(reg.resolve('k1')).toBeDefined()
	})

	it('honors notAfter validity window', () => {
		const pair = generateEd25519KeyPair()
		let now = 1000
		const reg = createKeyRegistry({ clock: () => now })
		reg.add('k1', pair.publicKey, { notAfter: 2000 })

		expect(reg.isValid('k1')).toBe(true)
		now = 2000
		expect(reg.isValid('k1')).toBe(false)
		expect(reg.resolve('k1')).toBeUndefined()
	})

	it('rejects invalid validity windows', () => {
		const pair = generateEd25519KeyPair()
		const reg = createKeyRegistry()
		expect(() => reg.add('k1', pair.publicKey, { notBefore: 5000, notAfter: 1000 })).toThrow(
			/greater than notBefore/,
		)
		expect(() => reg.add('k2', pair.publicKey, { notBefore: Number.NaN })).toThrow(/finite/)
		expect(() => reg.add('k3', pair.publicKey, { notAfter: Number.POSITIVE_INFINITY })).toThrow(
			/finite/,
		)
	})

	it('isValid returns false for unknown keyId', () => {
		const reg = createKeyRegistry()
		expect(reg.isValid('nope')).toBe(false)
	})
})
