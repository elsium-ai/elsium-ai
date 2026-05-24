import { createHash } from 'node:crypto'
import {
	ElsiumError,
	type KeyRegistry,
	type Middleware,
	type Signer,
	type WriteOnceStore,
	createEd25519Verifier,
	generateId,
} from '@elsium-ai/core'
import type {
	ExecutionProof,
	LLMCallSummary,
	PolicyDecisionSummary,
	ProofEvent,
	ProofEventType,
	RagRetrieveSummary,
	ReproducibilityHints,
	ToolCallSummary,
	VerifyProofResult,
} from './types'

const PROOF_VERSION = 'elsium-proof/v1' as const
const ZERO_HASH = '0'.repeat(64)
const PROOF_SESSION_METADATA_KEY = 'proofSessionId'

export interface ProofSessionInputs {
	messages?: unknown
	constraints?: Record<string, unknown>
	[key: string]: unknown
}

export interface StartSessionOptions {
	agentId: string
	agentVersion?: string
	reproducibility?: ReproducibilityHints
	inputs?: ProofSessionInputs
	clock?: () => number
}

export interface FinalizeOptions {
	finalOutput?: unknown
	store?: WriteOnceStore
	storeKey?: (proofId: string) => string
}

export interface ProofSession {
	readonly proofId: string
	readonly agentId: string
	readonly agentVersion?: string
	readonly startedAt: number
	readonly events: readonly ProofEvent[]
	readonly chainHead: string
	recordLLMCall(summary: LLMCallSummary): ProofEvent
	recordToolCall(summary: ToolCallSummary): ProofEvent
	recordRagRetrieve(summary: RagRetrieveSummary): ProofEvent
	recordPolicyDecision(summary: PolicyDecisionSummary): ProofEvent
	recordCustom(data: Record<string, unknown>): ProofEvent
	finalize(options?: FinalizeOptions): Promise<ExecutionProof>
}

export interface ProofRecorderConfig {
	signer: Signer
	clock?: () => number
}

export interface ProofRecorder {
	readonly signer: Signer
	startSession(options: StartSessionOptions): ProofSession
	middleware(): Middleware
	verify(proof: ExecutionProof, registry: KeyRegistry): VerifyProofResult
}

function sha256HexSync(input: string): string {
	return createHash('sha256').update(input, 'utf8').digest('hex')
}

function canonicalize(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value)
	if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
	const keys = Object.keys(value as Record<string, unknown>).sort()
	const entries = keys.map(
		(k) => `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k])}`,
	)
	return `{${entries.join(',')}}`
}

function eventHashInput(event: Omit<ProofEvent, 'hashSelf'>): string {
	return canonicalize({
		sequence: event.sequence,
		type: event.type,
		timestamp: event.timestamp,
		data: event.data,
		hashPrev: event.hashPrev,
	})
}

function chainHeadSigningPayload(proofId: string, chainHead: string): string {
	return `${PROOF_VERSION}\n${proofId}\n${chainHead}`
}

function defaultStoreKey(proofId: string): string {
	return `${proofId}.json`
}

function toIso(epoch: number): string {
	return new Date(epoch).toISOString()
}

export function createProofRecorder(config: ProofRecorderConfig): ProofRecorder {
	const clock = config.clock ?? (() => Date.now())
	const liveSessions = new Map<string, ProofSession>()

	const startSession = (options: StartSessionOptions): ProofSession => {
		if (!options.agentId || typeof options.agentId !== 'string') {
			throw new ElsiumError({
				code: 'CONFIG_ERROR',
				message: 'startSession requires a non-empty agentId',
				retryable: false,
			})
		}

		const sessionClock = options.clock ?? clock
		const proofId = `proof_${generateId('').slice(1)}`
		const startedAt = sessionClock()

		const events: ProofEvent[] = []
		let finalized = false

		const appendEvent = (type: ProofEventType, data: Record<string, unknown>): ProofEvent => {
			if (finalized) {
				throw new ElsiumError({
					code: 'VALIDATION_ERROR',
					message: 'Cannot record events on a finalized proof session',
					retryable: false,
				})
			}
			const hashPrev = events.length === 0 ? ZERO_HASH : events[events.length - 1].hashSelf
			const partial: Omit<ProofEvent, 'hashSelf'> = {
				sequence: events.length,
				type,
				timestamp: sessionClock(),
				data,
				hashPrev,
			}
			const hashSelf = sha256HexSync(eventHashInput(partial))
			const event: ProofEvent = { ...partial, hashSelf }
			events.push(event)
			return event
		}

		if (options.inputs) {
			appendEvent('agent.input', options.inputs as Record<string, unknown>)
		}

		const session: ProofSession = {
			proofId,
			agentId: options.agentId,
			agentVersion: options.agentVersion,
			startedAt,
			get events() {
				return events
			},
			get chainHead() {
				return events.length === 0 ? ZERO_HASH : events[events.length - 1].hashSelf
			},
			recordLLMCall: (summary) => appendEvent('llm.call', { ...summary }),
			recordToolCall: (summary) => appendEvent('tool.call', { ...summary }),
			recordRagRetrieve: (summary) => appendEvent('rag.retrieve', { ...summary }),
			recordPolicyDecision: (summary) => appendEvent('policy.evaluated', { ...summary }),
			recordCustom: (data) => appendEvent('custom', data),

			async finalize(opts) {
				if (finalized) {
					throw new ElsiumError({
						code: 'VALIDATION_ERROR',
						message: 'Proof session already finalized',
						retryable: false,
					})
				}

				if (opts?.finalOutput !== undefined) {
					appendEvent('agent.output', { output: opts.finalOutput })
				}

				finalized = true
				liveSessions.delete(proofId)

				const endedAt = sessionClock()
				const chainHead = events.length === 0 ? ZERO_HASH : events[events.length - 1].hashSelf
				const signature = config.signer.sign(chainHeadSigningPayload(proofId, chainHead))

				const proof: ExecutionProof = {
					version: PROOF_VERSION,
					proofId,
					agentId: options.agentId,
					agentVersion: options.agentVersion,
					startedAt: toIso(startedAt),
					endedAt: toIso(endedAt),
					events: events.slice(),
					chainHead,
					signature,
					reproducibility: options.reproducibility,
				}

				if (opts?.store) {
					const key = (opts.storeKey ?? defaultStoreKey)(proofId)
					await opts.store.put(key, JSON.stringify(proof))
				}

				return proof
			},
		}

		liveSessions.set(proofId, session)
		return session
	}

	const middleware = (): Middleware => async (ctx, next) => {
		const sessionId = ctx.metadata?.[PROOF_SESSION_METADATA_KEY]
		const response = await next(ctx)

		if (typeof sessionId !== 'string') return response

		const session = liveSessions.get(sessionId)
		if (!session) return response

		session.recordLLMCall({
			model: response.model,
			provider: response.provider,
			requestHash: sha256HexSync(canonicalize(ctx.request)),
			responseHash: sha256HexSync(canonicalize(response.message)),
			inputTokens: response.usage.inputTokens,
			outputTokens: response.usage.outputTokens,
			totalTokens: response.usage.totalTokens,
			latencyMs: response.latencyMs,
			stopReason: response.stopReason,
		})

		return response
	}

	return {
		signer: config.signer,
		startSession,
		middleware,
		verify: (proof, registry) => verifyProof(proof, registry),
	}
}

function verifyChain(proof: ExecutionProof): VerifyProofResult | { kind: 'ok' } {
	let prev = ZERO_HASH
	for (let i = 0; i < proof.events.length; i++) {
		const event = proof.events[i]
		if (event.hashPrev !== prev) {
			return {
				valid: false,
				signatureValid: false,
				chainValid: false,
				chainBrokenAt: i,
				reason: `hashPrev mismatch at event ${i}`,
			}
		}
		const recomputed = sha256HexSync(
			eventHashInput({
				sequence: event.sequence,
				type: event.type,
				timestamp: event.timestamp,
				data: event.data,
				hashPrev: event.hashPrev,
			}),
		)
		if (recomputed !== event.hashSelf) {
			return {
				valid: false,
				signatureValid: false,
				chainValid: false,
				chainBrokenAt: i,
				reason: `hashSelf mismatch at event ${i}`,
			}
		}
		prev = event.hashSelf
	}

	if (proof.chainHead !== prev) {
		return {
			valid: false,
			signatureValid: false,
			chainValid: false,
			reason: 'chainHead does not match recomputed chain',
		}
	}

	return { kind: 'ok' }
}

export function verifyProof(proof: ExecutionProof, registry: KeyRegistry): VerifyProofResult {
	if (proof.version !== PROOF_VERSION) {
		return {
			valid: false,
			signatureValid: false,
			chainValid: false,
			reason: `Unsupported proof version: ${proof.version}`,
		}
	}

	const chainResult = verifyChain(proof)
	if ('valid' in chainResult) return chainResult

	const verifier = createEd25519Verifier({ resolver: registry })
	const sigResult = verifier.verify(
		chainHeadSigningPayload(proof.proofId, proof.chainHead),
		proof.signature,
	)

	return {
		valid: sigResult.valid,
		signatureValid: sigResult.valid,
		chainValid: true,
		reason: sigResult.reason,
	}
}

export { PROOF_SESSION_METADATA_KEY, PROOF_VERSION }
