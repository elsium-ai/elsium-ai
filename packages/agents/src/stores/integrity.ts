import { type Message, sha256Hex } from '@elsium-ai/core'
import type { MemoryStore } from './memory-store'

export interface IntegrityMetadata {
	hash: string
	previousHash: string
	index: number
}

export interface VerifiedMessage {
	message: Message
	integrity: IntegrityMetadata
}

export interface MemoryIntegrityResult {
	valid: boolean
	totalMessages: number
	brokenAt?: number
	chainComplete?: boolean
}

export interface SecureMemoryStore extends MemoryStore {
	verifyIntegrity(agentId: string): Promise<MemoryIntegrityResult>
}

const ZERO_HASH = '0'.repeat(64)

export async function computeMessageHash(
	message: Message,
	index: number,
	previousHash: string,
): Promise<string> {
	const content = JSON.stringify({
		role: message.role,
		content: message.content,
		index,
		previousHash,
	})
	return sha256Hex(content)
}

export async function verifyMessageChain(
	messages: Message[],
	hashes: string[],
): Promise<MemoryIntegrityResult> {
	if (messages.length === 0) {
		return { valid: true, totalMessages: 0, chainComplete: true }
	}

	if (messages.length !== hashes.length) {
		return { valid: false, totalMessages: messages.length, brokenAt: 0 }
	}

	let previousHash = ZERO_HASH
	for (let i = 0; i < messages.length; i++) {
		const expected = await computeMessageHash(messages[i], i, previousHash)
		if (expected !== hashes[i]) {
			return { valid: false, totalMessages: messages.length, brokenAt: i }
		}
		previousHash = hashes[i]
	}

	return { valid: true, totalMessages: messages.length, chainComplete: true }
}

async function buildHashChain(messages: Message[]): Promise<string[]> {
	const hashes: string[] = []
	let prev = ZERO_HASH
	for (let i = 0; i < messages.length; i++) {
		const hash = await computeMessageHash(messages[i], i, prev)
		hashes.push(hash)
		prev = hash
	}
	return hashes
}

export function createSecureMemoryStore(inner: MemoryStore): SecureMemoryStore {
	const hashChains = new Map<string, string[]>()

	return {
		async load(agentId: string): Promise<Message[]> {
			const messages = await inner.load(agentId)
			if (!hashChains.has(agentId) && messages.length > 0) {
				hashChains.set(agentId, await buildHashChain(messages))
			}
			return messages
		},

		async save(agentId: string, messages: Message[]): Promise<void> {
			hashChains.set(agentId, await buildHashChain(messages))
			await inner.save(agentId, messages)
		},

		async clear(agentId: string): Promise<void> {
			hashChains.delete(agentId)
			await inner.clear(agentId)
		},

		async verifyIntegrity(agentId: string): Promise<MemoryIntegrityResult> {
			const messages = await inner.load(agentId)
			const hashes = hashChains.get(agentId) ?? []
			return verifyMessageChain(messages, hashes)
		},
	}
}
