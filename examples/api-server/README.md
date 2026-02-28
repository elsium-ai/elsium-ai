# API Server Example

An HTTP server exposing multiple agents with custom tools, middleware, and observability.

## Run

```bash
# Works in mock mode without API key
bun examples/api-server/index.ts

# With real LLM responses
export ANTHROPIC_API_KEY=your-key
bun examples/api-server/index.ts
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Health check |
| GET | /metrics | Token and cost metrics |
| GET | /agents | List registered agents |
| POST | /chat | Chat with a specific agent |
| POST | /complete | Raw LLM completion |

## What it demonstrates

- `@elsium-ai/app` — HTTP server with CORS and rate limiting
- `@elsium-ai/agents` — Multiple agents (assistant, coder)
- `@elsium-ai/tools` — Custom tools (weather, calculator)
- `@elsium-ai/observe` — Tracing and cost tracking
- `@elsium-ai/gateway` — Provider abstraction with fallback to mock
