# dataset provenance — can you trust the eval labels?

Judge-alignment answers "do I trust the judge?". This answers the other half:
**"do I trust the data?"** Eval results are only as good as the labels behind them.

## What this example shows

- **Inter-annotator agreement** — `summarizeAnnotations` reports, per case, the
  gold label (majority), what fraction of annotators agreed, and whether the case
  is **disputed**. Across cases it computes **Fleiss' kappa** (when rater counts
  are uniform) — chance-corrected multi-rater agreement.
- **Content hash / manifest** — `hashDataset` / `createDatasetManifest` produce a
  deterministic, order-independent SHA-256 of the dataset, so a signed eval proof
  can pin the exact dataset it ran against.

## Run

```bash
bun examples/dataset-provenance/index.ts
```

No API key needed.

## The point

This completes the "evals are proof, not opinion" trilogy:

1. **judge-alignment** — is the judge trustworthy? (kappa vs humans)
2. **eval-proof** — are the results tamper-evident? (Ed25519, verify offline)
3. **dataset-provenance** — are the labels trustworthy? (inter-annotator
   agreement) and which exact dataset was used? (content hash)

Together: an eval outcome a regulator can verify end to end — judge, result, and
data — without trusting you.
