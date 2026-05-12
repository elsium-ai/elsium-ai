import { hmacSha256Hex, randomHexString, sha256Hex, timingSafeEqualHex } from '@elsium-ai/core'

export interface AgentIdentity {
	readonly agentId: string
	readonly publicKey: string
	sign(payload: Record<string, unknown>): Promise<SignedPayload>
	verify(signed: SignedPayload): Promise<VerificationResult>
}

export interface SignedPayload {
	payload: Record<string, unknown>
	signature: string
	agentId: string
	timestamp: number
	nonce: string
}

export interface VerificationResult {
	valid: boolean
	reason?: string
}

export interface AgentIdentityConfig {
	agentId: string
	secret?: string
	replayWindowMs?: number
}

const DEFAULT_REPLAY_WINDOW_MS = 5 * 60 * 1000

/**
 * Build an agent identity capable of HMAC-signing payloads with replay
 * protection. Async because computing the publicKey (a SHA-256 of the secret)
 * uses Web Crypto, which is async on every cross-runtime target.
 */
export async function createAgentIdentity(config: AgentIdentityConfig): Promise<AgentIdentity> {
	const secret = config.secret ?? randomHexString(32)
	const replayWindowMs = config.replayWindowMs ?? DEFAULT_REPLAY_WINDOW_MS
	const publicKey = await sha256Hex(secret)

	const usedNonces = new Set<string>()
	let lastCleanup = Date.now()

	function cleanupNonces() {
		const now = Date.now()
		if (now - lastCleanup < replayWindowMs) return
		usedNonces.clear()
		lastCleanup = now
	}

	function computeSignature(
		payload: Record<string, unknown>,
		timestamp: number,
		nonce: string,
	): Promise<string> {
		const content = JSON.stringify({ payload, agentId: config.agentId, timestamp, nonce })
		return hmacSha256Hex(secret, content)
	}

	return {
		get agentId() {
			return config.agentId
		},

		get publicKey() {
			return publicKey
		},

		async sign(payload: Record<string, unknown>): Promise<SignedPayload> {
			const timestamp = Date.now()
			const nonce = randomHexString(16)
			const signature = await computeSignature(payload, timestamp, nonce)

			return {
				payload,
				signature,
				agentId: config.agentId,
				timestamp,
				nonce,
			}
		},

		async verify(signed: SignedPayload): Promise<VerificationResult> {
			if (signed.agentId !== config.agentId) {
				return { valid: false, reason: 'Agent ID mismatch' }
			}

			const now = Date.now()
			const age = now - signed.timestamp
			if (age > replayWindowMs || age < -replayWindowMs) {
				return { valid: false, reason: 'Timestamp outside replay window' }
			}

			cleanupNonces()
			if (usedNonces.has(signed.nonce)) {
				return { valid: false, reason: 'Nonce already used (replay attack)' }
			}

			const expected = await computeSignature(signed.payload, signed.timestamp, signed.nonce)

			if (!timingSafeEqualHex(signed.signature, expected)) {
				return { valid: false, reason: 'Invalid signature' }
			}

			usedNonces.add(signed.nonce)
			return { valid: true }
		},
	}
}

export interface IdentityRegistry {
	register(identity: AgentIdentity): void
	get(agentId: string): AgentIdentity | undefined
	verifySignedPayload(signed: SignedPayload): Promise<VerificationResult>
	readonly agents: string[]
}

export function createIdentityRegistry(): IdentityRegistry {
	const identities = new Map<string, AgentIdentity>()

	return {
		register(identity: AgentIdentity): void {
			identities.set(identity.agentId, identity)
		},

		get(agentId: string): AgentIdentity | undefined {
			return identities.get(agentId)
		},

		async verifySignedPayload(signed: SignedPayload): Promise<VerificationResult> {
			const identity = identities.get(signed.agentId)
			if (!identity) {
				return { valid: false, reason: `Unknown agent: ${signed.agentId}` }
			}
			return identity.verify(signed)
		},

		get agents(): string[] {
			return [...identities.keys()]
		},
	}
}
