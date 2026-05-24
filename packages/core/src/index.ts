// Types
export type {
	Role,
	TextContent,
	ImageContent,
	AudioContent,
	DocumentContent,
	ContentPart,
	ToolCall,
	ToolResult,
	Message,
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
	MiddlewareContext,
	MiddlewareNext,
	Middleware,
	StreamMiddleware,
	StreamMiddlewareNext,
} from './types'

// Errors
export { ElsiumError } from './errors'
export type { ErrorCode, ErrorDetails } from './errors'

// Result
export { ok, err, isOk, isErr, unwrap, unwrapOr, tryCatch, tryCatchSync } from './result'
export type { Result, Ok, Err } from './result'

// Stream
export { ElsiumStream, createStream } from './stream'
export type { StreamTransformer, ResilientStreamOptions } from './stream'

// Stream — typed tool call helper (opt-in narrowing per tool)
export { withToolTypes } from './stream-typed'
export type {
	ToolSchemaMap,
	ToolArgs,
	TypedStreamEvent,
	TypedToolCallComplete,
	UnknownToolCallComplete,
} from './stream-typed'

// Logger
export { createLogger } from './logger'
export type { Logger, LogLevel, LogEntry, LoggerOptions } from './logger'

// Config
export { env, envNumber, envBool } from './config'

// Schema
export { zodToJsonSchema } from './schema'

// Registry
export { createRegistry } from './registry'
export type { Registry } from './registry'

// Tokens
export { countTokens, createContextManager } from './tokens'
export type { ContextStrategy, ContextManagerConfig, ContextManager } from './tokens'

// Utils
export { generateId, generateTraceId, extractText, sleep, retry } from './utils'

// Circuit Breaker
export { createCircuitBreaker } from './circuit-breaker'
export type { CircuitBreakerConfig, CircuitBreaker, CircuitState } from './circuit-breaker'

// Dedup
export { createDedup, dedupMiddleware } from './dedup'
export type { DedupConfig, Dedup } from './dedup'

// Policy — legacy closure-based (kept during v0.x; declarative form preferred)
export {
	createPolicySet,
	policyMiddleware,
	modelAccessPolicy,
	tokenLimitPolicy,
	costLimitPolicy,
	contentPolicy,
} from './policy'
export type {
	PolicyDecision,
	PolicyResult,
	PolicyContext,
	PolicyRule,
	PolicyConfig,
	PolicySet,
} from './policy'

// Policy — declarative (G3, ADR-0002 Option B: built-in evaluator)
export {
	createBuiltinEvaluator,
	createDeclarativePolicySet,
	declarativePolicyMiddleware,
	evaluateCondition,
	verifyBundle,
} from './policy-document'
export type {
	ActionSelector,
	AuthorizationRequest,
	ConditionExpression,
	DeclarativePolicyMiddlewareConfig,
	DeclarativePolicySet,
	DeclarativePolicySetConfig,
	EvaluationResult,
	MatchPattern,
	PolicyBundle,
	PolicyDocument,
	PolicyEvaluator,
	PolicySpec,
	ResourceKind,
	ResourceSelector,
	SubjectKind,
	SubjectSelector,
	VerificationIssue,
} from './policy-document'

// Shutdown
export { createShutdownManager } from './shutdown'
export type { ShutdownConfig, ShutdownManager } from './shutdown'

// Web Crypto utilities (runtime-agnostic primitives for governance code)
export {
	hmacSha256Hex,
	randomHexString,
	sha256Hex,
	timingSafeEqualHex,
	timingSafeEqualString,
} from './web-crypto'

// Crypto foundation (Ed25519 signing, key registry, tamper-evident storage)
export {
	createEd25519Signer,
	createEd25519Verifier,
	generateEd25519KeyPair,
	computeKeyFingerprint,
	publicKeyFromPem,
	privateKeyFromPem,
	createKeyRegistry,
	createInMemoryWriteOnceStore,
	createFileWriteOnceStore,
	WriteOnceConflictError,
} from './crypto'
export type {
	Signature,
	VerifyResult,
	Signer,
	Verifier,
	PublicKeyResolver,
	Ed25519KeyPair,
	KeyRegistry,
	KeyRegistryConfig,
	TrustedKey,
	AddKeyOptions,
	WriteOnceStore,
	WriteReceipt,
	FileWriteOnceStoreConfig,
} from './crypto'

// Capability tokens (β-1, β-2) — OAuth-style scoped tokens for AI agents
export {
	createCapabilityIssuer,
	createCapabilityVerifier,
	tokenSigningPayload,
	canCallTool,
	canCallLLM,
	canQueryRag,
	canUseMcp,
	checkDataClass,
	delegateToken,
	createInMemoryRevocationStore,
	CAPABILITY_TOKEN_VERSION,
} from './capability'
export type {
	CapabilityIssuer,
	CapabilityIssuerConfig,
	MintOptions,
	CapabilityVerifier,
	CapabilityVerifierConfig,
	TokenVerificationResult,
	CallToolOptions,
	CallLLMOptions,
	QueryRagOptions,
	UseMcpOptions,
	AgentCapability,
	CapabilityBudget,
	CapabilityCheckReason,
	CapabilityCheckResult,
	CapabilityDataClasses,
	CapabilityIssuerRef,
	CapabilitySubject,
	CapabilityToken,
	CapabilityTokenVersion,
	CapabilityValidity,
	DataClass,
	LLMCapability,
	McpCapability,
	RagCapability,
	ToolCapability,
	WorkflowCapability,
	DelegateOptions,
	RevocationStore,
	RevocationEntry,
	InMemoryRevocationStoreConfig,
} from './capability'
