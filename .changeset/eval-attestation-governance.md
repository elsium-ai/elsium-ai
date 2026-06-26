---
'@elsium-ai/testing': minor
---

Add governed, reproducible, auditable evaluation to `@elsium-ai/testing` — evals as proof, not opinion.

- **Eval attestation** — `attestEvalSuite`, `verifyEvalAttestation`, `formatAttestation`. Produces a signed, hash-chained (HMAC-SHA256) record of an eval run that anyone can verify independently with the shared secret. Records store only the SHA-256 **hashes** of inputs/outputs, so an attestation is shareable as audit evidence without leaking the underlying data, yet provable against the originals. The header (suite, metadata, summary, embedded governance verdict) seeds a genesis signature and each case record chains over the previous one; any tampered record, reordered entry, or swapped metadata field detaches the chain and is pinpointed by `invalidAtIndex`. Reuses the same hash-chain primitives as signed replay.
- **Eval-as-policy gates** — `runEvalGate`, `toAttestedGovernance`. Turns eval results into governance verdicts wired to the `@elsium-ai/core` policy engine (`PolicySet` denials become violations) and/or custom `GovernanceAssertion`s. A failed gate can be flipped to passed with a recorded sign-off `override` (`{ approver, reason }`), and that verdict can be sealed into the attestation chain.
- **Compliance mapping** — `buildEvalComplianceReport`, `formatEvalComplianceReport`. Assertions carry regulatory `controls` (e.g. `eu-ai-act:art-10`, `nist-ai-rmf:measure-2.7`); the report aggregates pass/fail per control and flags unmapped violations.

All additive, re-exported from the `elsium-ai` umbrella. No existing types or APIs change. The package stays backend-agnostic — the attestation secret and approver identity are caller-supplied, with no coupling to a DB, RBAC layer, or cloud service.
