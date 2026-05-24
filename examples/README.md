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
