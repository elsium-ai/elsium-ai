# @elsium-ai/cli

## 0.19.0

### Minor Changes

- c80ee8c: Add the AI-BOM — a signed declaration of what an agent is made of.

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

### Patch Changes

- Updated dependencies [c80ee8c]
- Updated dependencies [8bf8ecb]
  - @elsium-ai/observe@0.19.0
  - @elsium-ai/core@0.19.0
  - elsium-ai@0.19.0

## 0.18.0

### Patch Changes

- elsium-ai@0.18.0
- @elsium-ai/core@0.18.0
- @elsium-ai/observe@0.18.0

## 0.17.0

### Patch Changes

- elsium-ai@0.17.0
- @elsium-ai/core@0.17.0
- @elsium-ai/observe@0.17.0

## 0.16.1

### Patch Changes

- Updated dependencies [c51a981]
  - elsium-ai@0.16.1
  - @elsium-ai/observe@0.16.1
  - @elsium-ai/core@0.16.1

## 0.16.0

### Patch Changes

- Updated dependencies [6c7de04]
- Updated dependencies [d7dd4f7]
  - elsium-ai@0.16.0
  - @elsium-ai/core@0.16.0
  - @elsium-ai/observe@0.16.0

## 0.15.0

### Minor Changes

- 6491511: Add Verifiable Agent Execution (α-2) — offline CLI verification and proof comparison. New `compareProofs(a, b, { strategy })` in `@elsium-ai/observe` diffs two `ExecutionProof`s under `bit-exact` (every event's `hashSelf` must match — requires `temperature: 0` + `seed`) or `structural` (same event order/types; `tool.call`/`rag.retrieve`/`policy.evaluated` data must match exactly, `llm.call` compared by `model`+`provider` only). New `elsium verify <proof.json> [--public-key|--trust-roots]` recomputes the chain and verifies the Ed25519 signature offline using only the trusted public key; supports `--json` and `--quiet`. New `elsium replay <a.json> <b.json> [--strategy]` compares two proofs and exits non-zero when they diverge. Together these let any third party download a proof from another machine and verify what an agent did without API keys or network access.

### Patch Changes

- Updated dependencies [35bad42]
- Updated dependencies [6491511]
- Updated dependencies [6a9adac]
- Updated dependencies [409ab6f]
- Updated dependencies [0bfee9e]
- Updated dependencies [11126a4]
- Updated dependencies [dabe46d]
- Updated dependencies [ea71268]
- Updated dependencies [09ae00a]
  - @elsium-ai/core@0.15.0
  - @elsium-ai/observe@0.15.0
  - elsium-ai@0.15.0

## 0.14.0

### Patch Changes

- elsium-ai@0.14.0
- @elsium-ai/core@0.14.0
- @elsium-ai/observe@0.14.0

## 0.13.0

### Patch Changes

- Fixed-group version bump in lockstep with the 0.13.0 framework release. CLI is intentionally Node-only — no edge-runtime migration applies.
- Updated dependencies — `@elsium-ai/core`, `@elsium-ai/observe`, `elsium-ai`

## 0.12.1

### Patch Changes

- Updated dependencies [6a0eb78]
  - elsium-ai@0.12.1
  - @elsium-ai/core@0.12.1
  - @elsium-ai/observe@0.12.1

## 0.12.0

### Patch Changes

- Updated dependencies [f37daa1]
  - elsium-ai@0.12.0
  - @elsium-ai/core@0.12.0
  - @elsium-ai/observe@0.12.0

## 0.11.0

### Patch Changes

- Updated dependencies [a1bbd80]
  - @elsium-ai/observe@0.11.0
  - elsium-ai@0.11.0
  - @elsium-ai/core@0.11.0

## 0.2.1

### Patch Changes

- Fix publish pipeline: resolve `workspace:*` to real versions before npm publish. v0.2.0 shipped with unresolved `workspace:*` dependencies making it uninstallable outside the monorepo.
- Updated dependencies
  - @elsium-ai/core@0.2.1
  - @elsium-ai/observe@0.2.1

## 0.2.0

### Minor Changes

- a1af089: Switch build target from `--target bun` to `--target node` for cross-runtime compatibility (Node.js, Bun, Deno). Replace `Bun.serve()` with `@hono/node-server`. Replace `bun-types` with `@types/node`. Remove `priority` field from `ProviderEntry` — array order now determines provider priority.

### Patch Changes

- Updated dependencies [a1af089]
  - @elsium-ai/core@0.2.0
  - @elsium-ai/observe@0.2.0

## 0.1.7

### Patch Changes

- e1eccb4: Add README files to all packages for npm listing
- Updated dependencies [e1eccb4]
  - @elsium-ai/core@0.1.7
  - @elsium-ai/observe@0.1.7
