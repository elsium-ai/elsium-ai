# reproducible runs — seed propagation + determinism report

Configure a `seed` once on the agent and it reaches **every** LLM request in the
loop. That makes the built-in determinism tooling actually usable and makes
signed proofs seed-sensitive — without wiring the seed into each call yourself.

## What this example shows

1. **Seed propagation** — `defineAgent({ seed })` (or `run(input, { seed })`)
   forwards the seed to every `CompletionRequest`.
2. **Determinism report** — `assertDeterministic` runs N times with the same
   seed and confirms identical output (variance / unique-output count).
3. **Seed really flows** — a different seed yields a different output.
4. **Output pinning** — `pinOutput` flags when a pinned result changes
   (regression detection).

## Run

```bash
bun examples/reproducible-run/index.ts
```

No API key needed — a deterministic-by-seed mock provider stands in for the LLM.

## Honest caveat

Elsium propagates the seed and gives you the tools to **measure and constrain**
reproducibility. It cannot make a hosted model deterministic on its own — that
depends on the provider honoring `seed` + `temperature: 0`. For tamper-evident
evidence of a run, pair this with a signed `ExecutionProof` and verify it offline:

```bash
elsium verify ./proof.json --public-key ./org.pub
```

See [`../verifiable-agent-execution`](../verifiable-agent-execution) for the
proof + offline-verify flow.
