---
"@elsium-ai/observe": minor
"@elsium-ai/cli": minor
---

Add the AI-BOM — a signed declaration of what an agent is made of.

A lockfile pins `zod@3.24.0` and says nothing about which model answers, which
prompt steers it, or what the agent may execute. Those are the real dependencies
of an AI system, and until now nothing pinned them.

New in `@elsium-ai/observe`:

- `generateAiBom(input, { signer })` — collects models (provider, snapshot,
  region), prompts, tools (schema hash, sandbox capabilities, side-effect level,
  approval requirement), MCP servers, eval datasets, policy bundles, thresholds
  and runtime into one Ed25519-signed manifest. Deterministic and
  order-independent: the same composition always yields the same
  `componentsHash`.
- `verifyAiBom(bom, registry)` — offline verification of the component hash, the
  header digest, and the signature. Returns `checked` alongside the verdicts, so
  a check that never ran is never reported as a failed one.
- `diffAiBom(approved, current)` + `passesGate(diff, failOn)` — composition drift
  ranked by whether the blast radius grew. Adding a tool, widening a sandbox
  capability, dropping an approval gate, moving a model across regions or
  demoting a policy to monitor-only are `critical`; a prompt revision or a
  retuned threshold is `major`; a framework bump is `minor`.

New in `@elsium-ai/cli`:

- `elsium bom verify <bom.json> --public-key <pem>` — offline verification.
- `elsium bom diff <approved.json> <current.json> --fail-on critical` — the
  release gate. Exits non-zero when the shipped agent is not the agent that was
  signed off on.

Component sources are accepted structurally, so a real `Tool` or `DatasetManifest`
can be passed directly while `observe` keeps depending on `core` alone.

Where a proof records one run, a BOM records the composition every run inherits.
