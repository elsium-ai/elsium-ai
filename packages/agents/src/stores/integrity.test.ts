import type { Message } from '@elsium-ai/core'
import { describe, expect, it } from 'vitest'
import { computeMessageHash, createSecureMemoryStore, verifyMessageChain } from './integrity'
import { createInMemoryMemoryStore } from './memory-store'

describe('computeMessageHash', () => {
	it('produces consistent SHA-256 hashes', async () => {
		const msg: Message = { role: 'user', content: 'hello' }
		const hash1 = await computeMessageHash(msg, 0, '0'.repeat(64))
		const hash2 = await computeMessageHash(msg, 0, '0'.repeat(64))

		expect(hash1).toBe(hash2)
		expect(hash1).toMatch(/^[a-f0-9]{64}$/)
	})

	it('produces different hashes for different messages', async () => {
		const prev = '0'.repeat(64)
		const hash1 = await computeMessageHash({ role: 'user', content: 'hello' }, 0, prev)
		const hash2 = await computeMessageHash({ role: 'user', content: 'world' }, 0, prev)

		expect(hash1).not.toBe(hash2)
	})

	it('produces different hashes for different indices', async () => {
		const msg: Message = { role: 'user', content: 'hello' }
		const prev = '0'.repeat(64)
		const hash1 = await computeMessageHash(msg, 0, prev)
		const hash2 = await computeMessageHash(msg, 1, prev)

		expect(hash1).not.toBe(hash2)
	})

	it('chains hashes — different previousHash yields different result', async () => {
		const msg: Message = { role: 'user', content: 'hello' }
		const hash1 = await computeMessageHash(msg, 0, '0'.repeat(64))
		const hash2 = await computeMessageHash(msg, 0, 'a'.repeat(64))

		expect(hash1).not.toBe(hash2)
	})
})

describe('verifyMessageChain', () => {
	it('verifies empty chain', async () => {
		const result = await verifyMessageChain([], [])
		expect(result.valid).toBe(true)
		expect(result.totalMessages).toBe(0)
		expect(result.chainComplete).toBe(true)
	})

	it('verifies valid chain', async () => {
		const messages: Message[] = [
			{ role: 'user', content: 'hello' },
			{ role: 'assistant', content: 'hi' },
			{ role: 'user', content: 'how are you?' },
		]

		const zeroHash = '0'.repeat(64)
		const h0 = await computeMessageHash(messages[0], 0, zeroHash)
		const h1 = await computeMessageHash(messages[1], 1, h0)
		const h2 = await computeMessageHash(messages[2], 2, h1)

		const result = await verifyMessageChain(messages, [h0, h1, h2])
		expect(result.valid).toBe(true)
		expect(result.totalMessages).toBe(3)
		expect(result.chainComplete).toBe(true)
	})

	it('detects tampered message', async () => {
		const messages: Message[] = [
			{ role: 'user', content: 'hello' },
			{ role: 'assistant', content: 'hi' },
		]

		const zeroHash = '0'.repeat(64)
		const h0 = await computeMessageHash(messages[0], 0, zeroHash)
		const h1 = await computeMessageHash(messages[1], 1, h0)

		messages[0] = { role: 'user', content: 'TAMPERED' }

		const result = await verifyMessageChain(messages, [h0, h1])
		expect(result.valid).toBe(false)
		expect(result.brokenAt).toBe(0)
	})

	it('detects length mismatch', async () => {
		const messages: Message[] = [{ role: 'user', content: 'hello' }]
		const result = await verifyMessageChain(messages, [])
		expect(result.valid).toBe(false)
		expect(result.brokenAt).toBe(0)
	})
})

describe('createSecureMemoryStore', () => {
	it('saves and loads messages with integrity', async () => {
		const inner = createInMemoryMemoryStore()
		const secure = createSecureMemoryStore(inner)

		const messages: Message[] = [
			{ role: 'user', content: 'hello' },
			{ role: 'assistant', content: 'hi there' },
		]

		await secure.save('agent-1', messages)
		const loaded = await secure.load('agent-1')

		expect(loaded).toEqual(messages)
	})

	it('verifies integrity of untampered messages', async () => {
		const inner = createInMemoryMemoryStore()
		const secure = createSecureMemoryStore(inner)

		await secure.save('agent-1', [
			{ role: 'user', content: 'hello' },
			{ role: 'assistant', content: 'hi' },
		])

		const result = await secure.verifyIntegrity('agent-1')
		expect(result.valid).toBe(true)
		expect(result.totalMessages).toBe(2)
		expect(result.chainComplete).toBe(true)
	})

	it('detects tampered messages via inner store', async () => {
		const inner = createInMemoryMemoryStore()
		const secure = createSecureMemoryStore(inner)

		await secure.save('agent-1', [
			{ role: 'user', content: 'hello' },
			{ role: 'assistant', content: 'hi' },
		])

		await inner.save('agent-1', [
			{ role: 'user', content: 'TAMPERED' },
			{ role: 'assistant', content: 'hi' },
		])

		const result = await secure.verifyIntegrity('agent-1')
		expect(result.valid).toBe(false)
		expect(result.brokenAt).toBe(0)
	})

	it('clears hashes on clear()', async () => {
		const inner = createInMemoryMemoryStore()
		const secure = createSecureMemoryStore(inner)

		await secure.save('agent-1', [{ role: 'user', content: 'hello' }])
		await secure.clear('agent-1')

		const result = await secure.verifyIntegrity('agent-1')
		expect(result.valid).toBe(true)
		expect(result.totalMessages).toBe(0)
	})

	it('handles multiple agents independently', async () => {
		const inner = createInMemoryMemoryStore()
		const secure = createSecureMemoryStore(inner)

		await secure.save('agent-1', [{ role: 'user', content: 'hello' }])
		await secure.save('agent-2', [{ role: 'user', content: 'world' }])

		const r1 = await secure.verifyIntegrity('agent-1')
		const r2 = await secure.verifyIntegrity('agent-2')
		expect(r1.valid).toBe(true)
		expect(r2.valid).toBe(true)
	})
})
