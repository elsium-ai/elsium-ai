import type { CompletionRequest, LLMResponse, Message, ToolCall } from '@elsium-ai/core'
import { ElsiumError, type ElsiumStream, generateTraceId } from '@elsium-ai/core'
import type { Tool, ToolExecutionResult } from '@elsium-ai/tools'
import { formatToolResult } from '@elsium-ai/tools'
import type { AgentDependencies } from './agent'
import type { Memory } from './memory'
import type { AgentConfig, AgentResult, AgentRunOptions } from './types'

export type AgentStreamEvent =
	| { type: 'text_delta'; text: string }
	| { type: 'token'; text: string }
	| { type: 'thinking_start'; thinkingId?: string }
	| { type: 'thinking_delta'; thinkingId?: string; text: string }
	| { type: 'thinking_end'; thinkingId?: string }
	| { type: 'thinking'; text: string }
	| { type: 'tool_call_start'; toolCall: { id: string; name: string } }
	| { type: 'tool_call_delta'; toolCallId: string; arguments: string }
	| { type: 'tool_call_end'; toolCallId: string }
	| { type: 'tool_call'; toolCall: { id: string; name: string; arguments: unknown } }
	| { type: 'tool_result'; toolCallId: string; name: string; result: ToolExecutionResult }
	| { type: 'iteration_start'; iteration: number }
	| { type: 'iteration_end'; iteration: number }
	| { type: 'agent_end'; result: AgentResult; stopReason: LLMResponse['stopReason'] }
	| {
			type: 'final'
			result: AgentResult
			stopReason: LLMResponse['stopReason']
			message: AgentResult['message']
			usage: AgentResult['usage']
			toolCalls: AgentResult['toolCalls']
	  }
	| { type: 'error'; error: Error }

export interface StreamingAgentDependencies extends AgentDependencies {
	stream: (request: CompletionRequest) => ElsiumStream
}

export interface AgentStream extends AsyncIterable<AgentStreamEvent> {
	result(): Promise<AgentResult>
}

interface StreamLoopContext {
	config: AgentConfig
	deps: StreamingAgentDependencies
	memory: Memory
	toolMap: Map<string, Tool>
	options: AgentRunOptions
	maxIterations: number
	maxTokenBudget: number
}

interface StreamAccumulator {
	textContent: string
	toolCalls: ToolCall[]
	toolArgBuffers: Record<string, string>
	thinkingBuffer: string
}

function handleTextDelta(
	acc: StreamAccumulator,
	text: string,
	emit: (event: AgentStreamEvent) => void,
): void {
	acc.textContent += text
	emit({ type: 'text_delta', text })
	emit({ type: 'token', text })
}

function handleThinkingDelta(
	acc: StreamAccumulator,
	text: string,
	thinkingId: string | undefined,
	emit: (event: AgentStreamEvent) => void,
): void {
	acc.thinkingBuffer += text
	emit({ type: 'thinking_delta', thinkingId, text })
}

function handleThinkingEnd(
	acc: StreamAccumulator,
	thinkingId: string | undefined,
	emit: (event: AgentStreamEvent) => void,
): void {
	emit({ type: 'thinking_end', thinkingId })
	if (acc.thinkingBuffer) emit({ type: 'thinking', text: acc.thinkingBuffer })
	acc.thinkingBuffer = ''
}

function handleToolCallStart(
	acc: StreamAccumulator,
	toolCall: { id: string; name: string },
	emit: (event: AgentStreamEvent) => void,
): void {
	acc.toolArgBuffers[toolCall.id] = ''
	acc.toolCalls.push({ id: toolCall.id, name: toolCall.name, arguments: {} })
	emit({ type: 'tool_call_start', toolCall })
}

function handleToolCallDelta(
	acc: StreamAccumulator,
	toolCallId: string,
	args: string,
	emit: (event: AgentStreamEvent) => void,
): void {
	if (acc.toolArgBuffers[toolCallId] !== undefined) {
		acc.toolArgBuffers[toolCallId] += args
	}
	emit({ type: 'tool_call_delta', toolCallId, arguments: args })
}

function handleToolCallEnd(
	acc: StreamAccumulator,
	toolCallId: string,
	emit: (event: AgentStreamEvent) => void,
): void {
	const tc = acc.toolCalls.find((t) => t.id === toolCallId)
	if (tc && acc.toolArgBuffers[toolCallId]) {
		try {
			tc.arguments = JSON.parse(acc.toolArgBuffers[toolCallId])
		} catch {
			tc.arguments = {}
		}
	}
	emit({ type: 'tool_call_end', toolCallId })
	if (tc) {
		emit({
			type: 'tool_call',
			toolCall: { id: tc.id, name: tc.name, arguments: tc.arguments },
		})
	}
}

async function accumulateStreamedResponse(
	stream: ElsiumStream,
	emit: (event: AgentStreamEvent) => void,
): Promise<{
	message: Message
	usage: LLMResponse['usage']
	stopReason: LLMResponse['stopReason']
}> {
	const acc: StreamAccumulator = {
		textContent: '',
		toolCalls: [],
		toolArgBuffers: {},
		thinkingBuffer: '',
	}
	let usage: LLMResponse['usage'] = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
	let stopReason: LLMResponse['stopReason'] = 'end_turn'

	for await (const event of stream) {
		switch (event.type) {
			case 'text_delta':
				handleTextDelta(acc, event.text, emit)
				break
			case 'thinking_start':
				acc.thinkingBuffer = ''
				emit({ type: 'thinking_start', thinkingId: event.thinking?.id })
				break
			case 'thinking_delta':
				handleThinkingDelta(acc, event.text, event.thinkingId, emit)
				break
			case 'thinking_end':
				handleThinkingEnd(acc, event.thinkingId, emit)
				break
			case 'tool_call_start':
				handleToolCallStart(acc, event.toolCall, emit)
				break
			case 'tool_call_delta':
				handleToolCallDelta(acc, event.toolCallId, event.arguments, emit)
				break
			case 'tool_call_end':
				handleToolCallEnd(acc, event.toolCallId, emit)
				break
			case 'message_end':
				usage = event.usage
				stopReason = event.stopReason
				break
		}
	}

	return {
		message: {
			role: 'assistant',
			content: acc.textContent,
			...(acc.toolCalls.length ? { toolCalls: acc.toolCalls } : {}),
		},
		usage,
		stopReason,
	}
}

async function executeStreamToolCalls(
	toolCalls: ToolCall[],
	ctx: StreamLoopContext,
	emit: (event: AgentStreamEvent) => void,
): Promise<{ toolMessage: Message; history: AgentResult['toolCalls'] }> {
	const results = []
	const history: AgentResult['toolCalls'] = []

	for (const tc of toolCalls) {
		const tool = ctx.toolMap.get(tc.name)
		if (!tool) {
			const errorResult: ToolExecutionResult = {
				success: false,
				error: `Unknown tool: ${tc.name}. Available: ${Array.from(ctx.toolMap.keys()).join(', ')}`,
				toolCallId: tc.id,
				durationMs: 0,
			}
			emit({ type: 'tool_result', toolCallId: tc.id, name: tc.name, result: errorResult })
			history.push({ name: tc.name, arguments: tc.arguments, result: errorResult })
			results.push(formatToolResult(errorResult))
			continue
		}

		const result = await tool.execute(tc.arguments, {
			toolCallId: tc.id,
			signal: ctx.options.signal,
		})
		emit({ type: 'tool_result', toolCallId: tc.id, name: tc.name, result })
		history.push({ name: tc.name, arguments: tc.arguments, result })
		results.push(formatToolResult(result))
	}

	return {
		toolMessage: { role: 'tool', content: '', toolResults: results },
		history,
	}
}

export function createAgentStream(messages: Message[], ctx: StreamLoopContext): AgentStream {
	let resolveResult: (result: AgentResult) => void
	let rejectResult: (error: Error) => void
	const resultPromise = new Promise<AgentResult>((resolve, reject) => {
		resolveResult = resolve
		rejectResult = reject
	})

	const events: AgentStreamEvent[] = []
	let resolve: ((value: IteratorResult<AgentStreamEvent>) => void) | null = null
	let done = false

	function emit(event: AgentStreamEvent) {
		if (resolve) {
			const r = resolve
			resolve = null
			r({ value: event, done: false })
		} else {
			events.push(event)
		}
	}

	function finish() {
		done = true
		if (resolve) {
			const r = resolve
			resolve = null
			r({ value: undefined as never, done: true })
		}
	}

	runStreamLoop(messages, ctx, emit)
		.then((agentResult) => {
			resolveResult(agentResult)
			finish()
		})
		.catch((err) => {
			const error = err instanceof Error ? err : new Error(String(err))
			emit({ type: 'error', error })
			rejectResult?.(error)
			finish()
		})

	resultPromise.catch(() => {})

	const iterable: AgentStream = {
		[Symbol.asyncIterator]() {
			return {
				next(): Promise<IteratorResult<AgentStreamEvent>> {
					const next = events.shift()
					if (next) {
						return Promise.resolve({ value: next, done: false })
					}
					if (done) {
						return Promise.resolve({ value: undefined as never, done: true })
					}
					return new Promise((r) => {
						resolve = r
					})
				},
			}
		},
		result() {
			return resultPromise
		},
	}

	return iterable
}

async function runStreamLoop(
	messages: Message[],
	ctx: StreamLoopContext,
	emit: (event: AgentStreamEvent) => void,
): Promise<AgentResult> {
	const { config, deps, memory, options } = ctx
	const traceId = options.traceId ?? generateTraceId()
	let totalInputTokens = 0
	let totalOutputTokens = 0
	const totalCost = 0
	let iterations = 0
	const allToolCalls: AgentResult['toolCalls'] = []

	const scopedMessages = [...memory.getMessages()]
	const conversationMessages = [...scopedMessages, ...messages]

	while (iterations < ctx.maxIterations) {
		iterations++

		if (options.signal?.aborted) {
			throw new ElsiumError({
				code: 'VALIDATION_ERROR',
				message: `Agent "${config.name}" was aborted`,
				retryable: false,
			})
		}

		if (totalInputTokens + totalOutputTokens > ctx.maxTokenBudget) {
			throw ElsiumError.budgetExceeded(totalInputTokens + totalOutputTokens, ctx.maxTokenBudget)
		}

		emit({ type: 'iteration_start', iteration: iterations })

		const request: CompletionRequest = {
			messages: conversationMessages,
			model: config.model,
			system: config.system,
			seed: options.seed ?? config.seed,
			tools: config.tools?.map((t) => t.toDefinition()),
		}

		const llmStream = deps.stream(request)
		const { message, usage, stopReason } = await accumulateStreamedResponse(llmStream, emit)

		totalInputTokens += usage.inputTokens
		totalOutputTokens += usage.outputTokens

		conversationMessages.push(message)

		if (!message.toolCalls?.length || stopReason !== 'tool_use') {
			emit({ type: 'iteration_end', iteration: iterations })

			for (const msg of conversationMessages.slice(scopedMessages.length)) {
				memory.add(msg)
			}

			const agentResult: AgentResult = {
				message,
				usage: {
					totalInputTokens,
					totalOutputTokens,
					totalTokens: totalInputTokens + totalOutputTokens,
					totalCost,
					iterations,
				},
				toolCalls: allToolCalls,
				traceId,
			}

			emit({ type: 'agent_end', result: agentResult, stopReason })
			emit({
				type: 'final',
				result: agentResult,
				stopReason,
				message: agentResult.message,
				usage: agentResult.usage,
				toolCalls: agentResult.toolCalls,
			})
			return agentResult
		}

		const { toolMessage, history } = await executeStreamToolCalls(message.toolCalls, ctx, emit)

		allToolCalls.push(...history)
		conversationMessages.push(toolMessage)

		emit({ type: 'iteration_end', iteration: iterations })
	}

	throw new ElsiumError({
		code: 'MAX_ITERATIONS',
		message: `Agent "${config.name}" reached maximum iterations (${ctx.maxIterations})`,
		retryable: false,
		metadata: { iterations, maxIterations: ctx.maxIterations },
	})
}
