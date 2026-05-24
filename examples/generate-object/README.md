# `generateObject` — typed structured outputs

The canonical API for "give me a typed object, not raw text". Validates against a Zod schema and returns the parsed value with full inference. Works with every supported provider via its native structured-output mode (OpenAI `json_schema (strict)`, Anthropic forced tool-use, Google `responseSchema`).

## Run

```bash
export ANTHROPIC_API_KEY=your-key
bun examples/generate-object/index.ts
```

Or with OpenAI / Google:

```bash
export PROVIDER=openai  export OPENAI_API_KEY=your-key
bun examples/generate-object/index.ts
```

## What it shows

- `gateway.generateObject({ schema })` — typed return `{ object, response }`, full inference from Zod.
- Standalone `generateObject({ provider, apiKey, schema, prompt })` — one-shot without instantiating a Gateway.
- `gateway.extract(schema, input)` — convenience wrapper with auto-retry on validation failure.

## When to use

| Task | Use |
|---|---|
| One-shot extraction from a script | `generateObject` standalone |
| Long-running gateway with middleware (audit, X-Ray) | `gateway.generateObject` method |
| Quick extraction with auto-retry | `gateway.extract` |
