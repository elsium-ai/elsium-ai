---
'@elsium-ai/observe': minor
---

Add Verifiable Agent Execution (α-1) — `createProofRecorder` produces signed `ExecutionProof` documents for each agent run, with hash-chained events (LLM calls, tool calls, RAG retrievals, policy decisions, agent input/output). A new `verifyProof(proof, keyRegistry)` standalone lets any third party verify the full chain and signature offline using only the public key. Optional persistence to a `WriteOnceStore` makes the artifact tamper-evident at rest. Includes a gateway `Middleware` that auto-records LLM calls when `metadata.proofSessionId` is set on the request.
