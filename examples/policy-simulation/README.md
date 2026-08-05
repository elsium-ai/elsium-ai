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
produce a friendlier plan. The simulation is read-only: nothing is executed and
no side effect is replayed. A tool call denied in simulation still happened in
the recording — learning that is the point.

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

## Beyond flow policies

`PolicyProbe` is a port. `flowPolicyProbe` ships with it; capability tokens,
declarative policy documents or a custom engine plug in the same way — a probe
is just a function from a recorded run to the decisions a policy would make
over it.
