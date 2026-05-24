# Thinking / reasoning stream events

Opt-in via `thinking: { enabled: true, budgetTokens?, effort? }` on the `CompletionRequest`. The gateway translates the config into Anthropic's `thinking: { type: 'enabled', budget_tokens }` and OpenAI's `reasoning_effort`. The stream emits new `thinking_start` / `thinking_delta` / `thinking_end` event types alongside the existing `text_delta` and `tool_call_*` events.

## What this example shows

- Opt-in thinking config (`budgetTokens` for Anthropic, `effort` for OpenAI).
- Discriminated `StreamEvent` narrowing — `event.type === 'thinking_delta'` narrows to `{ text }`.
- `usage.reasoningTokens` on `message_end` (where the provider reports it).

## Run

```bash
export ANTHROPIC_API_KEY=your-key
bun examples/thinking-stream/index.ts
```

For OpenAI o-series, internal reasoning is **not** streamed (private), but `usage.reasoningTokens` is reported on completion. Anthropic streams the thinking text live when extended thinking is enabled.
