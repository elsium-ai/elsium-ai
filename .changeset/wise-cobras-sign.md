---
'@elsium-ai/core': minor
---

Add a low-level cryptographic foundation under `@elsium-ai/core/crypto`: Ed25519 `Signer`/`Verifier` using `node:crypto` with PKCS#8 PEM input and base64url signatures; `KeyRegistry` with named keys, validity windows, prototype-pollution-safe `keyId` validation, and an injectable clock; `WriteOnceStore` port with in-memory and file-system adapters (the file adapter uses `O_EXCL` for atomic write-once semantics, throwing `WriteOnceConflictError` on duplicates). These primitives are the substrate for upcoming verifiable agent execution (signed proofs) and capability tokens.
