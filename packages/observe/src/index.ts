// Span
export { createSpan } from './span'
export type { Span, SpanData, SpanEvent, SpanKind, SpanStatus, SpanHandler } from './span'

// Cost Engine
export { createCostEngine, registerModelTier } from './cost-engine'
export type {
	CostEngine,
	CostEngineConfig,
	BudgetConfig,
	LoopDetectionConfig,
	CostAlert,
	CostDimension,
	CostAttributionDimensions,
	CostIntelligenceReport,
	ModelSuggestion,
	ModelTierEntry,
} from './cost-engine'

// Budget-aware Routing Policy (prescriptive — auto-downgrade + reject)
export { createBudgetAwareRoutingPolicy } from './budget-routing'
export type { BudgetAwareRoutingConfig, BudgetAction } from './budget-routing'

// Drift Detection (O5 — observability of model-version drift)
export { detectDrift } from './drift'
export type {
	DriftDetectionConfig,
	DriftReport,
	DriftSample,
	DriftWeights,
	PerInputComparison,
	SimilarityProvider,
} from './drift'

// Cost Store (O2b — port + in-memory reference adapter).
// Production durability is the user's call: implement CostStore against your
// chosen backend (SQLite, Postgres, Redis, …). No DB drivers in this package.
export { createLocalCostStore } from './cost-store'
export type {
	CostAttribution,
	CostBucket,
	CostDimensionKey,
	CostRecord,
	CostStore,
	LocalCostStoreOptions,
	ReservationToken,
	TimeWindow,
} from './cost-store'

// Tracer
export { observe } from './tracer'
export type { Tracer, TracerConfig, TracerOutput, TracerExporter, CostReport } from './tracer'

// Metrics
export { createMetrics } from './metrics'
export type { MetricsCollector, MetricEntry } from './metrics'

// Audit Trail
export { createAuditTrail, auditMiddleware, auditStreamMiddleware } from './audit'
export type {
	AuditEventType,
	AuditEvent,
	AuditStorageAdapter,
	AuditQueryFilter,
	AuditIntegrityResult,
	AuditTrailConfig,
	AuditBatchConfig,
	AuditTrail,
} from './audit'

// Audit Sinks
export { createSinkManager } from './audit-sink'
export type { AuditSink, AuditSinkRetryConfig, SinkManagerConfig, SinkManager } from './audit-sink'
export { createWebhookSink } from './audit-sink-webhook'
export type { WebhookSinkConfig } from './audit-sink-webhook'
export { createSplunkSink } from './audit-sink-splunk'
export type { SplunkSinkConfig } from './audit-sink-splunk'
export { createDatadogSink } from './audit-sink-datadog'
export type { DatadogSinkConfig } from './audit-sink-datadog'
export { createJsonlSink } from './audit-sink-jsonl'
export type { JsonlSinkConfig } from './audit-sink-jsonl'

// Provenance
export { createProvenanceTracker } from './provenance'
export type { ProvenanceRecord, ProvenanceTracker } from './provenance'

// Experiment
export { createExperiment, createFileExperimentStore } from './experiment'
export type {
	Experiment,
	ExperimentConfig,
	ExperimentVariant,
	ExperimentResults,
	ExperimentStore,
} from './experiment'

// Auto-instrumentation
export { instrumentComplete, instrumentAgent } from './instrument'
export type { InstrumentableAgent } from './instrument'

// Studio Exporter
export { createStudioExporter } from './studio-exporter'
export type { StudioExporter, StudioExporterConfig } from './studio-exporter'

// Compliance Reporting
export { generateComplianceReport, formatComplianceReport } from './compliance'
export type {
	ComplianceFramework,
	ComplianceReportConfig,
	ComplianceCheck,
	ComplianceCheckResult,
	ComplianceReport,
	ComplianceSummary,
	ComplianceReportEntry,
} from './compliance'

// OpenTelemetry compatibility
export {
	toOTelSpan,
	toOTelExportRequest,
	toTraceparent,
	parseTraceparent,
	injectTraceContext,
	extractTraceContext,
	createOTLPExporter,
} from './otel'
export type {
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
	ToOTelSpanOptions,
} from './otel'

// Verifiable Agent Execution — proof recorder for per-run signed execution proofs.
// Builds on @elsium-ai/core/crypto (Ed25519 + WriteOnceStore).
export {
	createProofRecorder,
	verifyProof,
	PROOF_SESSION_METADATA_KEY,
	PROOF_VERSION,
} from './proof'
export type {
	ProofRecorder,
	ProofRecorderConfig,
	ProofSession,
	ProofSessionInputs,
	StartSessionOptions,
	FinalizeOptions,
	ExecutionProof,
	ProofEvent,
	ProofEventType,
	ReproducibilityHints,
	VerifyProofResult,
	LLMCallSummary,
	ToolCallSummary,
	RagRetrieveSummary,
	PolicyDecisionSummary,
	ProofInputDocRef,
} from './proof'

// OpenTelemetry GenAI Semantic Conventions (in Development per OTel spec).
// Dual emission policy controlled by OTEL_SEMCONV_STABILITY_OPT_IN.
export {
	createEmissionPolicy,
	createGenAIConventionRegistry,
	getDefaultRegistry,
	parseSemconvOptIn,
} from './gen-ai-conventions'
export type {
	GenAIAttributes,
	GenAIConventionRegistry,
	GenAIMapper,
	GenAIOperationName,
	GenAIRequestAttributes,
	GenAIResponseAttributes,
	GenAISpecVersion,
	GenAIToolAttributes,
	EmissionPolicy,
	EmissionPolicyConfig,
	SemconvStabilityConfig,
	SemconvStabilityFlag,
} from './gen-ai-conventions'
