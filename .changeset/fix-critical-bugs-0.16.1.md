---
'elsium-ai': patch
'@elsium-ai/app': patch
'@elsium-ai/observe': patch
'@elsium-ai/agents': patch
---

Fix four critical bugs landed in 0.16.0:

- **`elsium-ai` umbrella**: re-export 12 public symbols that were already shipped by `@elsium-ai/core` and `@elsium-ai/agents` but missing from the umbrella barrel: `pauseAgent`, `AgentPauseSignal`, `isAgentPauseSignal`, `createInMemoryStateStore`, `askHuman`, `createInMemoryAskHumanStore`, `resolveAskHuman`, `runResumable`, `resumeAgent`, `schemaValidator`, `judgeValidator`, `withVerifiers` (plus their accompanying types). Code that imported these from `'elsium-ai'` was receiving `undefined` at runtime.

- **`@elsium-ai/app` rate limiter**: the rate-limit middleware fell back to the `X-Real-IP` header when `CF-Connecting-IP` was absent. Because `X-Real-IP` is set by the client when no validated proxy stripped it, an attacker could vary the header per request to bypass the limit entirely. `X-Real-IP` is removed from the default trusted-header list; a new `trustedProxyHeaders` config option lets deployments behind other proxies opt into specific headers explicitly. Anonymous traffic now shares the `anonymous` bucket (which still rate-limits in aggregate) instead of splintering by a forgeable header.

- **`@elsium-ai/observe` cost engine**: `trackCall()` accumulated `response.cost.totalCost` and `response.usage.totalTokens` without guarding for `undefined`/`NaN`. A single response without pricing data poisoned `totalSpend` to `NaN` permanently, breaking every subsequent budget alert and cost report on that engine. Reads are now guarded with `Number.isFinite` and missing values count as zero.

- **`@elsium-ai/agents` cost accumulators**: same NaN-propagation guard added to `agent.ts`, `state-machine.ts`, and `react.ts`, which were each independently summing `response.cost.totalCost` / `response.usage.{input,output}Tokens` without validation.
