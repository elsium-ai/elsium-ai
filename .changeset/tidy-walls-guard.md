---
'@elsium-ai/tools': minor
---

Harden the tool sandbox so it no longer forwards the host `process.env` to sandboxed handlers. Both `worker` and `process` modes now run with a minimal allow-listed environment, preventing tool code (including LLM-generated or third-party handlers) from reading host secrets such as API keys and tokens via `process.env`.

A new optional `sandbox.env` config explicitly passes through only the variables a handler genuinely needs:

```ts
defineTool({
  name: 'fetch-data',
  sandbox: { mode: 'process', handler, env: { MY_FLAG: 'on' } },
})
```

This makes the previously documented "sandbox has its own env" guarantee actually hold. Tools that relied on inheriting the full host environment must now declare the variables they need via `sandbox.env`.
