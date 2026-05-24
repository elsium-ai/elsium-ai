---
'@elsium-ai/gateway': minor
---

Add `generateObject<T>()` as the canonical typed structured-output API, aligned with the rest of the AI ecosystem (Vercel AI SDK, Mastra). Two forms ship: a gateway method `gw.generateObject(request)` returning `{ object, response }`, and a standalone `generateObject(options)` function for one-shot calls that accepts either `messages` or a `prompt` shorthand. `gw.generate()` is retained as a deprecated alias returning `{ data, response }` so existing callers keep working unchanged.
