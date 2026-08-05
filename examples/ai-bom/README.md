# AI-BOM — a signed declaration of what an agent is made of

A lockfile pins `zod@3.24.0`. It says nothing about which model answers, which
prompt steers it, or what the agent is allowed to execute — the things that
actually determine how an AI system behaves.

The AI-BOM pins those, signs them, and fails CI when they drift from what was
approved.

## What this example shows

1. `generateAiBom(...)` → an Ed25519-signed manifest of models, prompts, tools
   (with their sandbox capabilities), datasets, policies and thresholds.
2. `verifyAiBom(bom, registry)` → offline verification with only the public key.
3. Determinism — regenerating the same composition yields the same
   `componentsHash`, so registration order never reads as a change.
4. A Friday-afternoon change (a tool that moves money, an edited prompt, a
   lowered confidence floor) caught by `diffAiBom` + `passesGate`.
5. Tampering with a component breaks verification.

## Run

```bash
bun examples/ai-bom/index.ts
```

## In CI

```bash
elsium bom verify ./aibom.json --public-key ./release.pub
elsium bom diff ./approved-bom.json ./aibom.json --fail-on critical
```

`bom diff` exits non-zero when drift lands at or above `--fail-on`, so the gate
is one line in a workflow. Add `--verify` to check both manifests' signatures
before comparing — a diff against an unverified baseline proves nothing.

## Severity, and why it is ranked that way

Severity answers one question: did the blast radius grow, or did a control get
weaker?

- **critical** — a tool was added, a sandbox capability widened, an approval
  requirement dropped, a model moved region, a policy removed or demoted to
  monitor-only.
- **major** — behaviour changes but the boundary held: a prompt revision, a
  retuned threshold, a provider reshipping the same model name.
- **minor** — descriptive only: framework bumps, edited descriptions.

A removed tool is `major`; a removed policy is `critical`. Losing a capability
is a correctness problem, losing a control is a security one.

## The point

Someone edits a system prompt on a Friday and ships. Tests still pass, because
the tests never encoded the prompt. The BOM notices: the hash changed and nobody
re-approved it.

And when an auditor asks what the system was made of on the day a decision was
made, the answer is a signed document rather than a stale Confluence page.
