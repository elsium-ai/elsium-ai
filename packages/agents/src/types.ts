import type { CompletionRequest, LLMResponse, Message } from '@elsium-ai/core'
import type { Span } from '@elsium-ai/observe'
import type { Tool, ToolExecutionResult } from '@elsium-ai/tools'
import type { MemoryConfig } from './memory'
import type { SemanticGuardrailConfig } from './semantic-guardrails'

export interface AgentConfig {
	name: string
	model?: string
	system: string
	tools?: Tool[]
	memory?: MemoryConfig
	guardrails?: GuardrailConfig
	hooks?: AgentHooks
}

export interface GuardrailConfig {
	maxIterations?: number
	maxTokenBudget?: number
	inputValidator?: (input: string) => boolean | string
	outputValidator?: (output: string) => boolean | string
	semantic?: SemanticGuardrailConfig
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
}

export interface AgentRunOptions {
	signal?: AbortSignal
	traceId?: string
	metadata?: Record<string, unknown>
}
