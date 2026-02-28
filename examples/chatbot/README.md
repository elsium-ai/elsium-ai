# Chatbot Example

A simple conversational chatbot with memory and cost tracking.

## Run

```bash
export ANTHROPIC_API_KEY=your-key
bun examples/chatbot/index.ts
```

## What it demonstrates

- `@elsium-ai/gateway` — LLM provider connection
- `@elsium-ai/agents` — Agent with system prompt and memory
- `@elsium-ai/observe` — Tracing and cost tracking
- Sliding-window memory (keeps last 20 messages)
- Token budget guardrails
