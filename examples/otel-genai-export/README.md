# OTel GenAI export example

Generates a few spans (LLM, tool, agent, workflow), converts them to OTLP-shaped objects, and prints the resulting attributes under both emission modes side by side. No external collector required — this is a pure local script.

## Run

```bash
# Default — legacy elsium.* attributes
bun examples/otel-genai-export/index.ts

# Opt-in — experimental gen_ai.* attributes
OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental bun examples/otel-genai-export/index.ts
```

The script also runs both modes back-to-back in a single execution so you can diff the output without re-running.

## What you should see

**Default (legacy):**

```
[llm span] attributes:
  elsium.span.kind         = "llm"
  elsium.provider          = "anthropic"
  elsium.model             = "claude-sonnet-4-6"
  elsium.inputTokens       = 142
  elsium.outputTokens      = 87
```

**With `OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental`:**

```
[llm span] attributes:
  gen_ai.system              = "anthropic"
  gen_ai.operation.name      = "chat"
  gen_ai.request.model       = "claude-sonnet-4-6"
  gen_ai.usage.input_tokens  = 142
  gen_ai.usage.output_tokens = 87
```

Notice: when opt-in is on, no `elsium.*` attributes are present on the LLM span. Workflow and custom spans (without a GenAI mapper) gracefully fall back to legacy `elsium.*` so you don't lose data.

## Sending to a real OTel collector

To export to a local Jaeger / Grafana Tempo / Datadog Agent / Honeycomb, swap the `console.log` for the real exporter — see commented section at the bottom of `index.ts`.
