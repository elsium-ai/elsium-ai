# Tool Contracts — sideEffectLevel + idempotency + preconditions + dry-run

`ToolConfig` accepts four extra fields that turn a tool from "run handler, hope" into something the framework can reason about for safety: `sideEffectLevel`, `idempotencyKey + idempotencyStore`, `preconditions`, and `dryRunHandler`.

## What this example shows

- A `transferFunds` tool declared as `'destructive'` with a `dryRunHandler` preview.
- Idempotency via `txId` — the second call with the same key returns the cached output (no double-charge).
- Preconditions (balance check + KYC) that block the handler with structured `preconditionFailures`.
- Dry-run mode — skips the destructive handler and returns the preview with `dryRun: true`.

## Run

```bash
bun examples/tool-contracts/index.ts
```

No API key needed — example uses an in-memory fake bank so the contract semantics are the focus.
