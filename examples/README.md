# ElsiumAI Examples

Runnable examples that show how to use each piece of the framework. Most run without API keys (mocks or local-only); a few need `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_API_KEY` as noted in their READMEs.

## Foundations

| Example | What it shows | Needs key |
|---|---|---|
| [`generate-object/`](./generate-object/) | Typed structured outputs (`gateway.generateObject`, standalone, `extract`) | yes |
| [`chatbot/`](./chatbot/) | Minimal agent + tools | yes |
| [`multi-agent/`](./multi-agent/) | Sequential / parallel / supervisor orchestration | yes |
| [`rag-app/`](./rag-app/) | RAG pipeline (loader → chunker → embeddings → vector store → query) | yes |
| [`api-server/`](./api-server/) | Expose an agent as an HTTP server | optional |
| [`mcp-integration/`](./mcp-integration/) | Connect to an MCP server (stdio + trust framework) | yes |

## Reliability & trust

| Example | What it shows | Needs key |
|---|---|---|
| [`verifiable-agent-execution/`](./verifiable-agent-execution/) | α-1 + α-2 — capture an agent run as a signed `ExecutionProof`, verify offline with `elsium verify` | yes |
| [`capability-tokens/`](./capability-tokens/) | β-1 + β-2 — mint scoped tokens, gate tools, delegate subset, revoke | no |
| [`verification-pipeline/`](./verification-pipeline/) | VAG — `runWithVerification` with Zod schema + business-rule validators + repair loop | yes |
| [`confidence-strategies/`](./confidence-strategies/) | CAG — `selfConsistency`, `judgeEnsemble`, `logprobScore`, `requireConfidence` with custom escalation | yes |
| [`tool-contracts/`](./tool-contracts/) | Tool contracts — `sideEffectLevel`, idempotency cache, preconditions, `dryRun` | no |
| [`ask-human/`](./ask-human/) | `askHuman` — responder mode + durable store mode + timeout | no |
| [`input-guardrails/`](./input-guardrails/) | Redact secrets/PII from input before the model · `injectionClassifier` · tool-arg redaction | no |
| [`reproducible-run/`](./reproducible-run/) | Seed propagation (`defineAgent({ seed })`) + `assertDeterministic` + `pinOutput` | no |
| [`judge-alignment/`](./judge-alignment/) | Is your LLM-judge trustworthy? — agreement + Cohen's kappa vs human labels + self-consistency | no |

## Streaming & routing

| Example | What it shows | Needs key |
|---|---|---|
| [`thinking-stream/`](./thinking-stream/) | `thinking_start/delta/end` events from Anthropic extended thinking + OpenAI reasoning models | yes |
| [`typed-tool-stream/`](./typed-tool-stream/) | `withToolTypes` — accumulate tool-call deltas and emit Zod-validated, per-tool-typed `tool_call_complete` events | no |
| [`carg-cascade/`](./carg-cascade/) | CARG — cascade router with classifier-based tier filtering and `escalateOnFailure` hooks | yes |

## Dev tooling

| Example | What it shows | Needs key |
|---|---|---|
| [`replay-from/`](./replay-from/) | `createTraceRecorder` + `replayFrom` — record a run, replay from any step with `replace` / `transform` overrides | no |

## Observability

| Example | What it shows | Needs key |
|---|---|---|
| [`cost-tracking/`](./cost-tracking/) | Multi-tenant cost engine + budget enforcement | yes |
| [`otel-genai-export/`](./otel-genai-export/) | OpenTelemetry GenAI semantic conventions export | optional |
| [`integration-test/`](./integration-test/) | Full e2e (mock + real) for a typical agent workflow | optional |

## How to run

All examples assume a clean clone of the repo with `bun install` done at the root. Then:

```bash
bun examples/<name>/index.ts
```

Most examples respect a `PROVIDER` env var (`anthropic` | `openai` | `google`) to pick the model family — see each example's README.
