# input guardrails — redact secrets/PII before the model sees them

Input-side guardrails sanitize user input *before* it reaches the provider.
Secret/PII redaction used to run only on model responses; this closes the input
gap. All of it is opt-in via `AgentSecurityConfig`.

## What this example shows

- **Input redaction** — `redactInputSecrets` + `redactInputPii` strip API keys,
  emails, and phone numbers from the prompt before the model call.
- **`injectionClassifier`** — a pluggable async detector (swap in an LLM-backed
  check) that rejects suspicious input before any model call happens.
- **Tool-arg redaction** — `redactToolArgSecrets` removes secrets from tool-call
  arguments before the tool runs and before they are recorded in the trace.

## Self-sufficient by default, open to external tools

The heuristic detector resists common evasion out of the box — it strips
zero-width characters, folds homoglyphs (`іgnоre` → `ignore`), and decodes
base64 payloads before matching. No external install. Measured, not asserted:
`bun benchmarks/guardrail-detection.ts` reports detection across evasion
categories and false positives on benign near-misses (internal adversarial set).

For higher precision, the built-in `createLLMGuardrail` uses the LLM you already
configured — still nothing extra to install:

```typescript
import { createLLMGuardrail } from '@elsium-ai/agents'
import { gateway } from '@elsium-ai/gateway'

const llm = gateway({ provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY })

const agent = defineAgent({
  name: 'guarded',
  system: '...',
  guardrails: {
    security: { injectionClassifier: createLLMGuardrail({ complete: (r) => llm.complete(r) }) },
  },
})
```

`injectionClassifier` (type `InputGuardrail`) is the extension port. Want to use
Lakera / NeMo Guardrails / Rebuff / Presidio instead? Pass your own function —
the framework never depends on them, integrating is your choice:

```typescript
guardrails: { security: { injectionClassifier: async (input) => myLakeraClient.isMalicious(input) } }
```

The mock provider echoes back what it received, so you can see exactly what
survived the input pipeline.

## Run

```bash
bun examples/input-guardrails/index.ts
```

No API key needed — self-contained with a mock provider.

## Gateway-level equivalent

For redaction shared across every agent/workflow that routes through the gateway,
use the middleware instead:

```typescript
import { gateway, securityMiddleware } from '@elsium-ai/gateway'

const llm = gateway({
  provider: 'anthropic',
  apiKey: process.env.ANTHROPIC_API_KEY,
  middleware: [securityMiddleware({ redactInput: true, piiTypes: ['email', 'phone'] })],
})
```
