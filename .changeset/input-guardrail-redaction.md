---
"@elsium-ai/agents": minor
"@elsium-ai/gateway": minor
---

Add input-side guardrails: redact secrets and PII from prompts before they reach the model.

Previously secret/PII redaction only ran on model responses. Input was scanned for
prompt injection/jailbreak but never sanitized, so secrets and PII in user input were
sent verbatim to the provider.

- **`@elsium-ai/gateway`** — `securityMiddleware` gains a `redactInput` option that
  redacts secrets (and any configured `piiTypes`) from the outgoing system prompt and
  input messages before the provider call.
- **`@elsium-ai/agents`** — `AgentSecurityConfig` gains `redactInputSecrets`,
  `redactInputPii`, `injectionClassifier` (optional async/LLM-backed detector), and
  `redactToolArgSecrets`. `createAgentSecurity` exposes a new `sanitizeInput` method.
  The agent now runs an ordered input pipeline — detection (throws) → async classifier
  (throws) → redaction (transform) — on `run`, `chat`, and `generate`. `stream` applies
  synchronous redaction only. Tool-call arguments can optionally have secrets redacted
  before execution and trace recording.

All new behavior is opt-in; existing agents are unaffected.
