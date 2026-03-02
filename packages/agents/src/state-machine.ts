import type { CompletionRequest, LLMResponse, Message, ToolCall } from '@elsium-ai/core'
import { ElsiumError, extractText, generateTraceId } from '@elsium-ai/core'
import type { Tool, ToolExecutionResult } from '@elsium-ai/tools'
import { formatToolResult } from '@elsium-ai/tools'
import type { AgentDependencies } from './agent'
import { type ApprovalGate, createApprovalGate, shouldRequireApproval } from './approval'
import { createAgentSecurity } from './security'
import type {
	AgentConfig,
	AgentHooks,
	AgentResult,
	AgentRunOptions,
	StateDefinition,
	StateHistoryEntry,
	StateMachineResult,
} from './types'

async function safeHook<T>(fn: (() => T | Promise<T>) | undefined): Promise<void> {
	if (!fn) return
	try {
		await fn()
	} catch (_) {
		/* hook errors are intentionally swallowed to protect the agent loop */
	}
}

export function executeStateMachine(
	baseConfig: AgentConfig,
	stateConfig: { states: Record<string, StateDefinition>; initialState: string },
	deps: AgentDependencies,
	input: string,
	options?: AgentRunOptions,
): Promise<StateMachineResult> {
	return runStateMachine(baseConfig, stateConfig, deps, input, options ?? {})
}

function handleToolCallsAndContinue(
	response: LLMResponse,
	toolMap: Map<string, Tool>,
	toolCallHistory: AgentResult['toolCalls'],
	conversationMessages: Message[],
	signal?: AbortSignal,
	hooks?: AgentHooks,
	approvalGate?: ApprovalGate | null,
	approvalConfig?: AgentConfig['guardrails'],
): Promise<void> | null {
	const toolCalls = response.message.toolCalls
	if (!toolCalls?.length || response.stopReason !== 'tool_use') {
		return null
	}

	return (async () => {
		const toolResults = await executeToolCalls(
			toolCalls,
			toolMap,
			toolCallHistory,
			signal,
			hooks,
			approvalGate,
			approvalConfig,
		)
		const toolMessage: Message = {
			role: 'tool',
			content: '',
			toolResults,
		}
		conversationMessages.push(toolMessage)
	})()
}

function evaluateTransition(
	currentState: StateDefinition,
	currentStateName: string,
	result: AgentResult,
	stateConfig: { states: Record<string, StateDefinition>; initialState: string },
	stateHistory: StateHistoryEntry[],
	conversationMessages: Message[],
): { nextStateName: string; nextState: StateDefinition } {
	const nextStateName = currentState.transition(result)
	const nextState = stateConfig.states[nextStateName]

	if (!nextState) {
		throw new ElsiumError({
			code: 'VALIDATION_ERROR',
			message: `Transition target state "${nextStateName}" not found`,
			retryable: false,
		})
	}

	stateHistory.push({
		state: currentStateName,
		result,
		transitionedTo: nextStateName,
	})

	conversationMessages.push({
		role: 'user',
		content: `[State transition: ${currentStateName} → ${nextStateName}] Continue based on the previous response.`,
	})

	return { nextStateName, nextState }
}

function checkAbortSignal(options: AgentRunOptions, agentName: string) {
	if (options.signal?.aborted) {
		throw new ElsiumError({
			code: 'VALIDATION_ERROR',
			message: `State machine for "${agentName}" was aborted`,
			retryable: false,
		})
	}
}

function buildCompletionRequest(
	conversationMessages: Message[],
	baseConfig: AgentConfig,
	stateTools: Tool[],
	stateSystem: string | undefined,
): CompletionRequest {
	return {
		messages: conversationMessages,
		model: baseConfig.model,
		system: stateSystem,
		tools: stateTools.length > 0 ? stateTools.map((t) => t.toDefinition()) : undefined,
	}
}

function buildAgentResult(
	response: LLMResponse,
	totalInputTokens: number,
	totalOutputTokens: number,
	totalCost: number,
	iterations: number,
	toolCallHistory: AgentResult['toolCalls'],
	traceId: string,
): AgentResult {
	return {
		message: response.message,
		usage: {
			totalInputTokens,
			totalOutputTokens,
			totalTokens: totalInputTokens + totalOutputTokens,
			totalCost,
			iterations,
		},
		toolCalls: [...toolCallHistory],
		traceId,
	}
}

function applyOutputGuardrails(
	response: LLMResponse,
	outputValidator: (text: string) => boolean | string,
	agentSecurity: ReturnType<typeof createAgentSecurity> | null,
): LLMResponse {
	const outputText = extractText(response.message.content)
	const validation = outputValidator(outputText)
	if (validation !== true) {
		const errorMsg = typeof validation === 'string' ? validation : 'Output validation failed'
		throw ElsiumError.validation(errorMsg)
	}
	if (!agentSecurity) return response
	const secResult = agentSecurity.sanitizeOutput(outputText)
	if (!secResult.safe && secResult.redactedOutput) {
		return {
			...response,
			message: { ...response.message, content: secResult.redactedOutput },
		}
	}
	return response
}

function checkTokenBudget(totalTokens: number, maxBudget: number): void {
	if (totalTokens > maxBudget) {
		throw ElsiumError.budgetExceeded(totalTokens, maxBudget)
	}
}

async function runStateMachine(
	baseConfig: AgentConfig,
	stateConfig: { states: Record<string, StateDefinition>; initialState: string },
	deps: AgentDependencies,
	input: string,
	options: AgentRunOptions,
): Promise<StateMachineResult> {
	const traceId = options.traceId ?? generateTraceId()
	const guardrails = baseConfig.guardrails
	const maxIterations = guardrails?.maxIterations ?? 10
	let totalInputTokens = 0
	let totalOutputTokens = 0
	let totalCost = 0
	let iterations = 0
	const toolCallHistory: AgentResult['toolCalls'] = []
	const stateHistory: StateHistoryEntry[] = []

	let currentStateName = stateConfig.initialState
	let currentState = stateConfig.states[currentStateName]

	if (!currentState) {
		throw new ElsiumError({
			code: 'VALIDATION_ERROR',
			message: `Initial state "${currentStateName}" not found in state definitions`,
			retryable: false,
		})
	}

	const agentSecurity = baseConfig.guardrails?.security
		? createAgentSecurity(baseConfig.guardrails.security)
		: null
	const approvalGate: ApprovalGate | null = baseConfig.guardrails?.approval
		? createApprovalGate(baseConfig.guardrails.approval)
		: null
	const maxTokenBudget = guardrails?.maxTokenBudget ?? 500_000
	const outputValidator = guardrails?.outputValidator ?? (() => true)

	const conversationMessages: Message[] = [{ role: 'user', content: input }]

	while (iterations < maxIterations) {
		iterations++

		checkAbortSignal(options, baseConfig.name)

		// Merge state overrides onto base config
		const stateTools = currentState.tools ?? baseConfig.tools ?? []
		const stateSystem = currentState.system ?? baseConfig.system
		const toolMap = new Map(stateTools.map((t) => [t.name, t]))

		const request = buildCompletionRequest(
			conversationMessages,
			baseConfig,
			stateTools,
			stateSystem,
		)
		let response = await deps.complete(request)

		totalInputTokens += response.usage.inputTokens
		totalOutputTokens += response.usage.outputTokens
		totalCost += response.cost.totalCost

		// Token budget check
		checkTokenBudget(totalInputTokens + totalOutputTokens, maxTokenBudget)

		// Apply output validation and security sanitization
		response = applyOutputGuardrails(response, outputValidator, agentSecurity)

		conversationMessages.push(response.message)

		await safeHook(() => baseConfig.hooks?.onMessage?.(response.message))

		// Handle tool calls within current state
		const toolCallAction = handleToolCallsAndContinue(
			response,
			toolMap,
			toolCallHistory,
			conversationMessages,
			options.signal,
			baseConfig.hooks,
			approvalGate,
			baseConfig.guardrails,
		)
		if (toolCallAction) {
			await toolCallAction
			continue
		}

		// Non-tool response: build result and evaluate transition
		const result = buildAgentResult(
			response,
			totalInputTokens,
			totalOutputTokens,
			totalCost,
			iterations,
			toolCallHistory,
			traceId,
		)

		// Check for terminal state
		if (currentState.terminal) {
			stateHistory.push({ state: currentStateName, result, transitionedTo: null })
			return { ...result, stateHistory, finalState: currentStateName }
		}

		// Evaluate transition
		const transition = evaluateTransition(
			currentState,
			currentStateName,
			result,
			stateConfig,
			stateHistory,
			conversationMessages,
		)
		currentStateName = transition.nextStateName
		currentState = transition.nextState
	}

	throw new ElsiumError({
		code: 'MAX_ITERATIONS',
		message: `State machine reached maximum iterations (${maxIterations})`,
		retryable: false,
		metadata: { iterations, maxIterations, lastState: currentStateName },
	})
}

async function executeToolCalls(
	toolCalls: ToolCall[],
	toolMap: Map<string, Tool>,
	history: AgentResult['toolCalls'],
	signal?: AbortSignal,
	hooks?: AgentHooks,
	approvalGate?: ApprovalGate | null,
	approvalConfig?: AgentConfig['guardrails'],
) {
	const results = []

	for (const tc of toolCalls) {
		await safeHook(() => hooks?.onToolCall?.({ name: tc.name, arguments: tc.arguments }))

		if (
			approvalGate &&
			shouldRequireApproval(approvalConfig?.approval?.requireApprovalFor, {
				toolName: tc.name,
			})
		) {
			const decision = await approvalGate.requestApproval('tool_call', `Execute tool: ${tc.name}`, {
				toolName: tc.name,
				arguments: tc.arguments,
			})
			if (!decision.approved) {
				const deniedResult: ToolExecutionResult = {
					success: false,
					error: `Tool call denied: ${decision.reason ?? 'Approval denied'}`,
					toolCallId: tc.id,
					durationMs: 0,
				}
				await safeHook(() => hooks?.onToolResult?.(deniedResult))
				history.push({ name: tc.name, arguments: tc.arguments, result: deniedResult })
				results.push(formatToolResult(deniedResult))
				continue
			}
		}

		const tool = toolMap.get(tc.name)
		if (!tool) {
			const errorResult: ToolExecutionResult = {
				success: false,
				error: `Unknown tool: ${tc.name}. Available: ${Array.from(toolMap.keys()).join(', ')}`,
				toolCallId: tc.id,
				durationMs: 0,
			}
			await safeHook(() => hooks?.onToolResult?.(errorResult))
			history.push({ name: tc.name, arguments: tc.arguments, result: errorResult })
			results.push(formatToolResult(errorResult))
			continue
		}

		const result = await tool.execute(tc.arguments, { toolCallId: tc.id, signal })
		await safeHook(() => hooks?.onToolResult?.(result))
		history.push({ name: tc.name, arguments: tc.arguments, result })
		results.push(formatToolResult(result))
	}

	return results
}
