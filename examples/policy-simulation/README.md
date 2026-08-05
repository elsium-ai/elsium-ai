# Policy simulation — `terraform plan` for governance

Nobody enables a security rule in production without knowing what it breaks. So
policies sit in monitor-only mode forever and protect nothing.

This answers the question that blocks adoption: **what would this rule have
blocked?** — with traceIds, before shipping it.

## Run

```bash
bun examples/policy-simulation/index.ts
```

## What it shows

A corpus of 100 recorded runs: 97 ordinary, 3 where a retrieved document was
attacker-controlled and the agent then reached for an outbound tool.

**Attempt 1** — `lethalTrifectaRule()` with defaults:

```
200 decision point(s) across 100 run(s): 100 allowed, 100 denied
100 of 100 run(s) affected (100.00%)
```

The rule is correct and would have broken production entirely: its default sink
list covers `tool:*`, so once a secret and untrusted content share a context it
blocks read-only tools too.

**Attempt 2** — narrowed to genuine egress:

```
200 decision point(s) across 100 run(s): 197 allowed, 3 denied
3 of 100 run(s) affected (3.00%)
  ✗ proof_… @2 tool:send_email
```

Three runs. Named. Exactly the ones that mattered.

**The plan:**

```
Plan: 3 newly denied, 0 newly allowed, 197 unchanged
```

**And when someone edits history to make the rule look safe:**

```
Evidence: 97 verified run(s), 3 REJECTED — plan computed without them
  ! proof_… — chainHead does not match recomputed chain

No verified run would have been affected — but 3 run(s) could not be verified,
so this plan is incomplete.
```

Dropping the offending tool calls is the obvious way to produce a friendly
plan. It breaks the hash chain, so those runs are rejected instead of quietly
believed — and the summary refuses to call the result clean.

## API

```ts
import { simulatePolicy, comparePolicies, flowPolicyProbe } from '@elsium-ai/observe'

const probe = flowPolicyProbe({ policy: candidate, initial: holdsSecret })

// What would this policy have done?
const result = simulatePolicy(traces, probe)

// What changes versus what is running today?
const plan = comparePolicies(traces, { baseline: current, candidate: probe })
```

`newlyDenied` is what everyone asks about. `newlyAllowed` is the one people
forget — a relaxed policy quietly permitting what used to be blocked is how
controls erode without anyone noticing.

## Why proofs make good input

`ExecutionProof`s are hash-chained and signed, so the corpus cannot be edited to
produce a friendlier plan — provided something checks. Pass `verifyWith` and it
does:

```ts
simulatePolicy(traces, probe, { verifyWith: registry })
```

Without it the plan is still computed, but the output says
`Evidence: UNVERIFIED`. A plan over unverified history looks exactly as
authoritative as a real one, and that is the failure mode worth naming.

The simulation is read-only: nothing is executed and no side effect is
replayed. A tool call denied in simulation still happened in the recording —
learning that is the point.

Proofs store hashes rather than content, so they can be shared without leaking
what was processed. Sensitivity classes therefore come from a `classify` hook
the operator controls:

```ts
flowPolicyProbe({
  policy,
  classify: (event) =>
    event.type === 'rag.retrieve' ? { classes: ['pii'], origin: 'untrusted' } : undefined,
})
```

## Two probes, two questions

`PolicyProbe` is a port — a function from a recorded run to the decisions a
policy would make over it. Two ship with the package:

| Probe | Question |
|---|---|
| `flowPolicyProbe` | May this **data** travel to this sink? |
| `capabilityProbe` | Was this **caller** permitted to do what it did? |

They are not interchangeable. A run can satisfy a capability token and still be
an exfiltration path, or be a clean data flow made by a caller with no
authority. Simulating one tells half the story.

`capabilityProbe` also answers a question that could not be asked before
minting a token: would it have allowed what the agent actually did? Scope it too
tightly and the agent breaks in production; too loosely and the token is
decoration. It feeds recorded figures back in, so `maxTokens` is checked against
tokens really consumed:

```ts
simulatePolicy(traces, capabilityProbe({ token: proposedToken }), { verifyWith: registry })
```

Declarative policy documents or a custom engine plug in the same way.
