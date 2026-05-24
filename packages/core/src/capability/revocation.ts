import { ElsiumError } from '../errors'

export interface RevocationEntry {
	tokenId: string
	revokedAt: number
	reason?: string
	revokedBy?: string
}

export interface RevocationStore {
	revoke(tokenId: string, opts?: { reason?: string; revokedBy?: string }): Promise<RevocationEntry>
	isRevoked(tokenId: string): Promise<boolean>
	getEntry(tokenId: string): Promise<RevocationEntry | undefined>
	list(): AsyncIterable<RevocationEntry>
}

export interface InMemoryRevocationStoreConfig {
	clock?: () => number
}

export function createInMemoryRevocationStore(
	config: InMemoryRevocationStoreConfig = {},
): RevocationStore {
	const entries = new Map<string, RevocationEntry>()
	const clock = config.clock ?? (() => Date.now())

	return {
		async revoke(tokenId, opts) {
			if (!tokenId || typeof tokenId !== 'string') {
				throw new ElsiumError({
					code: 'VALIDATION_ERROR',
					message: 'tokenId must be a non-empty string',
					retryable: false,
				})
			}
			const existing = entries.get(tokenId)
			if (existing) return existing
			const entry: RevocationEntry = {
				tokenId,
				revokedAt: clock(),
				reason: opts?.reason,
				revokedBy: opts?.revokedBy,
			}
			entries.set(tokenId, entry)
			return entry
		},
		async isRevoked(tokenId) {
			return entries.has(tokenId)
		},
		async getEntry(tokenId) {
			return entries.get(tokenId)
		},
		async *list() {
			for (const entry of entries.values()) yield entry
		},
	}
}
