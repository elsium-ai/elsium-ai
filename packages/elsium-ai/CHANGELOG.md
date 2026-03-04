# elsium-ai

## 0.5.0

### Minor Changes

- fc58fdb: ## New Features

  - **DAG Workflows**: `defineDagWorkflow()` for directed acyclic graph execution with topological ordering and parallel wave execution
  - **MCP HTTP Transport**: `createMCPHttpHandler()` for HTTP/SSE-based MCP servers alongside existing stdio transport
  - **Stream Middleware**: `composeStreamMiddleware()` for composing middleware over streaming responses
  - **Shared Memory**: `createSharedMemory()` for cross-agent data sharing in multi-agent orchestration
  - **Auto-Instrumentation**: `instrumentComplete()` and `instrumentAgent()` for automatic tracing span creation
  - **Typed State Context**: State machine transitions can now return `{ next, context }` to pass typed context between states
  - **Tenant Budget Middleware**: `tenantBudgetMiddleware()` for per-tenant token and cost enforcement with sliding windows
  - **Experiment Persistence**: `createFileExperimentStore()` for saving/loading experiment results to disk
  - **Google Embeddings**: `createGoogleEmbeddings()` for Google text-embedding-004
  - **Cohere Embeddings**: `createCohereEmbeddings()` for Cohere embed-v4.0
  - **Qdrant Vector Store**: `createQdrantStore()` for Qdrant REST API integration
  - **BM25 Search**: `createBM25Index()` for keyword search with BM25 scoring
  - **Hybrid Search**: `createHybridSearch()` combining vector + BM25 via Reciprocal Rank Fusion

  ## Bug Fixes

  - **Custom providers**: `gateway()` now resolves providers registered via `registerProvider()` and `registerProviderFactory()`, not just built-in providers
  - **`redactSecrets`**: Added patterns for GitHub tokens (`ghp_*`, `gho_*`, `github_pat_*`)
  - **`getProviderMetadata`**: Built-in provider metadata is now registered at module load, returning correct data without requiring a gateway instance
  - **External vector stores**: RAG pipeline now wires registered vector stores via `vectorStoreRegistry` instead of throwing "not yet implemented"
  - **Cost limit policy**: `policyMiddleware` now populates `costEstimate` via optional `estimateCost` callback
  - **Structured output JSON extraction**: Handles markdown-fenced JSON and array responses
  - **Chat route model tracking**: Reports actual model name instead of `'unknown'`

  ## Tests

  - Added 20+ new test files with comprehensive coverage across all packages (1293 total tests)

  ## Documentation

  - 8 API reference docs covering all subpath exports
  - 2 guides: deployment and multi-agent patterns
  - Updated all package READMEs with new features
  - Added example READMEs for cost-tracking and mcp-integration

### Patch Changes

- Updated dependencies [fc58fdb]
  - @elsium-ai/app@0.5.0
  - @elsium-ai/testing@0.5.0
  - @elsium-ai/agents@0.5.0
  - @elsium-ai/client@0.5.0
  - @elsium-ai/core@0.5.0
  - @elsium-ai/gateway@0.5.0
  - @elsium-ai/mcp@0.5.0
  - @elsium-ai/observe@0.5.0
  - @elsium-ai/rag@0.5.0
  - @elsium-ai/tools@0.5.0
  - @elsium-ai/workflows@0.5.0

## 0.2.1

### Patch Changes

- Fix publish pipeline: resolve `workspace:*` to real versions before npm publish. v0.2.0 shipped with unresolved `workspace:*` dependencies making it uninstallable outside the monorepo.
- Updated dependencies
  - @elsium-ai/core@0.2.1
  - @elsium-ai/gateway@0.2.1
  - @elsium-ai/agents@0.2.1
  - @elsium-ai/tools@0.2.1
  - @elsium-ai/workflows@0.2.1
  - @elsium-ai/observe@0.2.1
  - @elsium-ai/rag@0.2.1
  - @elsium-ai/testing@0.2.1
  - @elsium-ai/app@0.2.1
  - @elsium-ai/mcp@0.2.1

## 0.2.0

### Minor Changes

- a1af089: Switch build target from `--target bun` to `--target node` for cross-runtime compatibility (Node.js, Bun, Deno). Replace `Bun.serve()` with `@hono/node-server`. Replace `bun-types` with `@types/node`. Remove `priority` field from `ProviderEntry` — array order now determines provider priority.

### Patch Changes

- Updated dependencies [a1af089]
  - @elsium-ai/core@0.2.0
  - @elsium-ai/gateway@0.2.0
  - @elsium-ai/agents@0.2.0
  - @elsium-ai/tools@0.2.0
  - @elsium-ai/workflows@0.2.0
  - @elsium-ai/observe@0.2.0
  - @elsium-ai/rag@0.2.0
  - @elsium-ai/testing@0.2.0
  - @elsium-ai/app@0.2.0
  - @elsium-ai/mcp@0.2.0

## 0.1.7

### Patch Changes

- e1eccb4: Add README files to all packages for npm listing
- Updated dependencies [e1eccb4]
  - @elsium-ai/core@0.1.7
  - @elsium-ai/gateway@0.1.7
  - @elsium-ai/agents@0.1.7
  - @elsium-ai/tools@0.1.7
  - @elsium-ai/rag@0.1.7
  - @elsium-ai/workflows@0.1.7
  - @elsium-ai/observe@0.1.7
  - @elsium-ai/mcp@0.1.7
  - @elsium-ai/app@0.1.7
  - @elsium-ai/testing@0.1.7
