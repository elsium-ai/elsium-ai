# @elsium-ai/observe

Observability, tracing, cost tracking, and audit trail for [ElsiumAI](https://github.com/elsium-ai/elsium-ai).

[![npm](https://img.shields.io/npm/v/@elsium-ai/observe.svg)](https://www.npmjs.com/package/@elsium-ai/observe)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE)

## Install

```bash
npm install @elsium-ai/observe @elsium-ai/core
```

## What's Inside

- **Tracing** — Span-based tracing with nested context propagation
- **Cost Intelligence** — Budget tracking, projections, and loop detection
- **Audit Trail** — SHA-256 hash-chained events with tamper-proof integrity verification
- **Provenance Tracking** — Full lineage per traceId: prompt, model, config, input, output
- **Audit Middleware** — Drop-in middleware for automatic event recording

## Usage

```typescript
import { createAuditTrail, auditMiddleware, createProvenanceTracker, observe } from '@elsium-ai/observe'

// Hash-chained audit trail
const audit = createAuditTrail({ hashChain: true })

// Provenance tracking
const provenance = createProvenanceTracker()
provenance.record({ prompt, model, config, input, output, traceId })

// Tracing
const tracer = observe({ output: [], samplingRate: 1.0 })
const span = tracer.startSpan('request', 'llm-call')
// ... do work ...
span.end()
```

## Part of ElsiumAI

This package is the observability layer of the [ElsiumAI](https://github.com/elsium-ai/elsium-ai) framework. See the [full documentation](https://github.com/elsium-ai/elsium-ai) for guides and examples.

## License

[MIT](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE)
