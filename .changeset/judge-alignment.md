---
"@elsium-ai/testing": minor
---

Add judge alignment — measure whether an LLM-judge can be trusted.

An LLM-as-judge produced only a score, with no way to know if it agrees with
human ground-truth or with itself. New, dependency-free:

- `computeJudgeAlignment(pairs)` — agreement rate, **Cohen's kappa** (chance-corrected),
  mean absolute error, Pearson correlation, confusion matrix, and a Landis–Koch
  strength label.
- `runJudgeAlignment(cases, scorer)` — run a judge/scorer over human-labeled cases
  and report alignment; plugs straight into `createRubricJudge(...).evaluate`.
- `assessJudgeConsistency(scorer)` — re-run the judge on the same input N times and
  measure self-disagreement (range / std dev).

This makes "evals are proof, not opinion" apply to the judge itself: a judge with
a measured kappa against human labels is an instrument, not a guess.
