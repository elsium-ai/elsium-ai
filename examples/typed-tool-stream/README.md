# `withToolTypes` — typed tool call arguments

Raw `tool_call_delta` events stream JSON fragments as strings. `withToolTypes(stream, schemas)` accumulates them per `toolCallId`, parses + Zod-validates on `tool_call_end`, and emits a new `tool_call_complete` event whose `toolCall.arguments` is **narrowed per tool name** via a mapped type.

## What this example shows

- A two-tool schema map (`get_weather`, `search`) with distinct Zod shapes.
- The full discriminated narrowing: branching on `event.toolCall.name` narrows `event.toolCall.arguments` to the inferred Zod shape — autocomplete-friendly without casts.
- The `UnknownToolCallComplete` variant when validation fails (bad JSON or schema mismatch).
- Original `tool_call_start/delta/end` events still pass through; `tool_call_complete` is purely additive.

## Run

```bash
bun examples/typed-tool-stream/index.ts
```

No API key needed — example uses a synthetic event stream so it runs in any environment.
