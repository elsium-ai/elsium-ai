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
	ElsiumStream,
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
	// Circuit Breaker
	createCircuitBreaker,
	// Dedup
	createDedup,
	dedupMiddleware,
	// Policy
	createPolicySet,
	policyMiddleware,
	modelAccessPolicy,
	tokenLimitPolicy,
	costLimitPolicy,
	contentPolicy,
	// Shutdown
	createShutdownManager,
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
	MiddlewareContext,
	MiddlewareNext,
	StreamMiddleware,
	StreamMiddlewareNext,
	// Result types
	Result,
	Ok,
	Err,
	// Stream types
	ResilientStreamOptions,
	StreamTransformer,
	// Logger types
	LogLevel,
	Logger,
	LogEntry,
	LoggerOptions,
	// Error types
	ErrorCode,
	ErrorDetails,
	// Registry types
	Registry,
	// Token types
	ContextStrategy,
	ContextManagerConfig,
	ContextManager,
	// Circuit Breaker types
	CircuitBreakerConfig,
	CircuitBreaker,
	CircuitState,
	// Dedup types
	DedupConfig,
	Dedup,
	// Policy types
	PolicyDecision,
	PolicyResult,
	PolicyContext,
	PolicyRule,
	PolicyConfig,
	PolicySet,
	// Shutdown types
	ShutdownConfig,
	ShutdownManager,
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
	estimateCost,
	composeMiddleware,
	composeStreamMiddleware,
	loggingMiddleware,
	costTrackingMiddleware,
	xrayMiddleware,
	createAnthropicProvider,
	createOpenAIProvider,
	createGoogleProvider,
	createOpenAICompatibleProvider,
	createProviderMesh,
	securityMiddleware,
	detectPromptInjection,
	detectJailbreak,
	redactSecrets,
	checkBlockedPatterns,
	classifyContent,
	// Cache
	cacheMiddleware,
	createInMemoryCache,
	// Output Guardrails
	outputGuardrailMiddleware,
	// Batch
	createBatch,
	// Bulkhead
	createBulkhead,
	bulkheadMiddleware,
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
	DataClassification,
	ClassificationResult,
	OpenAICompatibleConfig,
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
	// Bulkhead types
	BulkheadConfig,
	Bulkhead,
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
	// ReAct Agent
	defineReActAgent,
	// Memory Stores
	createInMemoryMemoryStore,
	createSqliteMemoryStore,
	// Shared Memory
	createSharedMemory,
	// Streaming
	createAgentStream,
	// Threads
	createThread,
	loadThread,
	createInMemoryThreadStore,
	// Async Agent
	createAsyncAgent,
	// Approval Gates
	createApprovalGate,
	shouldRequireApproval,
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
	// ReAct types
	ReActConfig,
	ReActResult,
	ReActStep,
	ReActAgent,
	// Multi-agent types
	MultiAgentConfig,
	MultiAgentOptions,
	// Memory Store types
	MemoryStore,
	SqliteMemoryStoreConfig,
	// Shared Memory types
	SharedMemory,
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
	// Approval types
	ApprovalRequest,
	ApprovalDecision,
	ApprovalCallback,
	ApprovalGateConfig,
	ApprovalGate,
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
	// Loaders
	textLoader,
	markdownLoader,
	htmlLoader,
	jsonLoader,
	csvLoader,
	getLoader,
	// PDF
	pdfLoader,
	// Chunkers
	fixedSizeChunker,
	recursiveChunker,
	sentenceChunker,
	getChunker,
	// Similarity
	cosineSimilarity,
	mmrRerank,
	// Registries
	vectorStoreRegistry,
	embeddingProviderRegistry,
	// Stores
	createPgVectorStore,
	createQdrantStore,
	// Embedding Providers
	createGoogleEmbeddings,
	createCohereEmbeddings,
	// BM25
	createBM25Index,
	// Hybrid Search
	createHybridSearch,
} from '@elsium-ai/rag'

export type {
	RAGPipeline,
	RAGPipelineConfig,
	IngestResult,
	Document,
	DocumentMetadata,
	Chunk,
	ChunkMetadata,
	EmbeddedChunk,
	EmbeddingVector,
	RetrievalResult,
	QueryOptions,
	LoaderType,
	ChunkingStrategy,
	ChunkingConfig,
	EmbeddingConfig,
	VectorStoreConfig,
	RetrievalConfig,
	EmbeddingProvider,
	VectorStore,
	VectorStoreFactory,
	EmbeddingProviderFactory,
	DocumentLoader,
	Chunker,
	PgVectorStoreConfig,
	QdrantStoreConfig,
	GoogleEmbeddingsConfig,
	CohereEmbeddingsConfig,
	BinaryDocumentLoader,
	PdfLoaderOptions,
	BM25Index,
	HybridSearch,
	HybridSearchConfig,
} from '@elsium-ai/rag'

// ─── Workflows ──────────────────────────────────────────────────
export {
	defineWorkflow,
	defineParallelWorkflow,
	defineBranchWorkflow,
	defineDagWorkflow,
	defineResumableWorkflow,
	createInMemoryCheckpointStore,
	step,
} from '@elsium-ai/workflows'

export type {
	Workflow,
	WorkflowConfig,
	WorkflowResult,
	WorkflowRunOptions,
	WorkflowStatus,
	StepConfig,
	StepContext,
	StepResult,
	StepStatus,
	RetryConfig,
	ParallelWorkflowConfig,
	BranchConfig,
	DagStepConfig,
	DagWorkflowConfig,
	ResumableWorkflow,
	ResumableWorkflowConfig,
	ResumableWorkflowRunOptions,
	WorkflowCheckpoint,
	CheckpointStore,
} from '@elsium-ai/workflows'

// ─── Observe ────────────────────────────────────────────────────
export {
	observe,
	createSpan,
	createMetrics,
	createCostEngine,
	registerModelTier,
	// Audit Trail
	createAuditTrail,
	auditMiddleware,
	// Provenance
	createProvenanceTracker,
	// Experiment
	createExperiment,
	createFileExperimentStore,
	// Instrumentation
	instrumentComplete,
	instrumentAgent,
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
	TracerOutput,
	CostReport,
	Span,
	SpanData,
	SpanEvent,
	SpanKind,
	SpanStatus,
	SpanHandler,
	MetricsCollector,
	MetricEntry,
	CostEngine,
	CostEngineConfig,
	BudgetConfig,
	LoopDetectionConfig,
	CostAlert,
	CostDimension,
	CostIntelligenceReport,
	ModelSuggestion,
	ModelTierEntry,
	// Audit types
	AuditEventType,
	AuditEvent,
	AuditStorageAdapter,
	AuditQueryFilter,
	AuditIntegrityResult,
	AuditTrailConfig,
	AuditBatchConfig,
	AuditTrail,
	// Provenance types
	ProvenanceRecord,
	ProvenanceTracker,
	// Experiment types
	Experiment,
	ExperimentConfig,
	ExperimentVariant,
	ExperimentResults,
	ExperimentStore,
	// Instrumentation types
	InstrumentableAgent,
	// OTel types
	OTelSpan,
	OTelSpanKind,
	OTelStatusCode,
	OTelAttribute,
	OTelAttributeValue,
	OTelEvent,
	OTelResource,
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
export { createMCPClient, createMCPServer, createMCPHttpHandler } from '@elsium-ai/mcp'

export type {
	MCPClient,
	MCPClientConfig,
	MCPClientStdioConfig,
	MCPClientHttpConfig,
	MCPToolInfo,
	MCPServer,
	MCPServerConfig,
	MCPHttpHandlerConfig,
	MCPHttpHandler,
	MCPResourceHandler,
	MCPPromptHandler,
	// Protocol types
	JsonRpcRequest,
	JsonRpcResponse,
	MCPTransport,
	MCPResource,
	MCPResourceContent,
	MCPPrompt,
	MCPPromptArgument,
	MCPPromptMessage,
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
