---
'@elsium-ai/core': patch
---

zodToJsonSchema: ZodDefault now emits the default value in JSON Schema output (e.g. `{ type: 'string', default: 'hello' }`) instead of omitting it. This makes default values visible to LLM tool-calling schemas.
