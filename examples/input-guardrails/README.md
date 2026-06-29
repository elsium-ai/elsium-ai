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
