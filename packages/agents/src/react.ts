import type { CompletionRequest, LLMResponse, Message } from '@elsium-ai/core'
import { ElsiumError, extractText, generateTraceId } from '@elsium-ai/core'
import { gateway } from '@elsium-ai/gateway'
import type { LLMProvider, ProviderMesh } from '@elsium-ai/gateway'
import type { Tool, ToolExecutionResult } from '@elsium-ai/tools'
import type { AgentHooks, AgentResult, AgentRunOptions } from './types'

export interface ReActConfig {
	name: string
	model?: string
	tools: Tool[]
	system?: string
	maxIterations?: number
	maxTokenBudget?: number
	hooks?: AgentHooks & {
		onThought?: (thought: string, iteration: number) => void | Promise<void>
		onAction?: (
			toolName: string,
			args: Record<string, unknown>,
			iteration: number,
		) => void | Promise<void>
		onObservation?: (result: ToolExecutionResult, iteration: number) => void | Promise<void>
	}
	provider?: string | LLMProvider | ProviderMesh
	apiKey?: string
	baseUrl?: string
}

export interface ReActResult extends AgentResult {
	reasoning: ReActStep[]
}

export interface ReActStep {
	iteration: number
	thought: string
	action?: { tool: string; input: Record<string, unknown> }
	observation?: string
}

export interface ReActAgent {
	readonly name: string
	run(input: string, options?: AgentRunOptions): Promise<ReActResult>
}

const REACT_SYSTEM_PROMPT = `You are a reasoning agent that solves problems step-by-step using available tools.

For each step, you MUST follow this exact format:

Thought: [Your reasoning about what to do next]
Action: [tool_name]
Action Input: [JSON arguments for the tool]

After receiving an observation, continue with another Thought/Action cycle.

When you have enough information to answer, use this format:

Thought: [Your final reasoning]
Final Answer: [Your complete answer to the user's question]

Important rules:
- Always start with a Thought
- Only use tools that are available to you
- Action Input must be valid JSON
- When you have the answer, use "Final Answer:" to provide it`

function buildSystemPrompt(userSystem: string | undefined, tools: Tool[]): string {
	const base = userSystem ? `${userSystem}\n\n${REACT_SYSTEM_PROMPT}` : REACT_SYSTEM_PROMPT

	const toolDescriptions = tools
		.map((t) => {
			const def = t.toDefinition()
			return `- ${def.name}: ${def.description}\n  Input schema: ${JSON.stringify(def.inputSchema)}`
		})
		.join('\n')

	return `${base}\n\nAvailable tools:\n${toolDescriptions}`
}

function parseThought(text: string): string {
	const match = text.match(/Thought:\s*([\s\S]*?)(?=\n(?:Action:|Final Answer:)|$)/)
	return match?.[1]?.trim() ?? ''
}

function parseFinalAnswer(text: string): string | null {
	const match = text.match(/Final Answer:\s*([\s\S]*)$/)
	return match?.[1]?.trim() ?? null
}

function parseAction(text: string): { tool: string; input: Record<string, unknown> } | null {
	const actionMatch = text.match(/Action:\s*(\S+)/)
	const inputMatch = text.match(
		/Action Input:\s*([\s\S]*?)(?=\n(?:Thought:|Action:|Final Answer:)|$)/,
	)

	if (!actionMatch) return null

	const tool = actionMatch[1].trim()
	let input: Record<string, unknown> = {}

	if (inputMatch) {
		try {
			input = JSON.parse(inputMatch[1].trim())
		} catch {
			input = { query: inputMatch[1].trim() }
		}
	}

	return { tool, input }
}

function resolveDeps(config: ReActConfig): {
	complete: (req: CompletionRequest) => Promise<LLMResponse>
} {
	if (typeof config.provider === 'object' && config.provider !== null) {
		const provider = config.provider as LLMProvider
		if ('complete' in provider) {
			return { complete: (req) => provider.complete(req) }
		}
	}
	if (!config.provider || !config.apiKey) {
		throw ElsiumError.validation(
			'ReAct agent requires provider/apiKey config or an LLMProvider object',
		)
	}
	const gw = gateway({
		provider: config.provider as string,
		apiKey: config.apiKey,
		baseUrl: config.baseUrl,
		model: config.model,
	})
	return { complete: (req) => gw.complete(req) }
}

async function safeHook<T>(fn: (() => T | Promise<T>) | undefined): Promise<void> {
	if (!fn) return
	try {
		await fn()
	} catch {
		/* hook errors swallowed */
	}
}

function buildToolResultMessage(toolCallId: string, content: string): Message {
	return {
		role: 'tool',
		content: '',
		toolResults: [{ toolCallId, content }],
	}
}

function formatObservation(result: ToolExecutionResult): string {
	if (result.success) {
		return typeof result.data === 'string' ? result.data : JSON.stringify(result.data)
	}
	return `Error: ${result.error}`
}

function buildResult(
	message: Message,
	usage: AgentResult['usage'],
	toolCallHistory: AgentResult['toolCalls'],
	traceId: string,
	reasoning: ReActStep[],
): ReActResult {
	return { message, usage, toolCalls: toolCallHistory, traceId, reasoning }
}

export function defineReActAgent(config: ReActConfig): ReActAgent {
	const deps = resolveDeps(config)
	const toolMap = new Map(config.tools.map((t) => [t.name, t]))
	const maxIterations = config.maxIterations ?? 10
	const maxTokenBudget = config.maxTokenBudget ?? 500_000
	const fullSystem = buildSystemPrompt(config.system, config.tools)

	async function handleNativeToolCalls(
		response: LLMResponse,
		text: string,
		iteration: number,
		messages: Message[],
		toolCallHistory: AgentResult['toolCalls'],
		reasoning: ReActStep[],
		options: AgentRunOptions,
	): Promise<void> {
		const toolCalls = response.message.toolCalls ?? []
		const thought = parseThought(text) || `Using tool: ${toolCalls[0]?.name}`
		const step: ReActStep = { iteration, thought }
		await safeHook(() => config.hooks?.onThought?.(thought, iteration))

		for (const tc of toolCalls) {
			step.action = { tool: tc.name, input: tc.arguments }
			await safeHook(() => config.hooks?.onAction?.(tc.name, tc.arguments, iteration))

			const tool = toolMap.get(tc.name)
			if (!tool) {
				const errorResult: ToolExecutionResult = {
					success: false,
					error: `Unknown tool: ${tc.name}`,
					toolCallId: tc.id,
					durationMs: 0,
				}
				toolCallHistory.push({ name: tc.name, arguments: tc.arguments, result: errorResult })
				step.observation = `Error: Unknown tool "${tc.name}"`
				messages.push(buildToolResultMessage(tc.id, step.observation))
				continue
			}

			const result = await tool.execute(tc.arguments, {
				toolCallId: tc.id,
				signal: options.signal,
			})
			await safeHook(() => config.hooks?.onObservation?.(result, iteration))
			toolCallHistory.push({ name: tc.name, arguments: tc.arguments, result })

			const obsText = formatObservation(result)
			step.observation = obsText
			messages.push(buildToolResultMessage(tc.id, obsText))
		}

		reasoning.push(step)
	}

	async function handleTextAction(
		action: { tool: string; input: Record<string, unknown> },
		step: ReActStep,
		iteration: number,
		messages: Message[],
		toolCallHistory: AgentResult['toolCalls'],
		options: AgentRunOptions,
	): Promise<void> {
		step.action = action
		await safeHook(() => config.hooks?.onAction?.(action.tool, action.input, iteration))

		const tool = toolMap.get(action.tool)
		if (!tool) {
			step.observation = `Error: Unknown tool "${action.tool}"`
			messages.push({ role: 'user', content: `Observation: ${step.observation}` })
			return
		}

		const result = await tool.execute(action.input, { signal: options.signal })
		await safeHook(() => config.hooks?.onObservation?.(result, iteration))
		toolCallHistory.push({ name: action.tool, arguments: action.input, result })

		const obsText = formatObservation(result)
		step.observation = obsText
		messages.push({ role: 'user', content: `Observation: ${obsText}` })
	}

	interface LoopState {
		messages: Message[]
		reasoning: ReActStep[]
		toolCallHistory: AgentResult['toolCalls']
		totalInputTokens: number
		totalOutputTokens: number
		totalCost: number
	}

	function checkPreconditions(state: LoopState, options: AgentRunOptions): void {
		if (options.signal?.aborted) {
			throw new ElsiumError({
				code: 'VALIDATION_ERROR',
				message: `ReAct agent "${config.name}" was aborted`,
				retryable: false,
			})
		}
		if (state.totalInputTokens + state.totalOutputTokens > maxTokenBudget) {
			throw ElsiumError.budgetExceeded(
				state.totalInputTokens + state.totalOutputTokens,
				maxTokenBudget,
			)
		}
	}

	function makeUsage(state: LoopState, iteration: number): AgentResult['usage'] {
		return {
			totalInputTokens: state.totalInputTokens,
			totalOutputTokens: state.totalOutputTokens,
			totalTokens: state.totalInputTokens + state.totalOutputTokens,
			totalCost: state.totalCost,
			iterations: iteration,
		}
	}

	async function handleTextResponse(
		text: string,
		response: LLMResponse,
		iteration: number,
		state: LoopState,
		traceId: string,
		options: AgentRunOptions,
	): Promise<ReActResult | 'continue'> {
		const thought = parseThought(text)
		const finalAnswer = parseFinalAnswer(text)

		if (finalAnswer) {
			const step: ReActStep = { iteration, thought: thought || 'Providing final answer' }
			state.reasoning.push(step)
			await safeHook(() => config.hooks?.onThought?.(step.thought, iteration))
			return buildResult(
				{ role: 'assistant', content: finalAnswer },
				makeUsage(state, iteration),
				state.toolCallHistory,
				traceId,
				state.reasoning,
			)
		}

		const action = parseAction(text)
		const step: ReActStep = { iteration, thought: thought || text }
		await safeHook(() => config.hooks?.onThought?.(step.thought, iteration))

		if (action) {
			await handleTextAction(
				action,
				step,
				iteration,
				state.messages,
				state.toolCallHistory,
				options,
			)
			state.reasoning.push(step)
			return 'continue'
		}

		state.reasoning.push(step)
		return buildResult(
			response.message,
			makeUsage(state, iteration),
			state.toolCallHistory,
			traceId,
			state.reasoning,
		)
	}

	return {
		name: config.name,

		async run(input: string, options: AgentRunOptions = {}): Promise<ReActResult> {
			const traceId = options.traceId ?? generateTraceId()
			const state: LoopState = {
				messages: [{ role: 'user', content: input }],
				reasoning: [],
				toolCallHistory: [],
				totalInputTokens: 0,
				totalOutputTokens: 0,
				totalCost: 0,
			}

			for (let iteration = 1; iteration <= maxIterations; iteration++) {
				checkPreconditions(state, options)

				const response = await deps.complete({
					messages: state.messages,
					model: config.model,
					system: fullSystem,
					tools: config.tools.map((t) => t.toDefinition()),
				})

				state.totalInputTokens += response.usage.inputTokens
				state.totalOutputTokens += response.usage.outputTokens
				state.totalCost += response.cost.totalCost

				const text = extractText(response.message.content)
				state.messages.push(response.message)

				if (response.message.toolCalls?.length && response.stopReason === 'tool_use') {
					await handleNativeToolCalls(
						response,
						text,
						iteration,
						state.messages,
						state.toolCallHistory,
						state.reasoning,
						options,
					)
					continue
				}

				const outcome = await handleTextResponse(text, response, iteration, state, traceId, options)
				if (outcome !== 'continue') return outcome
			}

			throw new ElsiumError({
				code: 'MAX_ITERATIONS',
				message: `ReAct agent "${config.name}" reached maximum iterations (${maxIterations})`,
				retryable: false,
				metadata: { iterations: maxIterations },
			})
		},
	}
}
