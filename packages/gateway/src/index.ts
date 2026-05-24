// Gateway
export { gateway, registerProviderFactory } from './gateway'
export type { GatewayConfig, Gateway, ExtractOptions } from './gateway'

// Standalone structured generation
export { generateObject } from './generate-object'
export type { GenerateObjectOptions } from './generate-object'

// Provider
export type {
	LLMProvider,
	ProviderFactory,
	ProviderMetadata,
	ModelPricing,
	ModelTier,
} from './provider'
export {
	registerProvider,
	getProviderFactory,
	listProviders,
	registerProviderMetadata,
	getProviderMetadata,
} from './provider'

// Providers
export { createAnthropicProvider } from './providers/anthropic'
export { createOpenAIProvider } from './providers/openai'
export { createGoogleProvider } from './providers/google'
export { createOpenAICompatibleProvider } from './providers/openai-compatible'
export type { OpenAICompatibleConfig } from './providers/openai-compatible'

// Middleware
export {
	composeMiddleware,
	composeStreamMiddleware,
	loggingMiddleware,
	costTrackingMiddleware,
	xrayMiddleware,
} from './middleware'
export type { XRayStore } from './middleware'

// Security
export {
	securityMiddleware,
	detectPromptInjection,
	detectJailbreak,
	redactSecrets,
	checkBlockedPatterns,
	classifyContent,
} from './security'
export type {
	SecurityMiddlewareConfig,
	SecurityViolation,
	SecurityResult,
	DataClassification,
	ClassificationResult,
} from './security'

// Bulkhead
export { createBulkhead, bulkheadMiddleware } from './bulkhead'
export type { BulkheadConfig, Bulkhead } from './bulkhead'

// Cache
export { cacheMiddleware, createInMemoryCache } from './cache'
export type { CacheAdapter, CacheStats, CacheMiddlewareConfig } from './cache'

// Output Guardrails
export { outputGuardrailMiddleware } from './output-guardrails'
export type {
	OutputGuardrailConfig,
	OutputGuardrailRule,
	OutputViolation,
} from './output-guardrails'

// Pricing
export { calculateCost, registerPricing, estimateCost } from './pricing'

// Batch
export { createBatch } from './batch'
export type { BatchConfig, BatchResult, BatchResultItem } from './batch'

// Router
export { createProviderMesh } from './router'
export type {
	ProviderMeshConfig,
	ProviderEntry,
	RoutingStrategy,
	ProviderMesh,
	MeshAuditLogger,
} from './router'

// Declarative Routing Policy (R3 — data-driven routing decisions)
export { createDeclarativeRouter } from './routing-policy'
export type {
	DeclarativeRouter,
	RoutingContext,
	RoutingPolicy,
	RoutingResolution,
	RoutingRule,
	RoutingTarget,
	ServiceLevelObjective,
} from './routing-policy'

// Fair queue per-agent (R6 — token-bucket rate limiter, in-process only)
export { createFairQueue } from './fair-queue'
export type { BucketConfig, BucketState, FairQueue, FairQueueConfig } from './fair-queue'

// PII classification + jurisdiction routing (G5)
export { createPiiClassifier, createJurisdictionRouter } from './pii-routing'
export type {
	JurisdictionPolicy,
	JurisdictionResolution,
	JurisdictionRouter,
	JurisdictionRouterConfig,
	JurisdictionRules,
	PiiClass,
	PiiClassifier,
	PiiMatch,
} from './pii-routing'
