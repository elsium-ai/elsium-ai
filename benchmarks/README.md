# ElsiumAI Benchmarks

## What These Benchmarks Measure

These benchmarks isolate **framework overhead** — the cost of ElsiumAI's abstractions, middleware, governance, and observability layers — separate from external factors like network latency, provider response time, or storage I/O.

A zero-latency mock provider is used so that every microsecond in the results comes from the framework itself.

### What Is Included

- Middleware dispatch (composition, context creation, dispatch chain)
- Security scanning (regex-based prompt injection / jailbreak detection)
- Audit trail (SHA-256 hash chain, in-memory storage)
- Policy evaluation (model access rules, token budget checks)
- Cost tracking (arithmetic accumulation)
- X-Ray logging (request/response snapshot with truncation)
- Tracing (span creation, in-memory storage)
- Agent orchestration (message handling, memory management)

### What Is NOT Included

- Network I/O to LLM providers (typically 200–800ms)
- Real crypto exports (tracing to external backends)
- External storage (vector DBs, databases)
- Real logging I/O (file writes, log aggregators)
- TLS handshakes, DNS resolution

This is intentional. Framework overhead is the only variable the framework controls. Network and provider latency are external constants that dwarf any framework cost.

## Reproduce

```bash
# Run the full benchmark suite
bun run bench

# Run only the framework overhead benchmark
bun run bench:overhead

# Run individual benchmarks
bun benchmarks/startup.ts
bun benchmarks/throughput.ts
bun benchmarks/memory.ts
bun benchmarks/bundle-size.ts
```

For accurate memory measurements, run with GC exposure:

```bash
bun --expose-gc benchmarks/framework-overhead.ts
```

## Regression Tracking

Benchmark results are frozen per release and tracked over time.

### Directory Structure

```
benchmarks/results/
  baseline.json     ← current regression baseline (compared against)
  latest.json       ← most recent benchmark run (auto-generated)
  v0.1.0.json       ← frozen snapshot for v0.1.0
  v0.2.0.json       ← frozen snapshot for v0.2.0
  ...
```

### Workflow

```bash
# 1. Run benchmarks and check for regressions against baseline
bun run bench:check

# 2. Before a release, freeze the current results
bun run bench:freeze v0.2.0

# 3. Custom tolerance (default: 20%)
bun benchmarks/check-regression.ts --tolerance 0.3
```

### How It Works

1. `framework-overhead.ts` writes `results/latest.json` after every run
2. `check-regression.ts` compares `latest.json` against `baseline.json`
3. If any P50/P95/P99 latency or memory metric regresses beyond the tolerance (default 20%), the script exits with code 1
4. `--freeze <version>` copies latest to `<version>.json` and updates the baseline

### CI Integration

Add to your CI pipeline:

```yaml
- name: Benchmark regression check
  run: bun run bench:check
```

This runs the benchmark, compares against the frozen baseline, and fails the build if any metric regresses beyond tolerance. Commit `baseline.json` to the repo so CI has a reference point.

## Benchmark Descriptions

| Script | What It Measures |
|---|---|
| `startup.ts` | Cold start time — import and initialize all core packages |
| `throughput.ts` | Agent completion overhead with noop provider, with/without tracing |
| `memory.ts` | Heap usage per agent (1, 100, 100 with memory config) |
| `bundle-size.ts` | Minified bundle size for each package |
| `framework-overhead.ts` | Full overhead analysis: individual middleware, full stack, concurrency, scaling, memory under load |

## Methodology

### Environment

Results vary by hardware. Always report:
- Runtime and version (e.g., Bun 1.3.10)
- Platform and architecture (e.g., darwin arm64)
- CPU model and core count
- Total system memory

The benchmark script prints this automatically.

### Measurement

- **Warmup:** 50 iterations discarded before measurement to eliminate JIT compilation and cache cold-start effects.
- **Iterations:** 1,000 per scenario (100 batches of N for concurrency tests).
- **Timer:** `performance.now()` (sub-microsecond resolution on Bun/Node).
- **GC:** `global.gc()` forced between memory checkpoints (requires `--expose-gc`).
- **Provider:** Zero-latency mock returning a fixed response — isolates framework cost.

### Statistics

All latency results report:
- **P50** (median) — typical request
- **P95** — tail latency most users experience
- **P99** — worst-case tail
- **ops/sec** — derived from average latency (1000 / avg_ms)

### Concurrency Model

Concurrent tests fire N requests via `Promise.all()` in batches, measuring total batch time divided by N. This models real-world event loop contention under load but does not simulate network backpressure.

## Performance Targets

| Metric | Target | Rationale |
|---|---|---|
| Agent completion (P95) | < 5ms | Framework should be invisible vs 200ms+ LLM latency |
| Full middleware stack (P95) | < 15ms | All governance layers enabled |
| Cold start | < 50ms | Fast serverless boot |
| Memory per agent | < 10MB | Support hundreds of agents per process |
| Core bundle | < 50KB | Edge deployment friendly |
| Full bundle | < 200KB | Reasonable total footprint |

## Caveats

1. **These are framework-only numbers.** Real-world request latency is dominated by LLM provider response time (200–800ms). Framework overhead at single-digit microseconds is <0.01% of total request time.

2. **In-memory only.** Audit trail uses in-memory hash chain. Tracing stores spans in-memory. In production with external exporters (OpenTelemetry, cloud logging), observability overhead will increase by the I/O cost of the exporter.

3. **Single-process.** Concurrency tests run within one Bun process. Multi-process or distributed deployments introduce coordination overhead not captured here.

4. **No real TLS/DNS.** Provider connections use a mock. Real deployments add connection setup cost on first request (amortized by keep-alive on subsequent requests).

5. **GC variance.** Memory results depend on GC behavior. Bun's GC is generational — short-lived objects (per-request contexts) are collected cheaply. Long-lived objects (audit trail, tracer spans) accumulate up to their configured caps.
