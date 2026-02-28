# Contributing to ElsiumAI

Thank you for your interest in contributing to ElsiumAI! This guide will help you get started.

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
   bun run test
   ```

4. **Lint**:
   ```bash
   bun run lint
   bun run lint:fix  # auto-fix
   ```

## Project Structure

This is a monorepo with packages under `packages/`:

- `core` — Shared types, errors, streaming, utilities
- `gateway` — LLM provider abstraction
- `agents` — Agent orchestration
- `tools` — Tool definition and execution
- `rag` — Document processing and retrieval
- `workflows` — Multi-step pipelines
- `observe` — Tracing and cost tracking
- `app` — App bootstrap and HTTP server

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

Select the affected packages and describe the change.

## Code Style

- We use [Biome](https://biomejs.dev/) for linting and formatting
- Tabs for indentation
- Single quotes
- No semicolons (except where required)
- Trailing commas

## Commit Messages

Use clear, descriptive commit messages:

- `feat: add OpenAI provider to gateway`
- `fix: handle empty stream responses`
- `docs: update getting started guide`
- `test: add tests for retry logic`

## Questions?

Open an issue or start a discussion on GitHub.
