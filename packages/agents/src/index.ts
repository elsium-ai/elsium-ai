// Agent
export { defineAgent } from './agent'
export type { Agent, AgentDependencies, AgentGenerateResult } from './agent'

// Types
export type {
	AgentConfig,
	AgentResult,
	AgentRunOptions,
	AgentHooks,
	GuardrailConfig,
	StateDefinition,
	StateTransitionResult,
	StateHistoryEntry,
	StateMachineResult,
} from './types'

// Memory
export { createMemory, createSummarizeFn } from './memory'
export type { Memory, MemoryConfig, MemoryStrategy, SummarizeFn } from './memory'

// Memory Stores
export { createInMemoryMemoryStore, createSqliteMemoryStore } from './stores/index'
export type { MemoryStore, SqliteMemoryStoreConfig } from './stores/index'

// Shared Memory
export { createSharedMemory } from './shared-memory'
export type { SharedMemory } from './shared-memory'

// Multi-agent
export { runSequential, runParallel, runSupervisor } from './multi'
export type { MultiAgentConfig, MultiAgentOptions } from './multi'

// Semantic Guardrails
export { createSemanticValidator } from './semantic-guardrails'
export type {
	SemanticGuardrailConfig,
	SemanticCheck,
	SemanticCheckResult,
	SemanticValidationResult,
	SemanticValidator,
} from './semantic-guardrails'

// Security
export { createAgentSecurity } from './security'
export type { AgentSecurityConfig, AgentSecurityResult } from './security'

// Confidence
export { createConfidenceScorer } from './confidence'
export type { ConfidenceConfig, ConfidenceResult } from './confidence'

// State Machine
export { executeStateMachine } from './state-machine'

// Streaming
export { createAgentStream } from './streaming'
export type { AgentStreamEvent, AgentStream, StreamingAgentDependencies } from './streaming'

// Threads
export { createThread, loadThread, createInMemoryThreadStore } from './thread'
export type { Thread, ThreadConfig, ThreadStore, ThreadSnapshot, ThreadSummary } from './thread'

// Async Agent
export { createAsyncAgent } from './async-agent'
export type {
	AsyncAgent,
	AsyncAgentConfig,
	AsyncAgentRunOptions,
	AgentTask,
	TaskStatus,
	TaskProgressEvent,
} from './async-agent'

// Approval Gates
export { createApprovalGate, shouldRequireApproval } from './approval'
export type {
	ApprovalRequest,
	ApprovalDecision,
	ApprovalCallback,
	ApprovalGateConfig,
	ApprovalGate,
} from './approval'

// Channels
export { createChannelGateway, createWebhookChannel } from './channels'
export type {
	ChannelAdapter,
	ChannelGateway,
	ChannelGatewayConfig,
	IncomingMessage,
	OutgoingMessage,
	ChannelAttachment,
	WebhookChannelConfig,
} from './channels'

// Session Router
export { createSessionRouter } from './session'
export type {
	SessionRouter,
	SessionRouterConfig,
	SessionInfo,
	SessionResolveOptions,
} from './session'

// ReAct Agent
export { defineReActAgent } from './react'
export type { ReActConfig, ReActResult, ReActStep, ReActAgent } from './react'

// Scheduler
export { createScheduler, parseCronExpression, cronMatchesDate, getNextCronDate } from './scheduler'
export type {
	Scheduler,
	SchedulerConfig,
	ScheduleOptions,
	ScheduledTask,
	CronFields,
} from './scheduler'

// Agent Identity
export { createAgentIdentity, createIdentityRegistry } from './identity'
export type {
	AgentIdentity,
	AgentIdentityConfig,
	SignedPayload,
	VerificationResult,
	IdentityRegistry,
} from './identity'

// Runtime Policy
export {
	createRuntimePolicyEnforcer,
	toolAccessPolicy,
	iterationLimitPolicy,
} from './runtime-policy'
export type {
	RuntimePolicyConfig,
	RuntimePolicyEnforcer,
	ToolPolicyContext,
} from './runtime-policy'

// Memory Integrity
export {
	createSecureMemoryStore,
	computeMessageHash,
	verifyMessageChain,
} from './stores/index'
export type {
	SecureMemoryStore,
	IntegrityMetadata,
	VerifiedMessage,
	MemoryIntegrityResult,
} from './stores/index'
