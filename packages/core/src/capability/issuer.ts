import type { Signer } from '../crypto/signer'
import { ElsiumError } from '../errors'
import { generateId } from '../utils'
import { type DelegateOptions, delegateToken } from './delegation'
import type {
	AgentCapability,
	CapabilityBudget,
	CapabilityDataClasses,
	CapabilitySubject,
	CapabilityToken,
} from './types'
import { CAPABILITY_TOKEN_VERSION } from './types'

const DEFAULT_TTL_MS = 60 * 60 * 1000

export interface CapabilityIssuerConfig {
	signer: Signer
	orgId: string
	clock?: () => number
}

export interface CapabilityIssuer {
	readonly orgId: string
	readonly keyId: string
	mint(options: MintOptions): CapabilityToken
	delegate(parent: CapabilityToken, options: Omit<DelegateOptions, 'signer'>): CapabilityToken
}

export interface MintOptions {
	subject: CapabilitySubject
	capabilities: AgentCapability[]
	dataClasses?: CapabilityDataClasses
	budget?: CapabilityBudget
	ttlMs?: number
	expiresAt?: number
	notBefore?: number
}

function assertCapabilityList(capabilities: AgentCapability[]): void {
	if (!Array.isArray(capabilities) || capabilities.length === 0) {
		throw new ElsiumError({
			code: 'CONFIG_ERROR',
			message: 'mint requires at least one capability',
			retryable: false,
		})
	}
	for (const cap of capabilities) {
		if (!cap || typeof cap !== 'object' || typeof cap.kind !== 'string') {
			throw new ElsiumError({
				code: 'CONFIG_ERROR',
				message: 'every capability must be an object with a "kind"',
				retryable: false,
			})
		}
	}
}

function assertSubject(subject: CapabilitySubject): void {
	if (!subject || typeof subject.agent !== 'string' || subject.agent.trim() === '') {
		throw new ElsiumError({
			code: 'CONFIG_ERROR',
			message: 'subject.agent must be a non-empty string',
			retryable: false,
		})
	}
}

function resolveValidity(
	now: number,
	options: MintOptions,
): { issuedAt: number; expiresAt: number; notBefore?: number } {
	const ttl = options.ttlMs ?? DEFAULT_TTL_MS
	const expiresAt = options.expiresAt ?? now + ttl
	if (!Number.isFinite(expiresAt) || expiresAt <= now) {
		throw new ElsiumError({
			code: 'CONFIG_ERROR',
			message: 'expiresAt must be in the future',
			retryable: false,
		})
	}
	if (options.notBefore !== undefined && options.notBefore >= expiresAt) {
		throw new ElsiumError({
			code: 'CONFIG_ERROR',
			message: 'notBefore must be less than expiresAt',
			retryable: false,
		})
	}
	return { issuedAt: now, expiresAt, notBefore: options.notBefore }
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

export function tokenSigningPayload(token: Omit<CapabilityToken, 'signature'>): string {
	return canonicalize(token)
}

export function createCapabilityIssuer(config: CapabilityIssuerConfig): CapabilityIssuer {
	if (!config.orgId || typeof config.orgId !== 'string') {
		throw new ElsiumError({
			code: 'CONFIG_ERROR',
			message: 'CapabilityIssuer requires a non-empty orgId',
			retryable: false,
		})
	}
	const clock = config.clock ?? (() => Date.now())

	return {
		orgId: config.orgId,
		keyId: config.signer.keyId,

		mint(options) {
			assertSubject(options.subject)
			assertCapabilityList(options.capabilities)

			const now = clock()
			const validity = resolveValidity(now, options)
			const tokenId = `cap_${generateId('').slice(1)}`

			const unsigned: Omit<CapabilityToken, 'signature'> = {
				version: CAPABILITY_TOKEN_VERSION,
				tokenId,
				issuer: { orgId: config.orgId, keyId: config.signer.keyId },
				subject: options.subject,
				capabilities: options.capabilities,
				dataClasses: options.dataClasses,
				budget: options.budget,
				validity,
			}

			const signature = config.signer.sign(tokenSigningPayload(unsigned))
			return { ...unsigned, signature }
		},

		delegate(parent, options) {
			return delegateToken(parent, { ...options, signer: config.signer }, clock)
		},
	}
}
