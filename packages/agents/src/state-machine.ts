import type { CompletionRequest, LLMResponse, Message, ToolCall } from '@elsium-ai/core'
import { ElsiumError, generateTraceId } from '@elsium-ai/core'
import type { Tool, ToolExecutionResult } from '@elsium-ai/tools'
import { formatToolResult } from '@elsium-ai/tools'
import type { AgentDependencies } from './agent'
import type { AgentConfig, AgentResult, AgentRunOptions } from './types'
import type { StateDefinition, StateHistoryEntry, StateMachineResult } from './types'

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
): Promise<void> | null {
	const toolCalls = response.message.toolCalls
	if (!toolCalls?.length || response.stopReason !== 'tool_use') {
		return null
	}

	return (async () => {
		const toolResults = await executeToolCalls(toolCalls, toolMap, toolCallHistory)
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

	const conversationMessages: Message[] = [{ role: 'user', content: input }]

	while (iterations < maxIterations) {
		iterations++

		// M7/H7 fix: Check AbortSignal at each iteration
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
		const response = await deps.complete(request)

		totalInputTokens += response.usage.inputTokens
		totalOutputTokens += response.usage.outputTokens
		totalCost += response.cost.totalCost

		conversationMessages.push(response.message)

		// Handle tool calls within current state
		const toolCallAction = handleToolCallsAndContinue(
			response,
			toolMap,
			toolCallHistory,
			conversationMessages,
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
) {
	const results = []

	for (const tc of toolCalls) {
		const tool = toolMap.get(tc.name)
		if (!tool) {
			const errorResult: ToolExecutionResult = {
				success: false,
				error: `Unknown tool: ${tc.name}. Available: ${Array.from(toolMap.keys()).join(', ')}`,
				toolCallId: tc.id,
				durationMs: 0,
			}
			history.push({ name: tc.name, arguments: tc.arguments, result: errorResult })
			results.push(formatToolResult(errorResult))
			continue
		}

		const result = await tool.execute(tc.arguments, { toolCallId: tc.id })
		history.push({ name: tc.name, arguments: tc.arguments, result })
		results.push(formatToolResult(result))
	}

	return results
}
