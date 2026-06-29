---
"@elsium-ai/agents": minor
"@elsium-ai/gateway": minor
---

Strengthen built-in guardrails so the framework is self-sufficient without external tools, while keeping an open port for external integrations.

- **Evasion-resistant detection** (`@elsium-ai/gateway`) — `detectPromptInjection`/`detectJailbreak` now normalize input before matching: strip zero-width characters, fold common Cyrillic/Greek homoglyphs to ASCII, collapse whitespace, and decode embedded base64 payloads to scan them too. Pure, dependency-free, edge-safe. Exposed via `normalizeForDetection` and `expandForDetection` for reuse. The agent-level detector (`createAgentSecurity`) uses the same normalization.
- **Built-in LLM guardrail** (`@elsium-ai/agents`) — `createLLMGuardrail({ complete })` returns an `InputGuardrail` backed by the LLM you already use through the gateway, giving higher-precision injection/jailbreak detection with no extra install (configurable `onError` fail-open/closed). It plugs directly into `AgentSecurityConfig.injectionClassifier`.
- **Open extension port** — `injectionClassifier` (type `InputGuardrail`) is the integration point: use the built-in heuristic, the built-in LLM guardrail, or your own function wrapping Lakera/NeMo/Rebuff/Presidio. Self-sufficient by default; external integration is the caller's choice, not a dependency.

All changes are backward-compatible.
