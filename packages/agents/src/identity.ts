import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export interface AgentIdentity {
	readonly agentId: string
	readonly publicKey: string
	sign(payload: Record<string, unknown>): SignedPayload
	verify(signed: SignedPayload): VerificationResult
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

export function createAgentIdentity(config: AgentIdentityConfig): AgentIdentity {
	const secret = config.secret ?? randomBytes(32).toString('hex')
	const replayWindowMs = config.replayWindowMs ?? DEFAULT_REPLAY_WINDOW_MS
	const publicKey = createHash('sha256').update(secret).digest('hex')

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
	): string {
		const content = JSON.stringify({ payload, agentId: config.agentId, timestamp, nonce })
		return createHmac('sha256', secret).update(content).digest('hex')
	}

	return {
		get agentId() {
			return config.agentId
		},

		get publicKey() {
			return publicKey
		},

		sign(payload: Record<string, unknown>): SignedPayload {
			const timestamp = Date.now()
			const nonce = randomBytes(16).toString('hex')
			const signature = computeSignature(payload, timestamp, nonce)

			return {
				payload,
				signature,
				agentId: config.agentId,
				timestamp,
				nonce,
			}
		},

		verify(signed: SignedPayload): VerificationResult {
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

			const expected = computeSignature(signed.payload, signed.timestamp, signed.nonce)

			const sigBuf = Buffer.from(signed.signature, 'hex')
			const expectedBuf = Buffer.from(expected, 'hex')

			if (sigBuf.length !== expectedBuf.length) {
				return { valid: false, reason: 'Invalid signature' }
			}

			if (!timingSafeEqual(sigBuf, expectedBuf)) {
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
	verifySignedPayload(signed: SignedPayload): VerificationResult
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

		verifySignedPayload(signed: SignedPayload): VerificationResult {
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
