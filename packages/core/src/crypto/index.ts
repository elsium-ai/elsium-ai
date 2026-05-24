export {
	createEd25519Signer,
	createEd25519Verifier,
	generateEd25519KeyPair,
	computeKeyFingerprint,
	publicKeyFromPem,
	privateKeyFromPem,
} from './signer'
export type {
	Signature,
	VerifyResult,
	Signer,
	Verifier,
	PublicKeyResolver,
	Ed25519KeyPair,
} from './signer'

export { createKeyRegistry } from './key-registry'
export type { KeyRegistry, KeyRegistryConfig, TrustedKey, AddKeyOptions } from './key-registry'

export {
	createInMemoryWriteOnceStore,
	createFileWriteOnceStore,
	WriteOnceConflictError,
} from './tamper-evident'
export type { WriteOnceStore, WriteReceipt, FileWriteOnceStoreConfig } from './tamper-evident'
