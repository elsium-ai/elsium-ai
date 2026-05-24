# Verifiable Agent Execution

Every agent run produces a **signed `ExecutionProof`** — a cryptographic receipt with hash-chained events. A third party with only the public key can verify offline that the recorded LLM calls, tool calls, RAG retrievals, and policy decisions actually happened — and that no event was edited after the fact.

## What this example shows

1. **Mint** an Ed25519 keypair and create a `proofRecorder` for an organization.
2. **Record** an agent run: capture LLM calls (via gateway middleware), tool calls, policy decisions, and a final output.
3. **Persist** the proof to disk as a tamper-evident write-once file.
4. **Verify** offline with just the public key (no API keys needed) — both via the standalone `verifyProof()` and the CLI:
   ```
   elsium verify proof.json --public-key org.pub
   ```
5. **Replay** two runs and compare them structurally:
   ```
   elsium replay proof-run-a.json proof-run-b.json --strategy structural
   ```

## Run

```bash
export ANTHROPIC_API_KEY=your-key
bun examples/verifiable-agent-execution/index.ts
```

Outputs:
- `./proofs/proof_<id>.json` — the signed execution proof
- `./proofs/org.pub` — the public key for offline verification

Then verify from another shell:

```bash
elsium verify ./examples/verifiable-agent-execution/proofs/proof_*.json \
  --public-key ./examples/verifiable-agent-execution/proofs/org.pub
```

Or replay (run the script twice to produce two proofs, then compare):

```bash
bun examples/verifiable-agent-execution/index.ts  # → proof_A
bun examples/verifiable-agent-execution/index.ts  # → proof_B
elsium replay ./proofs/proof_A.json ./proofs/proof_B.json --strategy structural
```

## When to use

- **Regulated industries** (legal, finance, healthcare, gaming): you need to prove to an auditor what the AI did.
- **AI marketplaces**: a third-party agent runs on your infrastructure; you want a non-repudiable record.
- **Post-mortem investigations**: a run failed in production — the proof is your source of truth.
