---
'@elsium-ai/agents': patch
---

Replace hardcoded magic numbers in the VAG and CAG modules with named constants in two new `defaults.ts` files. `verification/defaults.ts` exposes `DEFAULT_MAX_REPAIRS` (3) and `REPAIR_PROMPT_PREVIEW_CHARS` (500). `confidence-strategies/defaults.ts` exposes `DEFAULT_SELF_CONSISTENCY_SAMPLES` (5 — aligned with the Wang et al. 2022 self-consistency paper), `DEFAULT_SELF_CONSISTENCY_CONCURRENCY` (5), `DEFAULT_JUDGE_AGGREGATOR` (`'mean'`), `DEFAULT_LOGPROB_AGGREGATOR` (`'geometric-mean'` — perplexity-calibrated), `DEFAULT_LOGPROB_FALLBACK_CONFIDENCE` (0.5 — neutral midpoint), and `DEFAULT_SIMILARITY_VOTER_THRESHOLD` (0.85). The runtime behavior is unchanged; this is documentation-via-naming so the defaults are easy to find, override, and audit.
