---
"@elsium-ai/testing": minor
---

Add dataset provenance — make the eval data itself auditable.

Eval results are only as trustworthy as their labels and the dataset they ran
against. New, dependency-free:

- `summarizeAnnotations(cases)` — multi-annotator labels → gold label, per-case
  agreement, disputed cases, and **Fleiss' kappa** (chance-corrected multi-rater
  agreement) when rater counts are uniform.
- `hashDataset(dataset)` / `createDatasetManifest(dataset)` — deterministic,
  order-independent SHA-256 content hash, so a signed eval proof can pin the exact
  dataset used.

Completes the "evals are proof, not opinion" trilogy with judge-alignment (trust
the judge) and eval proofs (tamper-evident results): now the labels and the
dataset are auditable too.
