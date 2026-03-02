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
| `isErr` | `Message` |
| `unwrap` | `ToolCall` |
| `unwrapOr` | `ToolResult` |
| `tryCatch` | `TokenUsage` |
| `tryCatchSync` | `CostBreakdown` |
| `createStream` | `StopReason` |
| `createLogger` | `LLMResponse` |
| `env` | `StreamEvent` |
| `envNumber` | `XRayData` |
| `envBool` | `StreamCheckpoint` |
| `generateId` | `ProviderConfig` |
| `generateTraceId` | `CompletionRequest` |
| `extractText` | `ToolDefinition` |
| `sleep` | `Middleware` |
| `retry` | `Result` |
| | `Ok` |
| | `Err` |
| | `ElsiumStream` |
| | `ResilientStreamOptions` |
| | `LogLevel` |
| | `Logger` |
| | `ErrorCode` |

### `@elsium-ai/gateway`

| Values | Types |
|--------|-------|
| `gateway` | `LLMProvider` |
| `registerProviderFactory` | `ProviderFactory` |
| `calculateCost` | `Gateway` |
| `registerPricing` | `GatewayConfig` |
| `composeMiddleware` | `XRayStore` |
| `loggingMiddleware` | `ProviderMeshConfig` |
| `costTrackingMiddleware` | `ProviderEntry` |
| `xrayMiddleware` | `RoutingStrategy` |
| `createAnthropicProvider` | `ProviderMesh` |
| `createOpenAIProvider` | `SecurityMiddlewareConfig` |
| `createGoogleProvider` | `SecurityViolation` |
| `createProviderMesh` | `SecurityResult` |
| `securityMiddleware` | |
| `detectPromptInjection` | |
| `detectJailbreak` | |
| `redactSecrets` | |
| `checkBlockedPatterns` | |

### `@elsium-ai/agents`

| Values | Types |
|--------|-------|
| `defineAgent` | `Agent` |
| `runSequential` | `AgentDependencies` |
| `runParallel` | `AgentConfig` |
| `runSupervisor` | `AgentResult` |
| `createMemory` | `AgentRunOptions` |
| `createSemanticValidator` | `GuardrailConfig` |
| `createAgentSecurity` | `AgentHooks` |
| `createConfidenceScorer` | `Memory` |
| `executeStateMachine` | `MemoryConfig` |
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
| `createMockEmbeddings` | `Document` |
| | `Chunk` |
| | `EmbeddedChunk` |
| | `RetrievalResult` |
| | `QueryOptions` |
| | `EmbeddingProvider` |
| | `VectorStore` |

### `@elsium-ai/workflows`

| Values | Types |
|--------|-------|
| `defineWorkflow` | `Workflow` |
| `defineParallelWorkflow` | `WorkflowConfig` |
| `defineBranchWorkflow` | `WorkflowResult` |
| `step` | `WorkflowRunOptions` |
| | `StepConfig` |
| | `StepContext` |
| | `StepResult` |

### `@elsium-ai/observe`

| Values | Types |
|--------|-------|
| `observe` | `Tracer` |
| `createSpan` | `TracerConfig` |
| `createMetrics` | `TracerExporter` |
| `createCostEngine` | `CostReport` |
| `toOTelSpan` | `Span` |
| `toOTelExportRequest` | `SpanData` |
| `toTraceparent` | `SpanKind` |
| `parseTraceparent` | `SpanStatus` |
| `injectTraceContext` | `MetricsCollector` |
| `extractTraceContext` | `MetricEntry` |
| `createOTLPExporter` | `CostEngine` |
| | `CostEngineConfig` |
| | `CostAlert` |
| | `CostDimension` |
| | `CostIntelligenceReport` |
| | `ModelSuggestion` |
| | `OTelSpan` |
| | `OTelExportRequest` |
| | `TraceContext` |
| | `OTLPExporterConfig` |

### `@elsium-ai/app`

| Values | Types |
|--------|-------|
| `createApp` | `AppConfig` |
| | `ServerConfig` |
| | `CorsConfig` |
| | `AuthConfig` |
| | `RateLimitConfig` |

### `@elsium-ai/mcp`

| Values | Types |
|--------|-------|
| `createMCPClient` | `MCPClient` |
| `createMCPServer` | `MCPClientConfig` |
| | `MCPToolInfo` |
| | `MCPServer` |
| | `MCPServerConfig` |

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
| `@elsium-ai/core` | [npm](https://www.npmjs.com/package/@elsium-ai/core) | Types, errors, result pattern, streaming, logger, config utilities |
| `@elsium-ai/gateway` | [npm](https://www.npmjs.com/package/@elsium-ai/gateway) | Multi-provider LLM gateway, middleware, provider mesh, security |
| `@elsium-ai/agents` | [npm](https://www.npmjs.com/package/@elsium-ai/agents) | Agent definitions, memory, guardrails, multi-agent orchestration |
| `@elsium-ai/tools` | [npm](https://www.npmjs.com/package/@elsium-ai/tools) | Tool definitions with Zod validation, built-in tools |
| `@elsium-ai/rag` | [npm](https://www.npmjs.com/package/@elsium-ai/rag) | Document ingestion, chunking, embeddings, vector search |
| `@elsium-ai/workflows` | [npm](https://www.npmjs.com/package/@elsium-ai/workflows) | Sequential, parallel, and branching workflow definitions |
| `@elsium-ai/observe` | [npm](https://www.npmjs.com/package/@elsium-ai/observe) | Tracing, metrics, cost intelligence, OpenTelemetry export |
| `@elsium-ai/app` | [npm](https://www.npmjs.com/package/@elsium-ai/app) | HTTP server with CORS, auth, and rate limiting |
| `@elsium-ai/mcp` | [npm](https://www.npmjs.com/package/@elsium-ai/mcp) | Model Context Protocol client and server |
| `@elsium-ai/testing` | [npm](https://www.npmjs.com/package/@elsium-ai/testing) | Mocks, fixtures, evals, snapshot testing, prompt versioning, replay |

---

## License

[MIT](https://github.com/elsium-ai/elsium-ai/blob/main/LICENSE) - Copyright (c) 2026 Eric Utrera
