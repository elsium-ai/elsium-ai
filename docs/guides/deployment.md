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
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json bun.lockb ./
RUN npm install --production=false

COPY . .
RUN npm run build

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
import { createApp } from '@elsium-ai/app'
import { createGateway } from 'elsium-ai/gateway'
import { costTrackingMiddleware, xrayMiddleware } from 'elsium-ai/observe'

const gateway = createGateway({
  providers: {
    anthropic: { apiKey: process.env.ANTHROPIC_API_KEY! },
    openai: { apiKey: process.env.OPENAI_API_KEY! },
  },
  middleware: [costTrackingMiddleware(), xrayMiddleware()],
})

const app = createApp({
  gateway,
  auth: {
    type: 'bearer',
    tokens: [process.env.API_TOKEN!],
  },
  cors: {
    origin: ['https://your-app.com'],
    methods: ['GET', 'POST'],
  },
  rateLimit: {
    windowMs: 60_000,
    maxRequests: 100,
  },
})

app.listen(Number(process.env.PORT) || 3000)
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
- **Agent memory** — use an external store (Redis, database) for conversation history if scaling beyond a single instance.
- **Connection pooling** — the gateway manages provider connections internally. Each instance maintains its own pool.

```ts
// Example: external memory store for multi-instance deployments
const agent = createAgent({
  gateway,
  memory: createMemory({
    store: redisStore({ url: process.env.REDIS_URL }),
    maxMessages: 50,
  }),
})
```

---

## Graceful Shutdown

Use `createShutdownManager` to ensure in-flight requests complete before the process exits:

```ts
import { createShutdownManager } from 'elsium-ai/core'

const shutdown = createShutdownManager({
  timeoutMs: 15_000,
  onShutdown: async () => {
    await gateway.close()
    await db.disconnect()
  },
})

// Registers SIGTERM and SIGINT handlers automatically
shutdown.register()
```

In Docker or Kubernetes, make sure the `STOPSIGNAL` is `SIGTERM` (the default) and the termination grace period is longer than `timeoutMs`.

---

## Logging Configuration

In production, use structured JSON logging for machine-parseable output:

```ts
import { createLogger, configureLogging } from 'elsium-ai/core'

configureLogging({
  level: process.env.ELSIUM_LOG_LEVEL ?? 'info',
  format: 'json',
})

const log = createLogger()

// Output: {"level":"info","msg":"Server started","port":3000,"ts":"2026-03-04T..."}
log.info('Server started', { port: 3000 })
```

Pipe JSON logs to your log aggregator (CloudWatch, Loki, Datadog Logs). Use child loggers to attach request-scoped context like trace IDs:

```ts
const reqLog = log.child({ traceId: req.headers['x-trace-id'] })
reqLog.info('Processing request', { path: req.url })
```

Set `level: 'warn'` in production to reduce noise, or `level: 'debug'` temporarily when investigating issues.
