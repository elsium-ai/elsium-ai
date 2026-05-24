# Confidence-Augmented Generation (CAG)

VAG (verification) tells you the output is **wrong**. CAG tells you the output is **uncertain** — even when nothing failed validation. Three pluggable strategies + a runtime threshold gate.

## What this example shows

- **`selfConsistency`** — sample N times, vote with majority. Confidence = `winners / total`.
- **`judgeEnsemble`** — M judges score the same output; aggregate `mean | median | min`.
- **`logprobScore`** — extract token logprobs from the provider's response; geometric mean is the calibrated score.
- **`requireConfidence`** — runtime threshold gate; below the line: `abort | escalate | callback`.

## Run

```bash
export ANTHROPIC_API_KEY=your-key   # any provider; uses Anthropic by default
bun examples/confidence-strategies/index.ts
```

## When to use each

| Strategy | Best for | Cost |
|---|---|---|
| `selfConsistency` | Math, reasoning, structured extraction (deterministic answers under varying paths) | N × the base call |
| `judgeEnsemble` | Open-ended QA (subjective quality) | 1 base call + M judges |
| `logprobScore` | Quick "is the model unsure?" signal during streaming | Free if the provider returns logprobs |

Compose: `selfConsistency` samples can double as VAG validator inputs, and `requireConfidence` is the natural feed for the CARG cascade router.
