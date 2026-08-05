---
"@elsium-ai/core": minor
"@elsium-ai/gateway": minor
"@elsium-ai/tools": minor
---

Add information-flow control — governance for the data, not just the caller.

Capability tokens answer "may this agent call this tool?". They say nothing
about what is inside the prompt by the time it does. Once a retrieved document
or a tool result enters the context it becomes undifferentiated text, and every
downstream decision is made blind.

New in `@elsium-ai/core`:

- `taint(value, init)` / `createLabel(init)` — attach provenance: sensitivity
  `classes`, an `origin` (`trusted` / `model` / `untrusted`), and `sources` for
  audit. `DataClass` is the same type capability tokens use, so a token
  permitting `pii` and a rule denying `pii` at the network refer to one thing.
- `joinLabels` / `joinAll` — least upper bound. Classes union, origin becomes
  the least trusted of the two. Commutative, associative, idempotent and
  monotonic: no sequence of merges can wash a taint out. That property is what
  the guarantee rests on.
- `createFlowPolicy(rules)` — deny-only rules matched on sink globs
  (`llm:*`, `tool:send_email`, `network:api.stripe.com`) and label conditions.
  Deny-only is deliberate: an allow/deny mix forces precedence reasoning, and
  precedence bugs in a security control fail open. A rule with no conditions
  throws rather than silently blocking everything.
- `lethalTrifectaRule()` — sensitive data + untrusted content + an outbound
  sink in one context is an exfiltration path. Any two are fine. Blocks the
  combination rather than trying to detect the phrasing.
- `createFlowTracker({ policy })` — accumulates provenance across a run and
  checks sinks against the whole of it.
- `declassify(tainted, { to, reason, by })` — the only downgrade, deliberately
  awkward: mandatory reason, recorded actor, `declassified-by:<who>` appended
  to sources so every hole in the guarantee is greppable.

New enforcement points:

- `flowMiddleware({ tracker })` in `@elsium-ai/gateway` — labels messages by
  role (`user` is untrusted: a user message is data, never instructions) and
  checks `llm:<provider>` before the request leaves. Jurisdiction rules work
  here without inspecting prompt contents.
- `withFlowControl(tool, { tracker })` in `@elsium-ai/tools` — gates a tool on
  the context's accumulated provenance and records its output as untrusted.
  Denial returns a failed `ToolExecutionResult` rather than throwing, matching
  `withCapability`; the handler never runs, so the side effect never happens.

The result: a prompt injection can succeed — the model obeys — and the
exfiltration still fails, because the check is on what is in the context rather
than on what the text said. See `examples/information-flow-control`.
