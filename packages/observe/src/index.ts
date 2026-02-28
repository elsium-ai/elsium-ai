// Span
export { createSpan } from './span'
export type { Span, SpanData, SpanEvent, SpanKind, SpanStatus, SpanHandler } from './span'

// Cost Engine
export { createCostEngine } from './cost-engine'
export type {
	CostEngine,
	CostEngineConfig,
	BudgetConfig,
	LoopDetectionConfig,
	CostAlert,
	CostDimension,
	CostIntelligenceReport,
	ModelSuggestion,
} from './cost-engine'

// Tracer
export { observe } from './tracer'
export type { Tracer, TracerConfig, TracerOutput, TracerExporter, CostReport } from './tracer'

// Metrics
export { createMetrics } from './metrics'
export type { MetricsCollector, MetricEntry } from './metrics'

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
