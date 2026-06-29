---
"@elsium-ai/agents": minor
---

Propagate a reproducibility seed from the agent to every LLM request.

`CompletionRequest` already supported `seed`, but the agent never forwarded one —
callers had to inject it into each request by hand, which made `assertDeterministic`
and bit-exact proof comparison impractical.

- `AgentConfig.seed` — set once, forwarded to every `CompletionRequest` in the
  loop (and in streaming).
- `AgentRunOptions.seed` — per-run override; falls back to `AgentConfig.seed`.

Because the seed now travels in every request, it is captured in the request hash
of signed `ExecutionProof`s and can be fixed across runs for `assertDeterministic`.
Honored by providers that support seeding; backward-compatible (no seed → unchanged).
