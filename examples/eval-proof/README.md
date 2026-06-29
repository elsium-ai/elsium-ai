# signed eval proofs — third-party-verifiable eval results

`attestEvalSuite` (HMAC-SHA256) proves eval integrity only to whoever holds the
shared secret. `proveEvalSuite` signs the result as an **Ed25519 `ExecutionProof`**,
so **anyone can verify it offline with just the public key** — no secret shared.

## What this example shows

1. Run an eval suite (mock runner, no API key).
2. `proveEvalSuite(suite, { signer })` → a signed Ed25519 proof; each eval case
   is a hash-chained event, the chain head is signed once.
3. `verifyEvalProof(proof, registry)` → verifies offline with only the public key.
4. Tampering with any case breaks the chain and verification fails.

## Run

```bash
bun examples/eval-proof/index.ts
```

## Also verifiable from the CLI

Because it is a standard `ExecutionProof`, the existing CLI verifies it too:

```bash
elsium verify ./eval-proof.json --public-key ./org.pub
```

## The point

This bridges two previously separate worlds — eval results and the Ed25519 proof
chain in `@elsium-ai/observe`. It is "evals are proof, not opinion" taken to its
conclusion: eval results become evidence a regulator or auditor can verify
independently, without trusting you or holding any secret.
