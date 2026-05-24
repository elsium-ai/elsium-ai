import type { KeyObject } from 'node:crypto'
import { ElsiumError } from '../errors'
import { computeKeyFingerprint, publicKeyFromPem } from './signer'
import type { PublicKeyResolver } from './signer'

export interface TrustedKey {
	keyId: string
	publicKey: KeyObject
	fingerprint: string
	notBefore?: number
	notAfter?: number
	label?: string
	addedAt: number
}

export interface AddKeyOptions {
	notBefore?: number
	notAfter?: number
	label?: string
}

export interface KeyRegistry extends PublicKeyResolver {
	add(keyId: string, publicKey: string | KeyObject, opts?: AddKeyOptions): TrustedKey
	get(keyId: string): TrustedKey | undefined
	remove(keyId: string): boolean
	list(): TrustedKey[]
	isValid(keyId: string, atTime?: number): boolean
}

export interface KeyRegistryConfig {
	trustRoots?: Array<{
		keyId: string
		publicKey: string
		label?: string
		notBefore?: number
		notAfter?: number
	}>
	clock?: () => number
}

const BLOCKED_KEY_IDS = new Set(['__proto__', 'constructor', 'prototype'])

function assertKeyId(keyId: string): void {
	if (typeof keyId !== 'string' || keyId.trim() === '') {
		throw new ElsiumError({
			code: 'CONFIG_ERROR',
			message: 'keyId must be a non-empty string',
			retryable: false,
		})
	}
	if (BLOCKED_KEY_IDS.has(keyId)) {
		throw new ElsiumError({
			code: 'CONFIG_ERROR',
			message: `keyId "${keyId}" is reserved and rejected`,
			retryable: false,
		})
	}
}

function assertValidityWindow(notBefore?: number, notAfter?: number): void {
	if (notBefore !== undefined && !Number.isFinite(notBefore)) {
		throw new ElsiumError({
			code: 'CONFIG_ERROR',
			message: 'notBefore must be a finite number (epoch ms)',
			retryable: false,
		})
	}
	if (notAfter !== undefined && !Number.isFinite(notAfter)) {
		throw new ElsiumError({
			code: 'CONFIG_ERROR',
			message: 'notAfter must be a finite number (epoch ms)',
			retryable: false,
		})
	}
	if (notBefore !== undefined && notAfter !== undefined && notAfter <= notBefore) {
		throw new ElsiumError({
			code: 'CONFIG_ERROR',
			message: 'notAfter must be greater than notBefore',
			retryable: false,
		})
	}
}

export function createKeyRegistry(config: KeyRegistryConfig = {}): KeyRegistry {
	const keys = new Map<string, TrustedKey>()
	const clock = config.clock ?? (() => Date.now())

	const add = (keyId: string, publicKey: string | KeyObject, opts?: AddKeyOptions): TrustedKey => {
		assertKeyId(keyId)
		assertValidityWindow(opts?.notBefore, opts?.notAfter)

		if (keys.has(keyId)) {
			throw new ElsiumError({
				code: 'CONFIG_ERROR',
				message: `keyId "${keyId}" is already registered`,
				retryable: false,
			})
		}

		const key = typeof publicKey === 'string' ? publicKeyFromPem(publicKey) : publicKey
		const entry: TrustedKey = {
			keyId,
			publicKey: key,
			fingerprint: computeKeyFingerprint(key),
			notBefore: opts?.notBefore,
			notAfter: opts?.notAfter,
			label: opts?.label,
			addedAt: clock(),
		}
		keys.set(keyId, entry)
		return entry
	}

	for (const root of config.trustRoots ?? []) {
		add(root.keyId, root.publicKey, {
			label: root.label,
			notBefore: root.notBefore,
			notAfter: root.notAfter,
		})
	}

	const isValid = (keyId: string, atTime?: number): boolean => {
		const entry = keys.get(keyId)
		if (!entry) return false
		const now = atTime ?? clock()
		if (entry.notBefore !== undefined && now < entry.notBefore) return false
		if (entry.notAfter !== undefined && now >= entry.notAfter) return false
		return true
	}

	return {
		add,
		get: (keyId) => keys.get(keyId),
		remove: (keyId) => keys.delete(keyId),
		list: () => [...keys.values()],
		isValid,
		resolve: (keyId) => {
			const entry = keys.get(keyId)
			if (!entry) return undefined
			if (!isValid(keyId)) return undefined
			return entry.publicKey
		},
	}
}
