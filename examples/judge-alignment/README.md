# judge alignment — is your LLM-judge trustworthy?

An LLM-as-judge produces a score. On its own, that is an opinion. Before you
trust a judge to gate releases, measure it:

- **Alignment vs human ground-truth** — `runJudgeAlignment` / `computeJudgeAlignment`
  report agreement rate, **Cohen's kappa** (agreement corrected for chance), mean
  absolute error, and Pearson correlation.
- **Self-consistency** — `assessJudgeConsistency` re-runs the judge on the same
  input N times and measures how much it disagrees with itself.

Why kappa matters: a judge that says "pass" to everything can score 50–90%
agreement by luck. Kappa corrects for chance and exposes it (kappa ≈ 0 = no
better than guessing).

## Run

```bash
bun examples/judge-alignment/index.ts
```

No API key needed — a stand-in scorer plays the judge. In real use, swap in
`createRubricJudge(...).evaluate` (its score plugs straight into `runJudgeAlignment`).

## The point

This is "evals are proof, not opinion" applied to the judge itself. A judge you
have not aligned is a confident guess; a judge with a measured kappa against human
labels is an instrument you can defend in a regulated review.
