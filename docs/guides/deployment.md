# Production Deployment Guide

How to deploy an ElsiumAI application to production with proper security, observability, and scaling.

> This guide assumes you have a working ElsiumAI app (see [Getting Started](../getting-started.md)).

---

## Prerequisites

- **Node.js 20+** (LTS recommended)
- **npm**, **pnpm**, or **bun** for dependency management
- A deployed database or vector store if using RAG
- API keys for at least one LLM provider

---

## Environment Configuration

ElsiumAI reads provider credentials from environment variables. Set these for each provider you use:

```bash
# Required — at least one provider key
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=AIza...

# Optional — observability and app config
ELSIUM_LOG_LEVEL=info          # debug | info | warn | error
ELSIUM_ENV=production          # development | production
PORT=3000
```

Never commit API keys to source control. Use a secrets manager (AWS Secrets Manager, Vault, Doppler) or your platform's environment variable configuration.

---

## Docker Deployment

Use a multi-stage build to keep the production image small:

```dockerfile
# Stage 1 — install and build
FROM oven/bun:1-alpine AS builder
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

# Stage 2 — production image
FROM node:20-alpine AS runner
WORKDIR /app

RUN addgroup -S elsium && adduser -S elsium -G elsium

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

USER elsium
EXPOSE 3000

ENV NODE_ENV=production
ENV ELSIUM_ENV=production

CMD ["node", "dist/server.js"]
```

Build and run:

```bash
docker build -t elsium-app .
docker run -p 3000:3000 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e ELSIUM_LOG_LEVEL=info \
  elsium-app
```

---

## Production Configuration

Configure `createApp` with authentication, CORS, rate limiting, and observability:

```ts
import { createApp } from "@elsium-ai/app";

const app = createApp({
  gateway: {
    providers: {
      anthropic: { apiKey: process.env.ANTHROPIC_API_KEY! },
      openai: { apiKey: process.env.OPENAI_API_KEY! },
    },
    strategy: "fallback",
  },
  observe: {
    costTracking: true,
    tracing: true,
  },
  server: {
    cors: {
      origin: ["https://your-app.com"],
      methods: ["GET", "POST"],
    },
    auth: {
      type: "bearer",
      token: process.env.API_TOKEN!,
    },
    rateLimit: {
      windowMs: 60_000,
      maxRequests: 100,
    },
  },
});

app.listen(Number(process.env.PORT) || 3000);
```

---

## Health Checks and Monitoring

The `@elsium-ai/app` package exposes health and metrics endpoints by default:

```ts
// GET /health — returns 200 if the service is running
// Response: { status: "ok", uptime: 12345, version: "0.3.0" }

// GET /metrics — returns cost and request metrics
// Response: { requests: 1024, errors: 3, totalCost: 4.82, ... }
```

Point your load balancer or container orchestrator health check at `/health`. Use `/metrics` to feed dashboards (Grafana, Datadog, etc.) via a scraper or push gateway.

---

## Security Checklist

Before going live, verify every item:

- [ ] **API keys in environment variables** — never hardcoded, never in source control
- [ ] **CORS restricted** to known origins — no wildcard `*` in production
- [ ] **Rate limiting enabled** — protect against abuse and runaway costs
- [ ] **Authentication configured** — bearer tokens or API key auth on all endpoints
- [ ] **Content security** — enable PII detection middleware if handling user data
- [ ] **Unicode normalization** — applied automatically by the gateway security layer
- [ ] **SSRF protection** — URL validation enabled for any tool that fetches external resources
- [ ] **Budget limits set** — per-user and per-agent budgets to prevent cost overruns

---

## Scaling Considerations

ElsiumAI is designed to be **stateless** at the application layer:

- **Horizontal scaling** — run multiple instances behind a load balancer. No sticky sessions required.
- **External vector stores** — for RAG, use a managed vector database (Pinecone, Weaviate, pgvector) rather than in-memory stores.
- **Agent memory** — use shared storage or a custom external store adapter for conversation history if scaling beyond a single instance. The built-in SQLite store is best for single-instance persistence.
- **Connection pooling** — the gateway manages provider connections internally. Each instance maintains its own pool.

```ts
// Example: persistent memory for a single instance
import {
  createSqliteMemoryStore,
  defineAgent,
  type AgentDependencies,
} from "@elsium-ai/agents";
import { gateway } from "@elsium-ai/gateway";

const llm = gateway({
  provider: "anthropic",
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const deps: AgentDependencies = {
  complete: (request) => llm.complete(request),
  stream: (request) => llm.stream(request),
};

const memoryStore = createSqliteMemoryStore({
  path: process.env.MEMORY_DB_PATH ?? "./data/memory.db",
});

const agent = defineAgent(
  {
    name: "support",
    system: "You help users with production support questions.",
    memory: {
      strategy: "sliding-window",
      store: memoryStore,
      agentId: "support",
      maxMessages: 50,
    },
  },
  deps,
);
```

---

## Graceful Shutdown

Use `createShutdownManager` to ensure in-flight requests complete before the process exits:

```ts
import { createShutdownManager } from "@elsium-ai/core";

const shutdown = createShutdownManager({
  drainTimeoutMs: 15_000,
  onDrainStart: () => console.log("Draining in-flight requests"),
  onDrainComplete: () => console.log("All in-flight requests completed"),
  onForceShutdown: () =>
    console.warn("Shutdown timed out before all requests completed"),
});

async function handleRequest() {
  return "ok";
}

const response = await shutdown.trackOperation(handleRequest);
await shutdown.shutdown();
shutdown.dispose();
```

In Docker or Kubernetes, make sure the `STOPSIGNAL` is `SIGTERM` (the default) and the termination grace period is longer than `drainTimeoutMs`.

---

## Logging Configuration

In production, use structured JSON logging for machine-parseable output:

```ts
import { createLogger, type LogLevel } from "@elsium-ai/core";

const level = (process.env.ELSIUM_LOG_LEVEL ?? "info") as LogLevel;

const log = createLogger({ level, pretty: false });

// Output: {"level":"info","message":"Server started","timestamp":"2026-03-04T...","data":{"port":3000}}
log.info("Server started", { port: 3000 });
```

Pipe JSON logs to your log aggregator (CloudWatch, Loki, Datadog Logs). Use child loggers to attach request-scoped context like trace IDs:

```ts
import { createLogger } from "@elsium-ai/core";

const log = createLogger();
const req = {
  headers: { "x-trace-id": "trace-123" },
  url: "/chat",
};

const reqLog = log.child({ traceId: req.headers["x-trace-id"] });
reqLog.info("Processing request", { path: req.url });
```

Set `level: 'warn'` in production to reduce noise, or `level: 'debug'` temporarily when investigating issues.
