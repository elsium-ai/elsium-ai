# Verification-Augmented Generation (VAG)

`runWithVerification` turns "generate then hope" into a contract: `generate → validate → repair-or-abort`, with the validator's failure formatted as a repair prompt re-injected into the next call so the model fixes the specific issue.

## What this example shows

- A Zod schema validator that rejects bad output.
- A custom `externalValidator` (business rule: total must equal sum of line items).
- `composeValidators` aggregating both.
- The repair loop in action: first attempt returns broken output → validator reports → next attempt receives the formatted repair prompt → model fixes it.

## Run

```bash
export ANTHROPIC_API_KEY=your-key
bun examples/verification-pipeline/index.ts
```

## When to use

- **Structured extraction** where the schema cannot be enforced at sampling time (older models, providers without strict JSON mode).
- **Business rules** beyond what a schema can express (sum invariants, cross-field consistency, external lookups).
- **Defense in depth** against models that "almost" comply but break a constraint.
