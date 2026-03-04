# elsium-ai

Single import for the entire ElsiumAI framework.

[![npm](https://img.shields.io/npm/v/elsium-ai.svg)](https://www.npmjs.com/package/elsium-ai)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE)

---

## Install

```bash
npm install elsium-ai
```

---

## Why use this package?

`elsium-ai` is the umbrella package that re-exports every public API from all ElsiumAI sub-packages. Instead of installing and importing from many individual packages, you can import everything from a single entry point.

**Before** -- importing from individual sub-packages:

```typescript
import { env } from '@elsium-ai/core'
import { gateway } from '@elsium-ai/gateway'
import { defineAgent } from '@elsium-ai/agents'
```

**After** -- importing from the umbrella package:

```typescript
import { env, gateway, defineAgent } from 'elsium-ai'
```

Same APIs, one dependency, one import path.

---

## What's Included

Every value and type listed below is available directly from `'elsium-ai'`.

### `@elsium-ai/core`

| Values | Types |
|--------|-------|
| `ElsiumError` | `Role` |
| `ok` | `ContentPart` |
| `err` | `TextContent` |
| `isOk` | `ImageContent` |
| `isErr` | `AudioContent` |
| `unwrap` | `DocumentContent` |
| `unwrapOr` | `Message` |
| `tryCatch` | `ToolCall` |
| `tryCatchSync` | `ToolResult` |
| `createStream` | `TokenUsage` |
| `createLogger` | `CostBreakdown` |
| `env` | `StopReason` |
| `envNumber` | `LLMResponse` |
| `envBool` | `StreamEvent` |
| `generateId` | `XRayData` |
| `generateTraceId` | `StreamCheckpoint` |
| `extractText` | `ProviderConfig` |
| `sleep` | `CompletionRequest` |
| `retry` | `ToolDefinition` |
| `zodToJsonSchema` | `TenantContext` |
| `createRegistry` | `Middleware` |
| `countTokens` | `Result` |
| `createContextManager` | `Ok` |
| | `Err` |
| | `ElsiumStream` |
| | `ResilientStreamOptions` |
| | `LogLevel` |
| | `Logger` |
| | `ErrorCode` |
| | `Registry` |
| | `ContextStrategy` |
| | `ContextManagerConfig` |
| | `StreamMiddleware` |
| | `StreamMiddlewareNext` |
| | `ContextManager` |

### `@elsium-ai/gateway`

| Values | Types |
|--------|-------|
| `gateway` | `LLMProvider` |
| `registerProviderFactory` | `ProviderFactory` |
| `calculateCost` | `Gateway` |
| `estimateCost` | |
| `composeStreamMiddleware` | |
| `registerPricing` | `GatewayConfig` |
| `composeMiddleware` | `XRayStore` |
| `loggingMiddleware` | `ProviderMeshConfig` |
| `costTrackingMiddleware` | `ProviderEntry` |
| `xrayMiddleware` | `RoutingStrategy` |
| `createAnthropicProvider` | `ProviderMesh` |
| `createOpenAIProvider` | `SecurityMiddlewareConfig` |
| `createGoogleProvider` | `SecurityViolation` |
| `createProviderMesh` | `SecurityResult` |
| `securityMiddleware` | `CacheAdapter` |
| `detectPromptInjection` | `CacheStats` |
| `detectJailbreak` | `CacheMiddlewareConfig` |
| `redactSecrets` | `OutputGuardrailConfig` |
| `checkBlockedPatterns` | `OutputGuardrailRule` |
| `cacheMiddleware` | `OutputViolation` |
| `createInMemoryCache` | `BatchConfig` |
| `outputGuardrailMiddleware` | `BatchResult` |
| `createBatch` | `BatchResultItem` |

### `@elsium-ai/agents`

| Values | Types |
|--------|-------|
| `defineAgent` | `Agent` |
| `runSequential` | `AgentDependencies` |
| `runParallel` | `AgentConfig` |
| `runSupervisor` | `AgentResult` |
| `createMemory` | `AgentRunOptions` |
| `createSharedMemory` | `SharedMemory` |
| `createSemanticValidator` | `MultiAgentOptions` |
| `createAgentSecurity` | `GuardrailConfig` |
| `createConfidenceScorer` | `AgentHooks` |
| `executeStateMachine` | `Memory` |
| `createInMemoryMemoryStore` | `MemoryConfig` |
| `createSqliteMemoryStore` | `MemoryStore` |
| | `SqliteMemoryStoreConfig` |
| | `StateTransitionResult` |
| | `SemanticGuardrailConfig` |
| | `SemanticCheck` |
| | `SemanticCheckResult` |
| | `SemanticValidationResult` |
| | `SemanticValidator` |
| | `AgentSecurityConfig` |
| | `AgentSecurityResult` |
| | `ConfidenceConfig` |
| | `ConfidenceResult` |
| | `StateDefinition` |
| | `StateHistoryEntry` |
| | `StateMachineResult` |

### `@elsium-ai/tools`

| Values | Types |
|--------|-------|
| `defineTool` | `Tool` |
| `createToolkit` | `ToolConfig` |
| `httpFetchTool` | `ToolContext` |
| `calculatorTool` | `ToolExecutionResult` |
| `jsonParseTool` | `Toolkit` |
| `currentTimeTool` | |
| `formatToolResult` | |
| `formatToolResultAsText` | |

### `@elsium-ai/rag`

| Values | Types |
|--------|-------|
| `rag` | `RAGPipeline` |
| `createInMemoryStore` | `RAGPipelineConfig` |
| `createOpenAIEmbeddings` | `IngestResult` |
| `createGoogleEmbeddings` | `Document` |
| `createCohereEmbeddings` | `Chunk` |
| `createMockEmbeddings` | `EmbeddedChunk` |
| `vectorStoreRegistry` | `RetrievalResult` |
| `embeddingProviderRegistry` | `QueryOptions` |
| `createPgVectorStore` | `EmbeddingProvider` |
| `createQdrantStore` | `VectorStore` |
| `createBM25Index` | `VectorStoreFactory` |
| `createHybridSearch` | `EmbeddingProviderFactory` |
| | `PgVectorStoreConfig` |

### `@elsium-ai/workflows`

| Values | Types |
|--------|-------|
| `defineWorkflow` | `Workflow` |
| `defineParallelWorkflow` | `WorkflowConfig` |
| `defineBranchWorkflow` | `WorkflowResult` |
| `defineDagWorkflow` | `WorkflowRunOptions` |
| `step` | `StepConfig` |
| | `StepContext` |
| | `StepResult` |
| | `DagStepConfig` |
| | `DagWorkflowConfig` |

### `@elsium-ai/observe`

| Values | Types |
|--------|-------|
| `observe` | `Tracer` |
| `createSpan` | `TracerConfig` |
| `createMetrics` | `TracerExporter` |
| `createCostEngine` | `CostReport` |
| `createExperiment` | `Span` |
| `instrumentComplete` | `ExperimentStore` |
| `instrumentAgent` | |
| `createFileExperimentStore` | |
| `toOTelSpan` | `SpanData` |
| `toOTelExportRequest` | `SpanKind` |
| `toTraceparent` | `SpanStatus` |
| `parseTraceparent` | `MetricsCollector` |
| `injectTraceContext` | `MetricEntry` |
| `extractTraceContext` | `CostEngine` |
| `createOTLPExporter` | `CostEngineConfig` |
| | `CostAlert` |
| | `CostDimension` |
| | `CostIntelligenceReport` |
| | `ModelSuggestion` |
| | `Experiment` |
| | `ExperimentConfig` |
| | `ExperimentVariant` |
| | `ExperimentResults` |
| | `OTelSpan` |
| | `OTelExportRequest` |
| | `TraceContext` |
| | `OTLPExporterConfig` |

### `@elsium-ai/app`

| Values | Types |
|--------|-------|
| `createApp` | `AppConfig` |
| `sseHeaders` | `ServerConfig` |
| `formatSSE` | `CorsConfig` |
| `streamResponse` | `AuthConfig` |
| `tenantMiddleware` | `RateLimitConfig` |
| `tenantRateLimitMiddleware` | `StreamChatEvent` |
| `tenantBudgetMiddleware` | `StreamCompleteEvent` |
| | `TenantMiddlewareConfig` |

### `@elsium-ai/mcp`

| Values | Types |
|--------|-------|
| `createMCPClient` | `MCPClient` |
| `createMCPServer` | `MCPClientConfig` |
| `createMCPHttpHandler` | `MCPToolInfo` |
| | `MCPServer` |
| | `MCPServerConfig` |
| | `JsonRpcRequest` |
| | `JsonRpcResponse` |
| | `MCPTransport` |

### `@elsium-ai/client`

| Values | Types |
|--------|-------|
| `createClient` | `ElsiumClient` |
| | `ClientConfig` |

### `@elsium-ai/testing`

| Values | Types |
|--------|-------|
| `mockProvider` | `MockProviderOptions` |
| `createFixture` | `MockResponseConfig` |
| `loadFixture` | `MockProvider` |
| `createRecorder` | `EvalSuiteConfig` |
| `runEvalSuite` | `EvalCase` |
| `formatEvalReport` | `EvalCriterion` |
| `createSnapshotStore` | `EvalResult` |
| `createPromptRegistry` | `EvalSuiteResult` |
| `definePrompt` | `LLMJudge` |
| `createRegressionSuite` | `SnapshotStore` |
| `createReplayRecorder` | `PromptDefinition` |
| `createReplayPlayer` | `PromptDiff` |
| | `PromptRegistry` |
| | `RegressionBaseline` |
| | `RegressionResult` |
| | `RegressionDetail` |
| | `RegressionSuite` |
| | `ReplayEntry` |
| | `ReplayRecorder` |
| | `ReplayPlayer` |

---

## Quick Example

```typescript
import {
  env,
  gateway,
  defineAgent,
  defineTool,
  observe,
  createCostEngine,
} from 'elsium-ai'
import { z } from 'zod'

// Set up observability
const tracer = observe({ serviceName: 'my-app' })
const costEngine = createCostEngine({ budget: { daily: 10.0 } })

// Create a gateway to an LLM provider
const llm = gateway({
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  apiKey: env('ANTHROPIC_API_KEY'),
})

// Define a tool
const weatherTool = defineTool({
  name: 'get_weather',
  description: 'Get current weather for a city',
  parameters: z.object({ city: z.string() }),
  execute: async ({ city }) => ({ temp: 72, city }),
})

// Define an agent with the tool
const agent = defineAgent(
  {
    name: 'assistant',
    system: 'You are a helpful assistant.',
    tools: [weatherTool],
  },
  { complete: (req) => llm.complete(req) },
)

// Run the agent
const result = await agent.run('What is the weather in Paris?')
console.log(result.output)
```

---

## Individual Packages

For full API documentation, see each sub-package README.

| Package | npm | Description |
|---------|-----|-------------|
| `@elsium-ai/core` | [npm](https://www.npmjs.com/package/@elsium-ai/core) | Types, errors, result pattern, streaming, logger, config, tokens, context manager, registry, schema |
| `@elsium-ai/gateway` | [npm](https://www.npmjs.com/package/@elsium-ai/gateway) | Multi-provider LLM gateway, middleware, provider mesh, security, caching, output guardrails, batch |
| `@elsium-ai/agents` | [npm](https://www.npmjs.com/package/@elsium-ai/agents) | Agent definitions, memory, persistent stores (in-memory, SQLite), guardrails, multi-agent |
| `@elsium-ai/tools` | [npm](https://www.npmjs.com/package/@elsium-ai/tools) | Tool definitions with Zod validation, built-in tools |
| `@elsium-ai/rag` | [npm](https://www.npmjs.com/package/@elsium-ai/rag) | Document ingestion, chunking, embeddings, vector search, PgVector store, plugin registries |
| `@elsium-ai/workflows` | [npm](https://www.npmjs.com/package/@elsium-ai/workflows) | Sequential, parallel, and branching workflow definitions |
| `@elsium-ai/observe` | [npm](https://www.npmjs.com/package/@elsium-ai/observe) | Tracing, metrics, cost intelligence, OpenTelemetry export, A/B experiments |
| `@elsium-ai/app` | [npm](https://www.npmjs.com/package/@elsium-ai/app) | HTTP server with CORS, auth, rate limiting, SSE streaming, multi-tenant |
| `@elsium-ai/client` | [npm](https://www.npmjs.com/package/@elsium-ai/client) | TypeScript HTTP client with SSE parsing for consuming ElsiumAI servers |
| `@elsium-ai/mcp` | [npm](https://www.npmjs.com/package/@elsium-ai/mcp) | Model Context Protocol client and server |
| `@elsium-ai/testing` | [npm](https://www.npmjs.com/package/@elsium-ai/testing) | Mocks, fixtures, evals, snapshot testing, prompt versioning, replay |

---

## License

[MIT](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE) - Copyright (c) 2026 Eric Utrera
