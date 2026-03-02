# @elsium-ai/cli

Command-line interface for scaffolding, developing, evaluating, and observing ElsiumAI projects.

[![npm](https://img.shields.io/npm/v/@elsium-ai/cli.svg)](https://www.npmjs.com/package/@elsium-ai/cli)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE)

## Install

```bash
npm install -g @elsium-ai/cli
```

Or run commands directly without installing:

```bash
npx @elsium-ai/cli init my-ai-app
```

## What's Inside

| Command | Description |
| --- | --- |
| `elsium init [name]` | Scaffold a new ElsiumAI project with best-practice directory structure |
| `elsium dev [entry]` | Start a development server with hot reload |
| `elsium eval <file>` | Run an evaluation suite against your agents |
| `elsium cost` | Display the cost report from the last run |
| `elsium trace [id]` | List recent traces or inspect a specific trace |
| `elsium xray` | Inspect raw LLM request/response details (X-Ray mode) |
| `elsium prompt <subcommand>` | Manage versioned prompts (list, show, diff, history) |

Global options:

| Flag | Description |
| --- | --- |
| `--help`, `-h` | Show help message |
| `--version`, `-v` | Show CLI version |

---

## Commands

### `elsium init`

Scaffolds a new ElsiumAI project with a complete directory structure, configuration files, example agents, tools, workflows, evaluations, and tests.

**Usage**

```
elsium init [name]
```

**Arguments**

| Argument | Default | Description |
| --- | --- | --- |
| `name` | `my-elsium-app` | Name of the project directory to create |

The generated project includes:

| Path | Purpose |
| --- | --- |
| `src/agents/` | Agent definitions with guardrails |
| `src/tools/` | Tool schemas validated by Zod |
| `src/policies/` | Policy sets (model allowlist, cost caps) |
| `src/gateway/` | Provider mesh with circuit breaker |
| `src/workflows/` | Multi-step workflows |
| `evals/` | Evaluation suites (quality + determinism) |
| `test/` | Unit tests with mock providers and replay |
| `.elsium/` | ElsiumAI local state (baselines, recordings) |
| `elsium.config.ts` | Central project configuration |
| `biome.json` | Linter/formatter settings |

**Example**

```bash
elsium init my-ai-app
cd my-ai-app
cp .env.example .env   # add your API keys
npm install
npm run dev
```

---

### `elsium dev`

Starts a development server that watches your entry file for changes and automatically restarts on save. Powered by `bun --watch` under the hood.

**Usage**

```
elsium dev [entry]
```

**Arguments**

| Argument | Default | Description |
| --- | --- | --- |
| `entry` | `src/index.ts` | Path to the entry file (must be within the project directory) |

The command validates that the entry file exists and is inside the current working directory before starting the server. Press `Ctrl+C` to stop.

**Example**

```bash
# Start with default entry point
elsium dev

# Start with a custom entry file
elsium dev src/server.ts
```

---

### `elsium eval`

Runs an evaluation suite defined in a TypeScript file against your agents or LLM pipelines. The eval file must export a default `EvalSuiteConfig` object (from `@elsium-ai/testing`) containing a `name`, an array of `cases`, and a `runner` function.

**Usage**

```
elsium eval <file>
```

**Arguments**

| Argument | Required | Description |
| --- | --- | --- |
| `file` | Yes | Path to the eval suite file (e.g. `./evals/quality.eval.ts`) |

Running `elsium eval` without a file argument prints usage instructions and an example `EvalSuiteConfig`.

Each case in the suite can specify criteria such as:

- `{ type: 'contains', value: 'expected substring' }`
- `{ type: 'length_min', value: 20 }`

The command dynamically imports `runEvalSuite` and `formatEvalReport` from `@elsium-ai/testing`, runs all cases, prints a formatted report, and exits with code `1` if any case fails.

**Example**

```bash
# Run quality evaluations
elsium eval ./evals/quality.eval.ts

# Run determinism evaluations
elsium eval ./evals/determinism.eval.ts
```

---

### `elsium cost`

Displays a formatted cost report from the last application run. The report is read from `.elsium/cost-report.json`, which is generated automatically when your app runs with cost tracking enabled.

**Usage**

```
elsium cost
```

This command takes no arguments or flags. If no cost report file exists, it prints instructions on how to enable cost tracking in your app configuration.

The report includes:

- Total cost (USD)
- Total tokens (input + output breakdown)
- Total API call count
- Per-model breakdown (cost, tokens, calls)

**Example**

```bash
elsium cost
```

Output:

```
  ElsiumAI Cost Report
  ──────────────────────────────────────────────────
  Generated: 2026-01-15T10:30:00.000Z

  Total Cost:          $0.003450
  Total Tokens:        1,250
    Input Tokens:      800
    Output Tokens:     450
  Total API Calls:     3

  By Model:
  ──────────────────────────────────────────────────
    claude-sonnet-4-6
      Cost:    $0.002100
      Tokens:  750
      Calls:   2
    claude-haiku-4-5
      Cost:    $0.001350
      Tokens:  500
      Calls:   1
```

To enable cost tracking, configure your app:

```typescript
const app = createApp({
  observe: {
    costTracking: true,
  },
})
```

---

### `elsium trace`

Lists recent traces or inspects a specific trace in detail. Traces are stored as JSON files in `.elsium/traces/` and are recorded when tracing is enabled in your app configuration.

**Usage**

```
elsium trace           # List up to 20 recent traces
elsium trace <id>      # Inspect a specific trace by ID
```

**Arguments**

| Argument | Required | Description |
| --- | --- | --- |
| `id` | No | Trace ID to inspect. If omitted, lists recent traces. |

When listing traces, each entry shows its status (`OK`, `ERR`, or `...`), trace ID, root span name, and duration.

When inspecting a single trace, the command renders a full span tree showing:

- Span kind, name, status, and duration
- Metadata key-value pairs
- Events with timestamps and optional data

**Example**

```bash
# List recent traces
elsium trace

# Inspect a specific trace
elsium trace trc_abc123
```

To enable tracing, configure your app:

```typescript
const app = createApp({
  observe: {
    tracing: true,
  },
})
```

---

### `elsium xray`

Inspects raw LLM call details including HTTP requests, responses, token usage, and cost. X-Ray data is captured when X-Ray mode is enabled on your gateway and stored in `.elsium/xray-history.json`.

**Usage**

```
elsium xray                   # Show the last call
elsium xray --last N          # Show the last N calls
elsium xray --trace <id>      # Show a specific call by trace ID
elsium xray --raw             # Include full request/response bodies
```

**Flags**

| Flag | Description |
| --- | --- |
| `--last N` | Show the last N calls (default: 5 when flag is present, 1 otherwise) |
| `--trace <id>` | Look up a specific call by its trace ID |
| `--raw` | Include full HTTP request and response details (headers, body) |
| `--help`, `-h` | Show help message |

Each entry displays: trace ID, timestamp, provider, model, latency, token usage (input/output/total), and cost. When `--raw` is passed, the full HTTP request (method, URL, headers, body) and response (status, headers, body) are also printed.

**Example**

```bash
# Show the most recent LLM call
elsium xray

# Show the last 5 calls with full request/response bodies
elsium xray --last 5 --raw

# Look up a specific call
elsium xray --trace trc_abc123
```

To enable X-Ray mode, configure your gateway:

```typescript
const gw = gateway({ provider: 'anthropic', apiKey: '...', xray: true })
```

---

### `elsium prompt`

Manages versioned prompts stored as JSON files in `.elsium/prompts/`. Provides subcommands to list, inspect, compare, and view the history of prompt versions.

**Usage**

```
elsium prompt list                     # List all registered prompts
elsium prompt show <name> [version]    # Show prompt content (latest if version omitted)
elsium prompt history <name>           # Show version history for a prompt
elsium prompt diff <name> <v1> <v2>    # Show a line-by-line diff between two versions
```

**Subcommands**

| Subcommand | Arguments | Description |
| --- | --- | --- |
| `list` | None | List all prompts with their version counts |
| `show` | `<name> [version]` | Display prompt content; defaults to the latest version |
| `history` | `<name>` | Show all versions of a prompt sorted chronologically |
| `diff` | `<name> <v1> <v2>` | Line-by-line diff between two prompt versions |

Prompt files are JSON objects with the following shape:

```json
{
  "name": "greeting",
  "version": "1.0",
  "content": "Hello {{user_name}}, how can I help you today?",
  "variables": ["user_name"],
  "metadata": {}
}
```

**Example**

```bash
# List all prompts
elsium prompt list

# Show the latest version of a prompt
elsium prompt show greeting

# Show a specific version
elsium prompt show greeting 1.0

# Compare two versions
elsium prompt diff greeting 1.0 2.0

# View version history
elsium prompt history greeting
```

---

## Programmatic API

The package exports each command function for use in custom tooling, scripts, or programmatic integrations. All exports are available from the package entry point.

```typescript
import {
  initCommand,
  devCommand,
  evalCommand,
  costCommand,
  traceCommand,
} from '@elsium-ai/cli'
```

### `initCommand`

```typescript
function initCommand(args: string[]): Promise<void>
```

Scaffolds a new ElsiumAI project. Pass the project name as the first element of `args`, or omit it to default to `"my-elsium-app"`.

```typescript
import { initCommand } from '@elsium-ai/cli'

await initCommand(['my-ai-app'])
```

### `devCommand`

```typescript
function devCommand(args: string[]): Promise<void>
```

Starts the development server with hot reload. Pass a custom entry file path as the first element of `args`, or omit it to default to `"src/index.ts"`.

```typescript
import { devCommand } from '@elsium-ai/cli'

await devCommand(['src/server.ts'])
```

### `evalCommand`

```typescript
function evalCommand(args: string[]): Promise<void>
```

Runs an evaluation suite. The first element of `args` must be the path to an eval file exporting a default `EvalSuiteConfig`. If no file is provided, prints usage information.

```typescript
import { evalCommand } from '@elsium-ai/cli'

await evalCommand(['./evals/quality.eval.ts'])
```

### `costCommand`

```typescript
function costCommand(args: string[]): Promise<void>
```

Reads and displays the cost report from `.elsium/cost-report.json`. The `args` parameter is accepted for interface consistency but is currently unused.

```typescript
import { costCommand } from '@elsium-ai/cli'

await costCommand([])
```

### `traceCommand`

```typescript
function traceCommand(args: string[]): Promise<void>
```

Lists recent traces when called with an empty `args` array, or inspects a specific trace when a trace ID is provided as the first element.

```typescript
import { traceCommand } from '@elsium-ai/cli'

// List recent traces
await traceCommand([])

// Inspect a specific trace
await traceCommand(['trc_abc123'])
```

---

## Part of ElsiumAI

This package is the CLI for the [ElsiumAI](https://github.com/elsium-ai/elsium-ai) framework. See the [full documentation](https://github.com/elsium-ai/elsium-ai) for guides and examples.

Other packages in the framework:

- [`@elsium-ai/core`](https://www.npmjs.com/package/@elsium-ai/core) -- Runtime, policies, and utilities
- [`@elsium-ai/gateway`](https://www.npmjs.com/package/@elsium-ai/gateway) -- Multi-provider LLM gateway
- [`@elsium-ai/agents`](https://www.npmjs.com/package/@elsium-ai/agents) -- Agent definitions and execution
- [`@elsium-ai/tools`](https://www.npmjs.com/package/@elsium-ai/tools) -- Tool schemas and handlers
- [`@elsium-ai/workflows`](https://www.npmjs.com/package/@elsium-ai/workflows) -- Multi-step workflow orchestration
- [`@elsium-ai/observe`](https://www.npmjs.com/package/@elsium-ai/observe) -- Tracing, cost tracking, and observability
- [`@elsium-ai/testing`](https://www.npmjs.com/package/@elsium-ai/testing) -- Mocks, replay, and evaluation harness
- [`@elsium-ai/app`](https://www.npmjs.com/package/@elsium-ai/app) -- Application bootstrap and server

## License

[MIT](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE)
