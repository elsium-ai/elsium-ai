---
"@elsium-ai/observe": minor
"elsium-ai": patch
---

Verify the simulation corpus, and simulate capability tokens.

Two gaps that made policy simulation narrower than it appeared.

**The corpus was never checked.** Proofs are signed and hash-chained precisely
so nobody can quietly edit what happened, but that guarantee is inert unless
something verifies it. A plan computed over unverified history looks exactly as
authoritative as one computed over real history — delete the runs where a rule
would have fired, and the plan declares the rule safe to ship.

- `verifyCorpus(traces, registry)` filters a corpus to the runs that hold up.
- `simulatePolicy(traces, probe, { verifyWith: registry })` does it inline and
  reports the outcome on `evidence`. Rejections are returned rather than
  thrown: a tampered corpus is itself a finding.
- The rendered plan leads with the evidence, says `Evidence: UNVERIFIED` when
  signatures were not checked, and refuses to call a result clean when runs
  were excluded — "no run affected" over an incomplete corpus is how a doctored
  history gets believed.

**Only data flows could be simulated, not authorization.**
`capabilityProbe({ token })` replays a `CapabilityToken` over a recording and
answers what could not be asked before minting one: would this token have
allowed what the agent actually did? Too tight and the agent breaks in
production; too loose and the token is decoration.

It covers every decision point — `tool.call`, `llm.call`, `rag.retrieve` — and
feeds recorded figures back in, so `maxTokens` is checked against the tokens a
run really consumed and `maxResults` against the documents really returned.

The two probes answer different questions. A capability check asks whether the
caller was permitted; a flow check whether the data may travel. A run can pass
one and fail the other, so simulating one tells half the story.

Also corrects the README's published-size and test-count figures, which had
drifted across three inconsistent values and understated the bundle by up to
45%.
