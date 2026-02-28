/**
 * ElsiumAI — Single import for the entire framework.
 *
 * Instead of importing from multiple packages:
 *   import { env } from '@elsium-ai/core'
 *   import { gateway } from '@elsium-ai/gateway'
 *   import { defineAgent } from '@elsium-ai/agents'
 *
 * You can import everything from one place:
 *   import { env, gateway, defineAgent } from 'elsium-ai'
 */

// ─── Core ───────────────────────────────────────────────────────
export {
	// Errors
	ElsiumError,
	// Result pattern
	ok,
	err,
	isOk,
	isErr,
	unwrap,
	unwrapOr,
	tryCatch,
	tryCatchSync,
	// Streaming
	createStream,
	// Logger
	createLogger,
	// Config
	env,
	envNumber,
	envBool,
	// Utilities
	generateId,
	generateTraceId,
	extractText,
	sleep,
	retry,
} from '@elsium-ai/core'

export type {
	// Types
	Role,
	ContentPart,
	TextContent,
	ImageContent,
	Message,
	ToolCall,
	ToolResult,
	TokenUsage,
	CostBreakdown,
	StopReason,
	LLMResponse,
	StreamEvent,
	XRayData,
	StreamCheckpoint,
	ProviderConfig,
	CompletionRequest,
	ToolDefinition,
	Middleware,
	// Result types
	Result,
	Ok,
	Err,
	// Stream types
	ElsiumStream,
	ResilientStreamOptions,
	// Logger types
	LogLevel,
	Logger,
	// Error types
	ErrorCode,
} from '@elsium-ai/core'

// ─── Gateway ────────────────────────────────────────────────────
export {
	gateway,
	registerProviderFactory,
	calculateCost,
	registerPricing,
	composeMiddleware,
	loggingMiddleware,
	costTrackingMiddleware,
	xrayMiddleware,
	createAnthropicProvider,
	createOpenAIProvider,
	createGoogleProvider,
	createProviderMesh,
} from '@elsium-ai/gateway'

export type {
	LLMProvider,
	ProviderFactory,
	Gateway,
	GatewayConfig,
	XRayStore,
	ProviderMeshConfig,
	ProviderEntry,
	RoutingStrategy,
	ProviderMesh,
} from '@elsium-ai/gateway'

// ─── Agents ─────────────────────────────────────────────────────
export {
	defineAgent,
	runSequential,
	runParallel,
	runSupervisor,
	createMemory,
	createSemanticValidator,
} from '@elsium-ai/agents'

export type {
	Agent,
	AgentDependencies,
	AgentConfig,
	AgentResult,
	AgentRunOptions,
	GuardrailConfig,
	AgentHooks,
	Memory,
	MemoryConfig,
	SemanticGuardrailConfig,
	SemanticCheck,
	SemanticCheckResult,
	SemanticValidationResult,
	SemanticValidator,
} from '@elsium-ai/agents'

// ─── Tools ──────────────────────────────────────────────────────
export {
	defineTool,
	createToolkit,
	httpFetchTool,
	calculatorTool,
	jsonParseTool,
	currentTimeTool,
	formatToolResult,
	formatToolResultAsText,
} from '@elsium-ai/tools'

export type {
	Tool,
	ToolConfig,
	ToolContext,
	ToolExecutionResult,
	Toolkit,
} from '@elsium-ai/tools'

// ─── RAG ────────────────────────────────────────────────────────
export {
	rag,
	createInMemoryStore,
	createOpenAIEmbeddings,
	createMockEmbeddings,
} from '@elsium-ai/rag'

export type {
	RAGPipeline,
	RAGPipelineConfig,
	IngestResult,
	Document,
	Chunk,
	EmbeddedChunk,
	RetrievalResult,
	QueryOptions,
	EmbeddingProvider,
	VectorStore,
} from '@elsium-ai/rag'

// ─── Workflows ──────────────────────────────────────────────────
export {
	defineWorkflow,
	defineParallelWorkflow,
	defineBranchWorkflow,
	step,
} from '@elsium-ai/workflows'

export type {
	Workflow,
	WorkflowConfig,
	WorkflowResult,
	WorkflowRunOptions,
	StepConfig,
	StepContext,
	StepResult,
} from '@elsium-ai/workflows'

// ─── Observe ────────────────────────────────────────────────────
export {
	observe,
	createSpan,
	createMetrics,
	createCostEngine,
	// OpenTelemetry
	toOTelSpan,
	toOTelExportRequest,
	toTraceparent,
	parseTraceparent,
	injectTraceContext,
	extractTraceContext,
	createOTLPExporter,
} from '@elsium-ai/observe'

export type {
	Tracer,
	TracerConfig,
	TracerExporter,
	CostReport,
	Span,
	SpanData,
	SpanKind,
	SpanStatus,
	MetricsCollector,
	MetricEntry,
	CostEngine,
	CostEngineConfig,
	CostAlert,
	CostDimension,
	CostIntelligenceReport,
	ModelSuggestion,
	// OTel types
	OTelSpan,
	OTelExportRequest,
	TraceContext,
	OTLPExporterConfig,
} from '@elsium-ai/observe'

// ─── App ────────────────────────────────────────────────────────
export { createApp } from '@elsium-ai/app'

export type {
	AppConfig,
	ServerConfig,
	CorsConfig,
	AuthConfig,
	RateLimitConfig,
} from '@elsium-ai/app'

// ─── MCP ────────────────────────────────────────────────────────
export { createMCPClient, createMCPServer } from '@elsium-ai/mcp'

export type {
	MCPClient,
	MCPClientConfig,
	MCPToolInfo,
	MCPServer,
	MCPServerConfig,
} from '@elsium-ai/mcp'

// ─── Testing ────────────────────────────────────────────────────
export {
	mockProvider,
	createFixture,
	loadFixture,
	createRecorder,
	runEvalSuite,
	formatEvalReport,
	createSnapshotStore,
	createPromptRegistry,
	definePrompt,
	createRegressionSuite,
	createReplayRecorder,
	createReplayPlayer,
} from '@elsium-ai/testing'

export type {
	MockProviderOptions,
	MockResponseConfig,
	MockProvider,
	EvalSuiteConfig,
	EvalCase,
	EvalCriterion,
	EvalResult,
	EvalSuiteResult,
	LLMJudge,
	SnapshotStore,
	PromptDefinition,
	PromptDiff,
	PromptRegistry,
	RegressionBaseline,
	RegressionResult,
	RegressionDetail,
	RegressionSuite,
	ReplayEntry,
	ReplayRecorder,
	ReplayPlayer,
} from '@elsium-ai/testing'
