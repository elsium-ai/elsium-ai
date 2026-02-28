import type { CompletionRequest, LLMResponse, Message, ToolCall } from '@elsium-ai/core'
import { ElsiumError, extractText, generateTraceId } from '@elsium-ai/core'
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

async function runStateMachine(
	baseConfig: AgentConfig,
	stateConfig: { states: Record<string, StateDefinition>; initialState: string },
	deps: AgentDependencies,
	input: string,
	options: AgentRunOptions,
): Promise<StateMachineResult> {
	const traceId = options.traceId ?? generateTraceId()
	const maxIterations = baseConfig.guardrails?.maxIterations ?? 10
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

	// Single conversation history across all states
	const conversationMessages: Message[] = [{ role: 'user', content: input }]

	while (iterations < maxIterations) {
		iterations++

		// M7/H7 fix: Check AbortSignal at each iteration
		if (options.signal?.aborted) {
			throw new ElsiumError({
				code: 'VALIDATION_ERROR',
				message: `State machine for "${baseConfig.name}" was aborted`,
				retryable: false,
			})
		}

		// Merge state overrides onto base config
		const stateTools = currentState.tools ?? baseConfig.tools ?? []
		const stateSystem = currentState.system ?? baseConfig.system
		const toolMap = new Map(stateTools.map((t) => [t.name, t]))

		const request: CompletionRequest = {
			messages: conversationMessages,
			model: baseConfig.model,
			system: stateSystem,
			tools: stateTools.length > 0 ? stateTools.map((t) => t.toDefinition()) : undefined,
		}

		const response = await deps.complete(request)

		totalInputTokens += response.usage.inputTokens
		totalOutputTokens += response.usage.outputTokens
		totalCost += response.cost.totalCost

		conversationMessages.push(response.message)

		// Handle tool calls within current state
		if (response.message.toolCalls?.length && response.stopReason === 'tool_use') {
			const toolResults = await executeToolCalls(
				response.message.toolCalls,
				toolMap,
				toolCallHistory,
			)
			const toolMessage: Message = {
				role: 'tool',
				content: '',
				toolResults,
			}
			conversationMessages.push(toolMessage)
			continue
		}

		// Non-tool response: build result and evaluate transition
		const outputText = extractText(response.message.content)

		const result: AgentResult = {
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

		// Check for terminal state
		if (currentState.terminal) {
			stateHistory.push({
				state: currentStateName,
				result,
				transitionedTo: null,
			})

			return {
				...result,
				stateHistory,
				finalState: currentStateName,
			}
		}

		// Evaluate transition
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

		// Transition: add context message and update state
		conversationMessages.push({
			role: 'user',
			content: `[State transition: ${currentStateName} → ${nextStateName}] Continue based on the previous response.`,
		})

		currentStateName = nextStateName
		currentState = nextState
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
