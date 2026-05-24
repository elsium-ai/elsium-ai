---
'@elsium-ai/core': minor
'@elsium-ai/gateway': minor
---

Add typed thinking / reasoning stream events. The `StreamEvent` discriminated union now includes `thinking_start`, `thinking_delta` (with `text`), and `thinking_end`, so consumers narrow on `event.type` and get full autocompletion for the model's internal reasoning the same way they already do for `text_delta` and `tool_call_*`. `TokenUsage` gains `reasoningTokens?` for OpenAI o-series billing visibility. `CompletionRequest` gains a `thinking?: { enabled?, budgetTokens?, effort? }` config that the Anthropic provider translates to `thinking: { type: 'enabled', budget_tokens }` (deriving the budget from `effort: 'low' | 'medium' | 'high'` when `budgetTokens` is omitted), and the OpenAI provider translates to `reasoning_effort`. The Anthropic stream parser maps the `content_block_start/delta/stop` events whose blocks are of type `thinking` into the new typed events; the OpenAI stream parser captures `completion_tokens_details.reasoning_tokens` into `state.usage.reasoningTokens` so the final `message_end` event surfaces it. Documented in the gateway README with a full event table.
