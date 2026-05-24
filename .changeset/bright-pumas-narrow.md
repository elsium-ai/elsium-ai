---
'@elsium-ai/core': minor
---

Add `withToolTypes(stream, schemas)` — a stream wrapper that accumulates the raw `tool_call_delta` JSON fragments per `toolCallId`, parses + validates them against a per-tool Zod schema on `tool_call_end`, and emits a new typed `tool_call_complete` event whose `toolCall.arguments` is narrowed by the tool name. The wrapper closes the second half of the "streaming estructurado tipado" critical (Fase B of #2): callers branch on `event.toolCall.name` and get full Zod inference for the arguments per branch. On parse failure (invalid JSON or schema mismatch), an `UnknownToolCallComplete` variant is emitted with `parseError.{ reason, raw }` so callers can branch. The original `StreamEvent` union is unchanged — this is purely additive and opt-in. Lives in `@elsium-ai/core` so any package (gateway, agents, app) can use it.
