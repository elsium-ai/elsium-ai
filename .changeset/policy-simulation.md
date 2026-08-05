---
"@elsium-ai/observe": minor
---

Add policy simulation — `terraform plan` for governance.

Governance controls fail on adoption, not on design. Nobody enables a security
rule in production without knowing what it breaks, so policies sit in
monitor-only mode indefinitely and protect nothing. The gap was never a better
policy engine; it was the missing answer to "what will this block?".

Recorded `ExecutionProof`s already hold what actually happened. Replaying a
candidate policy over them answers the question with traceIds attached.

- `simulatePolicy(traces, probe)` — what a policy would have decided across
  recorded runs: totals, denials with their trace and sequence, a per-rule
  breakdown, and `affectedTraceRatio` (runs touched, not decision points —
  one run breaking is what a user experiences).
- `comparePolicies(traces, { baseline, candidate })` — the plan.
  `newlyDenied` is the blast radius everyone asks about; `newlyAllowed` is the
  one people forget, since a relaxed policy quietly permitting what used to be
  blocked is how controls erode.
- `flowPolicyProbe({ policy, classify, initial })` — replays information flow
  over a recording, accumulating provenance exactly as the live tracker does.
  Tools are checked before their own output joins the context, or every tool
  would appear to taint itself.
- `formatSimulation` / `formatComparison` — plan-style output for a terminal
  or a CI comment.

`PolicyProbe` is a port: a function from a recorded run to the decisions a
policy would make over it. Capability tokens, declarative policy documents or a
custom engine plug in the same way.

Simulation is read-only — nothing is executed, no side effect replayed. And
because proofs are hash-chained and signed, the corpus cannot be edited into a
friendlier plan.

The example is the argument: `lethalTrifectaRule()` with default sinks would
have blocked 100% of a 100-run corpus, because its defaults cover `tool:*` and
that includes read-only tools. Narrowed to genuine egress it blocks 3 runs —
and names them.
