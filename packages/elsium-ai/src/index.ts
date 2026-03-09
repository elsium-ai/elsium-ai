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
	// Schema
	zodToJsonSchema,
	// Registry
	createRegistry,
	// Tokens
	countTokens,
	createContextManager,
} from '@elsium-ai/core'

export type {
	// Types
	Role,
	ContentPart,
	TextContent,
	ImageContent,
	AudioContent,
	DocumentContent,
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
	TenantContext,
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
	// Registry types
	Registry,
	// Token types
	ContextStrategy,
	ContextManagerConfig,
	ContextManager,
} from '@elsium-ai/core'

// ─── Gateway ────────────────────────────────────────────────────
export {
	gateway,
	registerProviderFactory,
	registerProvider,
	getProviderFactory,
	listProviders,
	registerProviderMetadata,
	getProviderMetadata,
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
	securityMiddleware,
	detectPromptInjection,
	detectJailbreak,
	redactSecrets,
	checkBlockedPatterns,
	// Cache
	cacheMiddleware,
	createInMemoryCache,
	// Output Guardrails
	outputGuardrailMiddleware,
	// Batch
	createBatch,
} from '@elsium-ai/gateway'

export type {
	LLMProvider,
	ProviderFactory,
	ProviderMetadata,
	ModelPricing,
	ModelTier,
	Gateway,
	GatewayConfig,
	XRayStore,
	ProviderMeshConfig,
	ProviderEntry,
	RoutingStrategy,
	ProviderMesh,
	MeshAuditLogger,
	SecurityMiddlewareConfig,
	SecurityViolation,
	SecurityResult,
	// Cache types
	CacheAdapter,
	CacheStats,
	CacheMiddlewareConfig,
	// Output Guardrail types
	OutputGuardrailConfig,
	OutputGuardrailRule,
	OutputViolation,
	// Batch types
	BatchConfig,
	BatchResult,
	BatchResultItem,
} from '@elsium-ai/gateway'

// ─── Agents ─────────────────────────────────────────────────────
export {
	defineAgent,
	runSequential,
	runParallel,
	runSupervisor,
	createMemory,
	createSummarizeFn,
	createSemanticValidator,
	createAgentSecurity,
	createConfidenceScorer,
	executeStateMachine,
	// Memory Stores
	createInMemoryMemoryStore,
	createSqliteMemoryStore,
	// Streaming
	createAgentStream,
	// Threads
	createThread,
	loadThread,
	createInMemoryThreadStore,
	// Async Agent
	createAsyncAgent,
	// Channels
	createChannelGateway,
	createWebhookChannel,
	// Session Router
	createSessionRouter,
	// Scheduler
	createScheduler,
	parseCronExpression,
	cronMatchesDate,
	getNextCronDate,
} from '@elsium-ai/agents'

export type {
	Agent,
	AgentDependencies,
	AgentGenerateResult,
	AgentConfig,
	AgentResult,
	AgentRunOptions,
	GuardrailConfig,
	AgentHooks,
	Memory,
	MemoryConfig,
	SummarizeFn,
	SemanticGuardrailConfig,
	SemanticCheck,
	SemanticCheckResult,
	SemanticValidationResult,
	SemanticValidator,
	AgentSecurityConfig,
	AgentSecurityResult,
	ConfidenceConfig,
	ConfidenceResult,
	StateDefinition,
	StateHistoryEntry,
	StateMachineResult,
	// Memory Store types
	MemoryStore,
	SqliteMemoryStoreConfig,
	// Streaming types
	AgentStreamEvent,
	AgentStream,
	StreamingAgentDependencies,
	// Thread types
	Thread,
	ThreadConfig,
	ThreadStore,
	ThreadSnapshot,
	ThreadSummary,
	// Async Agent types
	AsyncAgent,
	AsyncAgentConfig,
	AsyncAgentRunOptions,
	AgentTask,
	TaskStatus,
	TaskProgressEvent,
	// Channel types
	ChannelAdapter,
	ChannelGateway,
	ChannelGatewayConfig,
	IncomingMessage,
	OutgoingMessage,
	ChannelAttachment,
	WebhookChannelConfig,
	// Session Router types
	SessionRouter,
	SessionRouterConfig,
	SessionInfo,
	SessionResolveOptions,
	// Scheduler types
	Scheduler,
	SchedulerConfig,
	ScheduleOptions,
	ScheduledTask,
	CronFields,
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
	createRetrievalTool,
} from '@elsium-ai/tools'

export type {
	Tool,
	ToolConfig,
	ToolContext,
	ToolExecutionResult,
	Toolkit,
	RetrievalToolConfig,
	RetrievalResult as ToolRetrievalResult,
	RetrieveFn,
} from '@elsium-ai/tools'

// ─── RAG ────────────────────────────────────────────────────────
export {
	rag,
	createInMemoryStore,
	createOpenAIEmbeddings,
	createMockEmbeddings,
	// Registries
	vectorStoreRegistry,
	embeddingProviderRegistry,
	// Stores
	createPgVectorStore,
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
	VectorStoreFactory,
	EmbeddingProviderFactory,
	PgVectorStoreConfig,
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
	// Experiment
	createExperiment,
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
	// Experiment types
	Experiment,
	ExperimentConfig,
	ExperimentVariant,
	ExperimentResults,
	// OTel types
	OTelSpan,
	OTelExportRequest,
	TraceContext,
	OTLPExporterConfig,
} from '@elsium-ai/observe'

// ─── App ────────────────────────────────────────────────────────
export {
	createApp,
	// SSE
	sseHeaders,
	formatSSE,
	streamResponse,
	// Tenant
	tenantMiddleware,
	tenantRateLimitMiddleware,
} from '@elsium-ai/app'

export type {
	AppConfig,
	ServerConfig,
	CorsConfig,
	AuthConfig,
	RateLimitConfig,
	StreamChatEvent,
	StreamCompleteEvent,
	TenantMiddlewareConfig,
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

// ─── Client ─────────────────────────────────────────────────────
export { createClient } from '@elsium-ai/client'

export type {
	ElsiumClient,
	ClientConfig,
} from '@elsium-ai/client'

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
