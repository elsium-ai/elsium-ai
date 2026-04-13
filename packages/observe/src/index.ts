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
	CostIntelligenceReport,
	ModelSuggestion,
	ModelTierEntry,
} from './cost-engine'

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
} from './otel'
