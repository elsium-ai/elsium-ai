# OpenTelemetry GenAI Semantic Conventions in ElsiumAI

ElsiumAI emits OpenTelemetry traces using the official [GenAI Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/) when you opt in. This guide explains the dual-emission model, why it exists, and how to wire it up.

## Why dual emission

The OTel GenAI Semantic Conventions are in **Development** status as of May 2026 — not stable. From the spec:

> *"This transition plan will be updated to include stable version before the GenAI conventions are marked as stable."*

The same spec mandates that instrumentations gate experimental attributes behind the environment variable:

```
OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental
```

ElsiumAI follows this contract literally:

- **Default (no opt-in)**: only legacy `elsium.*` attributes are emitted. Existing consumers (Jaeger, Tempo, Honeycomb generic views) continue to work.
- **Opt-in (`gen_ai_latest_experimental`)**: `gen_ai.*` attributes are emitted. Legacy `elsium.*` are **not** emitted for the same span. Dashboards that understand GenAI conventions (Datadog v1.37, Grafana GenAI views, Langfuse, Traceloop) parse the spans as LLM traces, not generic ones.
- **Graceful fallback**: span kinds without a registered GenAI mapper (`workflow`, `custom`) fall back to legacy `elsium.*` so no data is lost.

This co-existence is preserved throughout v0.x. We will not flip the default until the OTel spec itself reaches Stable.

## Quick start — turn it on via env

```bash
export OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental
node my-app.js
```

That's it. Any `createOTLPExporter` or `toOTelSpan` call now emits `gen_ai.*`.

## Quick start — turn it on programmatically

```ts
import { createOTLPExporter } from 'elsium-ai'

const exporter = createOTLPExporter({
  endpoint: 'http://localhost:4318/v1/traces',
  semconv: { optIn: ['gen_ai_latest_experimental'] },
})
```

Explicit `optIn` overrides the env variable. Useful when you cannot control the host environment.

## What gets emitted

For a `kind: 'llm'` span with metadata `{ provider: 'anthropic', model: 'claude-sonnet-4-6', inputTokens: 100, outputTokens: 50 }`:

| Attribute | Value | Note |
|---|---|---|
| `gen_ai.system` | `"anthropic"` | required |
| `gen_ai.operation.name` | `"chat"` | required, defaults to `chat`, override via `metadata.operationName` |
| `gen_ai.request.model` | `"claude-sonnet-4-6"` | required |
| `gen_ai.usage.input_tokens` | `100` | |
| `gen_ai.usage.output_tokens` | `50` | |

For a `kind: 'tool'` span with name `weather` and metadata `{ toolCallId: 'call_1', toolType: 'function' }`:

| Attribute | Value |
|---|---|
| `gen_ai.tool.name` | `"weather"` |
| `gen_ai.tool.call.id` | `"call_1"` |
| `gen_ai.tool.type` | `"function"` |
| `gen_ai.operation.name` | `"tool.execute"` |

See [`docs/api-reference/observe.md`](../api-reference/observe.md#metadata-keys-consumed-by-built-in-mappers) for the full metadata schema each built-in mapper consumes.

## Custom mappers and spec versions

ElsiumAI ships mappers for spec **v1.36**. When the spec changes (it will, before Stable), register a new mapper without touching core:

```ts
import {
  createGenAIConventionRegistry,
  createOTLPExporter,
  type GenAIMapper,
} from 'elsium-ai'

const registry = createGenAIConventionRegistry('v1.37')

const myV137LLMMapper: GenAIMapper<'llm'> = {
  kind: 'llm',
  specVersion: 'v1.37',
  map(span) {
    // your mapping for the new spec shape
    if (typeof span.metadata.provider !== 'string') return null
    return {
      'gen_ai.system': span.metadata.provider,
      'gen_ai.operation.name': 'chat',
      'gen_ai.request.model': String(span.metadata.model ?? 'unknown'),
    }
  },
}

registry.register(myV137LLMMapper)

const exporter = createOTLPExporter({
  endpoint: 'http://localhost:4318/v1/traces',
  semconv: { optIn: ['gen_ai_latest_experimental'] },
  conventionRegistry: registry,
})
```

You can register multiple versions side by side and pin a different one as default:

```ts
registry.defaultVersion = 'v1.37'
registry.listVersions() // ['v1.36', 'v1.37']
```

## How it integrates with `toOTelSpan`

If you build OTLP payloads yourself, pass an explicit `EmissionPolicy`:

```ts
import { createEmissionPolicy, toOTelSpan } from 'elsium-ai'

const policy = createEmissionPolicy({ optIn: ['gen_ai_latest_experimental'] })

const otelSpan = toOTelSpan(mySpan, { emissionPolicy: policy })
```

Without options, `toOTelSpan` reads `process.env.OTEL_SEMCONV_STABILITY_OPT_IN` once per call. For hot paths, build the policy once and reuse.

## Producing GenAI-friendly spans from your code

The built-in mappers read `span.metadata`. Ensure your spans carry the expected keys:

```ts
import { observe } from 'elsium-ai'

const tracer = observe()
const span = tracer.startSpan('chat-completion', 'llm')

span.setMetadata('provider', 'anthropic')
span.setMetadata('model', 'claude-sonnet-4-6')
span.setMetadata('inputTokens', 100)
span.setMetadata('outputTokens', 50)
span.setMetadata('finishReasons', ['stop'])

span.end({ status: 'ok' })
```

If you forget `provider` or `model`, the GenAI mapper returns `null` and the span falls back to legacy `elsium.*` attributes. The export still succeeds — no data lost.

## End-to-end example

A runnable script that emits both legacy and GenAI traces side-by-side for comparison:

```bash
bun examples/otel-genai-export/index.ts
```

See [`examples/otel-genai-export/README.md`](../../examples/otel-genai-export/README.md).

## When will the default flip?

Not until the OTel GenAI spec reaches **Stable**. The transition plan published by OTel guarantees a stable-version annotation in the spec before the move. ElsiumAI will then deprecate `elsium.*` attributes with a clear migration window.

Until then, treat `gen_ai.*` as a forward-compatible opt-in and `elsium.*` as the production default.
