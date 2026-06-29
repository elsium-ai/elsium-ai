---
"@elsium-ai/testing": minor
---

Add Ed25519-signed eval proofs — third-party-verifiable eval results.

`attestEvalSuite` uses HMAC-SHA256, so eval integrity can only be checked by
whoever holds the shared secret. New `proveEvalSuite` signs an eval suite result
as a standard Ed25519 `ExecutionProof` (from `@elsium-ai/observe`): each case is a
hash-chained event and the chain head is signed once.

- `proveEvalSuite(result, { signer })` → signed `ExecutionProof`.
- `verifyEvalProof(proof, registry)` → verifies offline with only the public key;
  the existing `elsium verify` CLI verifies it too.

This bridges eval results and the signed-proof chain, so eval outcomes become
evidence anyone can verify independently — no secret shared. `@elsium-ai/testing`
now depends on `@elsium-ai/observe`.
