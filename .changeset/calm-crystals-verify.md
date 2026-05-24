---
'@elsium-ai/observe': minor
'@elsium-ai/cli': minor
---

Add Verifiable Agent Execution (α-2) — offline CLI verification and proof comparison. New `compareProofs(a, b, { strategy })` in `@elsium-ai/observe` diffs two `ExecutionProof`s under `bit-exact` (every event's `hashSelf` must match — requires `temperature: 0` + `seed`) or `structural` (same event order/types; `tool.call`/`rag.retrieve`/`policy.evaluated` data must match exactly, `llm.call` compared by `model`+`provider` only). New `elsium verify <proof.json> [--public-key|--trust-roots]` recomputes the chain and verifies the Ed25519 signature offline using only the trusted public key; supports `--json` and `--quiet`. New `elsium replay <a.json> <b.json> [--strategy]` compares two proofs and exits non-zero when they diverge. Together these let any third party download a proof from another machine and verify what an agent did without API keys or network access.
