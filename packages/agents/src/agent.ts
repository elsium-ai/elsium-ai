import type { CompletionRequest, LLMResponse, Message, ToolCall } from '@elsium-ai/core'
import { ElsiumError, extractText, generateTraceId } from '@elsium-ai/core'
import type { Tool, ToolExecutionResult } from '@elsium-ai/tools'
import { formatToolResult } from '@elsium-ai/tools'
import { type Memory, createMemory } from './memory'
import { createSemanticValidator } from './semantic-guardrails'
import type { AgentConfig, AgentResult, AgentRunOptions, GuardrailConfig } from './types'

export interface Agent {
	readonly name: string
	readonly config: AgentConfig
	run(input: string, options?: AgentRunOptions): Promise<AgentResult>
	chat(messages: Message[], options?: AgentRunOptions): Promise<AgentResult>
	resetMemory(): void
}

export interface AgentDependencies {
	complete: (request: CompletionRequest) => Promise<LLMResponse>
}

export function defineAgent(config: AgentConfig, deps: AgentDependencies): Agent {
	const memory: Memory = createMemory(
		config.memory ?? { strategy: 'sliding-window', maxMessages: 50 },
	)

	const toolMap = new Map((config.tools ?? []).map((t) => [t.name, t]))

	const guardrails: Required<Omit<GuardrailConfig, 'semantic'>> & {
		semantic?: GuardrailConfig['semantic']
	} = {
		maxIterations: config.guardrails?.maxIterations ?? 10,
		maxTokenBudget: config.guardrails?.maxTokenBudget ?? 500_000,
		inputValidator: config.guardrails?.inputValidator ?? (() => true),
		outputValidator: config.guardrails?.outputValidator ?? (() => true),
		semantic: config.guardrails?.semantic,
	}

	const semanticValidator = guardrails.semantic
		? createSemanticValidator(guardrails.semantic, deps.complete)
		: null

	async function executeLoop(messages: Message[], options: AgentRunOptions): Promise<AgentResult> {
		const traceId = options.traceId ?? generateTraceId()
		let totalInputTokens = 0
		let totalOutputTokens = 0
		let totalCost = 0
		let iterations = 0
		const toolCallHistory: AgentResult['toolCalls'] = []

		const conversationMessages = [...memory.getMessages(), ...messages]

		for (const msg of messages) {
			memory.add(msg)
		}

		while (iterations < guardrails.maxIterations) {
			iterations++

			if (totalInputTokens + totalOutputTokens > guardrails.maxTokenBudget) {
				throw ElsiumError.budgetExceeded(
					totalInputTokens + totalOutputTokens,
					guardrails.maxTokenBudget,
				)
			}

			const request: CompletionRequest = {
				messages: conversationMessages,
				model: config.model,
				system: config.system,
				tools: config.tools?.map((t) => t.toDefinition()),
			}

			const response = await deps.complete(request)

			totalInputTokens += response.usage.inputTokens
			totalOutputTokens += response.usage.outputTokens
			totalCost += response.cost.totalCost

			await config.hooks?.onMessage?.(response.message)

			conversationMessages.push(response.message)
			memory.add(response.message)

			if (!response.message.toolCalls?.length || response.stopReason !== 'tool_use') {
				const outputText = extractText(response.message.content)

				const validation = guardrails.outputValidator(outputText)
				if (validation !== true) {
					const errorMsg = typeof validation === 'string' ? validation : 'Output validation failed'
					throw ElsiumError.validation(errorMsg)
				}

				// Semantic validation
				if (semanticValidator) {
					const inputText = messages.map((m) => extractText(m.content)).join('\n')
					const semanticResult = await semanticValidator.validate(inputText, outputText)

					if (!semanticResult.valid) {
						const autoRetry = guardrails.semantic?.autoRetry
						if (autoRetry?.enabled && iterations < (autoRetry.maxRetries ?? 2) + 1) {
							const failedChecks = semanticResult.checks
								.filter((c) => !c.passed)
								.map((c) => `${c.name}: ${c.reason}`)
								.join('; ')

							conversationMessages.push({
								role: 'user',
								content: `Your previous response failed semantic validation: ${failedChecks}. Please correct your response.`,
							})
							continue
						}

						const failedChecks = semanticResult.checks
							.filter((c) => !c.passed)
							.map((c) => `${c.name}: ${c.reason}`)
							.join('; ')
						throw ElsiumError.validation(`Semantic validation failed: ${failedChecks}`)
					}
				}

				await config.hooks?.onComplete?.({
					message: response.message,
					usage: {
						totalInputTokens,
						totalOutputTokens,
						totalTokens: totalInputTokens + totalOutputTokens,
						totalCost,
						iterations,
					},
					toolCalls: toolCallHistory,
					traceId,
				})

				return {
					message: response.message,
					usage: {
						totalInputTokens,
						totalOutputTokens,
						totalTokens: totalInputTokens + totalOutputTokens,
						totalCost,
						iterations,
					},
					toolCalls: toolCallHistory,
					traceId,
				}
			}

			const toolResults = await executeToolCalls(response.message.toolCalls, toolCallHistory)

			const toolMessage: Message = {
				role: 'tool',
				content: '',
				toolResults,
			}

			conversationMessages.push(toolMessage)
			memory.add(toolMessage)
		}

		throw new ElsiumError({
			code: 'MAX_ITERATIONS',
			message: `Agent "${config.name}" reached maximum iterations (${guardrails.maxIterations})`,
			retryable: false,
			metadata: { iterations, maxIterations: guardrails.maxIterations },
		})
	}

	async function executeToolCalls(toolCalls: ToolCall[], history: AgentResult['toolCalls']) {
		const results = []

		for (const tc of toolCalls) {
			await config.hooks?.onToolCall?.({ name: tc.name, arguments: tc.arguments })

			const tool = toolMap.get(tc.name)
			if (!tool) {
				const errorResult: ToolExecutionResult = {
					success: false,
					error: `Unknown tool: ${tc.name}. Available: ${Array.from(toolMap.keys()).join(', ')}`,
					toolCallId: tc.id,
					durationMs: 0,
				}
				await config.hooks?.onToolResult?.(errorResult)
				history.push({ name: tc.name, arguments: tc.arguments, result: errorResult })
				results.push(formatToolResult(errorResult))
				continue
			}

			const result = await tool.execute(tc.arguments, { toolCallId: tc.id })
			await config.hooks?.onToolResult?.(result)
			history.push({ name: tc.name, arguments: tc.arguments, result })
			results.push(formatToolResult(result))
		}

		return results
	}

	return {
		name: config.name,
		config,

		async run(input: string, options: AgentRunOptions = {}): Promise<AgentResult> {
			const validation = guardrails.inputValidator(input)
			if (validation !== true) {
				const errorMsg = typeof validation === 'string' ? validation : 'Input validation failed'
				throw ElsiumError.validation(errorMsg)
			}

			const userMessage: Message = { role: 'user', content: input }
			return executeLoop([userMessage], options)
		},

		async chat(messages: Message[], options: AgentRunOptions = {}): Promise<AgentResult> {
			return executeLoop(messages, options)
		},

		resetMemory() {
			memory.clear()
		},
	}
}
