import type { CompletionRequest, LLMResponse, Message } from '@elsium-ai/core'
import type { Span } from '@elsium-ai/observe'
import type { Tool, ToolExecutionResult } from '@elsium-ai/tools'
import type { ConfidenceConfig, ConfidenceResult } from './confidence'
import type { MemoryConfig } from './memory'
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
}

export interface GuardrailConfig {
	maxIterations?: number
	maxTokenBudget?: number
	inputValidator?: (input: string) => boolean | string
	outputValidator?: (output: string) => boolean | string
	semantic?: SemanticGuardrailConfig
	security?: AgentSecurityConfig
}

// ─── State Machine Types ────────────────────────────────────────

export interface StateDefinition {
	system?: string
	tools?: Tool[]
	guardrails?: GuardrailConfig
	transition: (result: AgentResult) => string
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
}
