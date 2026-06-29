import type { Message } from '@elsium-ai/core'
import type { LLMProvider, ProviderMesh } from '@elsium-ai/gateway'
import type { Tool, ToolExecutionResult } from '@elsium-ai/tools'
import type { ApprovalGateConfig } from './approval'
import type { ConfidenceConfig, ConfidenceResult } from './confidence'
import type { AgentIdentityConfig } from './identity'
import type { MemoryConfig } from './memory'
import type { RuntimePolicyConfig } from './runtime-policy'
import type { AgentSecurityConfig } from './security'
import type { SemanticGuardrailConfig } from './semantic-guardrails'

export interface AgentConfig {
	name: string
	model?: string
	system: string
	tools?: Tool[]
	memory?: MemoryConfig
	guardrails?: GuardrailConfig
	hooks?: AgentHooks
	confidence?: boolean | ConfidenceConfig
	states?: Record<string, StateDefinition>
	initialState?: string
	provider?: string | LLMProvider | ProviderMesh
	apiKey?: string
	baseUrl?: string
	identity?: AgentIdentityConfig
	/**
	 * Seed forwarded to every LLM request for reproducibility. Honored by
	 * providers that support seeding; captured in the request hash of signed
	 * proofs. Overridable per-run via `AgentRunOptions.seed`.
	 */
	seed?: number
}

export interface GuardrailConfig {
	maxIterations?: number
	maxTokenBudget?: number
	maxDurationMs?: number
	inputValidator?: (input: string) => boolean | string
	outputValidator?: (output: string) => boolean | string
	semantic?: SemanticGuardrailConfig
	security?: AgentSecurityConfig
	approval?: ApprovalGateConfig
	runtimePolicy?: RuntimePolicyConfig
}

// ─── State Machine Types ────────────────────────────────────────

export interface StateTransitionResult {
	next: string
	context?: Record<string, unknown>
}

export interface StateDefinition {
	system?: string
	tools?: Tool[]
	guardrails?: GuardrailConfig
	transition: (
		result: AgentResult,
		stateContext?: Record<string, unknown>,
	) => string | StateTransitionResult
	terminal?: boolean
}

export interface StateHistoryEntry {
	state: string
	result: AgentResult
	transitionedTo: string | null
}

export interface StateMachineResult extends AgentResult {
	stateHistory: StateHistoryEntry[]
	finalState: string
}

export interface AgentHooks {
	onMessage?: (message: Message) => void | Promise<void>
	onToolCall?: (call: { name: string; arguments: Record<string, unknown> }) => void | Promise<void>
	onToolResult?: (result: ToolExecutionResult) => void | Promise<void>
	onError?: (error: Error) => void | Promise<void>
	onComplete?: (result: AgentResult) => void | Promise<void>
}

export interface AgentResult {
	message: Message
	usage: {
		totalInputTokens: number
		totalOutputTokens: number
		totalTokens: number
		totalCost: number
		iterations: number
	}
	toolCalls: Array<{
		name: string
		arguments: Record<string, unknown>
		result: ToolExecutionResult
	}>
	traceId: string
	confidence?: ConfidenceResult
}

export interface AgentRunOptions {
	signal?: AbortSignal
	traceId?: string
	metadata?: Record<string, unknown>
	/** Per-run seed override; falls back to `AgentConfig.seed`. */
	seed?: number
}
