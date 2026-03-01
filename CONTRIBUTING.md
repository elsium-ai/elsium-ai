# Contributing to ElsiumAI

Every AI framework helps you call an LLM. ElsiumAI is building the missing layer: **reliability, governance, and reproducibility** for AI systems you actually deploy to production. Circuit breakers, hash-chained audit trails, determinism assertions — the things that make AI trustworthy, not just functional.

This project is open source because production AI infrastructure should be a shared foundation, not a proprietary moat. Whether you're fixing a typo, adding a provider, or designing a new governance primitive — your contribution makes AI systems safer for everyone who ships them.

## Ways to Contribute

Code is great, but it's not the only way to help:

- **Bug reports** — Found something broken? [Open an issue](https://github.com/elsium-ai/elsium-ai/issues/new?template=bug_report.md). A clear reproduction is worth more than a fix without context.
- **Feature ideas** — Have an idea for a new governance rule, reliability pattern, or testing utility? [Propose it](https://github.com/elsium-ai/elsium-ai/issues/new?template=feature_request.md).
- **Documentation** — Improve guides, add examples, fix unclear explanations. The docs live in `docs/` and every package has its own README.
- **Examples and integrations** — Real-world usage examples help others adopt the framework faster.
- **Code reviews** — Review open PRs. Fresh eyes catch things authors miss.

## Finding Something to Work On

**First time here?** Look for issues labeled [`good first issue`](https://github.com/elsium-ai/elsium-ai/labels/good%20first%20issue) — these are scoped, well-defined tasks that don't require deep framework knowledge.

Want something meatier? Check [`help wanted`](https://github.com/elsium-ai/elsium-ai/labels/help%20wanted) for issues where we'd especially appreciate community input.

Browse [all open issues](https://github.com/elsium-ai/elsium-ai/issues) or propose your own. If you're unsure whether something is worth pursuing, open an issue first to discuss it — we'd rather help you scope the work than have you discover it mid-PR.

## Architecture at a Glance

ElsiumAI is a modular monorepo. Here's how the pieces fit together:

```
  app / cli          ← HTTP server, RBAC, scaffolding, dev tools
       │
  agents / mcp       ← Orchestration, memory, guardrails, MCP bridge
       │
  gateway / tools / observe / rag / workflows
  │         │         │        │       │
  │         │         │        │       └─ DAG pipelines (sequential, parallel, branching)
  │         │         │        └─ Document loading, chunking, vector search
  │         │         └─ Tracing, audit trail, cost tracking, provenance
  │         └─ Tool definitions with Zod validation
  └─ Multi-provider routing, circuit breaker mesh, PII detection
       │
     core             ← Foundation: types, errors, streaming, policy engine,
                        circuit breaker, retry, dedup, graceful shutdown
       │
    testing           ← Cross-cutting: mocks, evals, pinning, determinism assertions
```

**The key insight:** `core` is the foundation everything depends on. `gateway` adds provider abstraction on top. `agents`, `tools`, `observe`, `rag`, and `workflows` are peer packages at the middle layer. `app` and `cli` sit at the top, composing everything together. `testing` cuts across all layers.

If you're unsure where a change belongs, start from the bottom: if it's a shared type or utility, it's `core`. If it touches LLM calls, it's `gateway`. If it's about orchestration, it's `agents`.

## Development Setup

1. **Install Bun** (v1.0+):
   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```

2. **Clone and install**:
   ```bash
   git clone https://github.com/elsium-ai/elsium-ai.git
   cd elsium-ai
   bun install
   ```

3. **Run tests**:
   ```bash
   bun run test:run
   ```

4. **Lint**:
   ```bash
   bun run lint
   bun run lint:fix  # auto-fix
   ```

5. **Build all packages**:
   ```bash
   bun run build
   ```

Pre-push hooks automatically run lint, tests, and build — so if `bun run lint && bun run test:run && bun run build` passes locally, you're good.

## Making Changes

1. Create a feature branch from `main`
2. Make your changes
3. Add tests for new functionality
4. Run `bun run lint` and `bun run test:run`
5. Create a changeset: `bun run changeset`
6. Open a pull request

## Changesets

We use [Changesets](https://github.com/changesets/changesets) for versioning. When you make a change that should be released:

```bash
bun run changeset
```

Select the affected packages and describe the change. Not sure if your change needs a changeset? If it affects published package behavior (features, fixes, API changes), yes. If it's docs-only or internal tooling, no.

## Code Style

- We use [Biome](https://biomejs.dev/) for linting and formatting
- Tabs for indentation
- Single quotes
- No semicolons (except where required)
- Trailing commas

Don't worry about memorizing these — `bun run lint:fix` handles formatting automatically, and lint-staged runs it on every commit.

## Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat: add OpenAI provider to gateway`
- `fix: handle empty stream responses`
- `docs: update getting started guide`
- `test: add tests for retry logic`
- `refactor: simplify circuit breaker state machine`

## Recognition

Every contributor matters. Contributors are recognized in release notes and in the project's contributor list. Significant contributions are called out specifically. If you help build ElsiumAI, you'll be credited for it.

## Getting Help

- **Questions about contributing?** [Open a discussion](https://github.com/elsium-ai/elsium-ai/discussions) on GitHub — no question is too small.
- **Found a bug?** [File an issue](https://github.com/elsium-ai/elsium-ai/issues/new?template=bug_report.md) with steps to reproduce.
- **Want to discuss a design?** Open an issue tagged with your idea before writing code. We're happy to help scope the work and point you to the right package.

We want to make contributing easy. If something in this guide is unclear or the setup doesn't work, that's a bug — please tell us.
