import type { CompletionRequest, LLMResponse, Message, ToolCall } from '@elsium-ai/core'
import { ElsiumError, type ElsiumStream, extractText, generateTraceId } from '@elsium-ai/core'
import { gateway } from '@elsium-ai/gateway'
import type { ToolExecutionResult } from '@elsium-ai/tools'
import { formatToolResult } from '@elsium-ai/tools'
import { type ApprovalGate, createApprovalGate, shouldRequireApproval } from './approval'
import { createConfidenceScorer } from './confidence'
import { type Memory, createMemory } from './memory'
import { createAgentSecurity } from './security'
import type { SemanticValidationResult } from './semantic-guardrails'
import { createSemanticValidator } from './semantic-guardrails'
import { executeStateMachine } from './state-machine'
import type { AgentStream, StreamingAgentDependencies } from './streaming'
import { createAgentStream } from './streaming'
import type { AgentConfig, AgentResult, AgentRunOptions, GuardrailConfig } from './types'

export interface Agent {
	readonly name: string
	readonly config: AgentConfig
	run(input: string, options?: AgentRunOptions): Promise<AgentResult>
	stream(input: string, options?: AgentRunOptions): AgentStream
	chat(messages: Message[], options?: AgentRunOptions): Promise<AgentResult>
	resetMemory(): void
}

export interface AgentDependencies {
	complete: (request: CompletionRequest) => Promise<LLMResponse>
	stream?: (request: CompletionRequest) => ElsiumStream
}

type OutputProcessResult =
	| { action: 'return'; result: AgentResult }
	| { action: 'retry'; feedbackMessage: string }

/** Safely invoke a lifecycle hook — failures are swallowed so hooks never crash the agent loop. */
async function safeHook<T>(fn: (() => T | Promise<T>) | undefined): Promise<void> {
	if (!fn) return
	try {
		await fn()
	} catch (_) {
		/* hook errors are intentionally swallowed to protect the agent loop */
	}
}

function resolveDependencies(config: AgentConfig, deps?: AgentDependencies): AgentDependencies {
	if (deps) return deps
	if (typeof config.provider === 'object' && config.provider !== null) {
		const provider = config.provider
		return {
			complete: (req) => provider.complete(req),
			stream: (req) => provider.stream(req),
		}
	}
	if (!config.provider || !config.apiKey) {
		throw ElsiumError.validation(
			'Either provide AgentDependencies as second argument, set provider and apiKey in config, or pass an LLMProvider object as provider',
		)
	}
	const gw = gateway({
		provider: config.provider,
		apiKey: config.apiKey,
		baseUrl: config.baseUrl,
		model: config.model,
	})
	return {
		complete: (req) => gw.complete(req),
		stream: (req) => gw.stream(req),
	}
}

export function defineAgent(config: AgentConfig, deps?: AgentDependencies): Agent {
	const resolvedDeps = resolveDependencies(config, deps)
	const memory: Memory = createMemory(
		config.memory ?? { strategy: 'sliding-window', maxMessages: 50 },
	)

	const toolMap = new Map((config.tools ?? []).map((t) => [t.name, t]))

	const guardrails: Required<Omit<GuardrailConfig, 'semantic' | 'security' | 'approval'>> & {
		semantic?: GuardrailConfig['semantic']
		security?: GuardrailConfig['security']
		approval?: GuardrailConfig['approval']
	} = {
		maxIterations: config.guardrails?.maxIterations ?? 10,
		maxTokenBudget: config.guardrails?.maxTokenBudget ?? 500_000,
		inputValidator: config.guardrails?.inputValidator ?? (() => true),
		outputValidator: config.guardrails?.outputValidator ?? (() => true),
		semantic: config.guardrails?.semantic,
		security: config.guardrails?.security,
	}

	const semanticValidator = guardrails.semantic
		? createSemanticValidator(guardrails.semantic, resolvedDeps.complete)
		: null

	const agentSecurity = guardrails.security ? createAgentSecurity(guardrails.security) : null
	const approvalGate: ApprovalGate | null = config.guardrails?.approval
		? createApprovalGate(config.guardrails.approval)
		: null

	const confidenceScorer = config.confidence
		? createConfidenceScorer(typeof config.confidence === 'boolean' ? {} : config.confidence)
		: null

	function formatFailedChecks(checks: SemanticValidationResult['checks']): string {
		return checks
			.filter((c) => !c.passed)
			.map((c) => `${c.name}: ${c.reason}`)
			.join('; ')
	}

	function validateInputText(text: string): void {
		const validation = guardrails.inputValidator(text)
		if (validation !== true) {
			const errorMsg = typeof validation === 'string' ? validation : 'Input validation failed'
			throw ElsiumError.validation(errorMsg)
		}
		if (agentSecurity) {
			const securityResult = agentSecurity.validateInput(text)
			if (!securityResult.safe) {
				throw ElsiumError.validation(
					`Security violation: ${securityResult.violations.map((v) => v.detail).join('; ')}`,
				)
			}
		}
	}

	function commitToMemory(
		conversationMessages: Message[],
		scopedLength: number,
		mem: Memory,
	): void {
		for (const msg of conversationMessages.slice(scopedLength)) {
			mem.add(msg)
		}
	}

	function validateOutput(outputText: string): void {
		const validation = guardrails.outputValidator(outputText)
		if (validation !== true) {
			const errorMsg = typeof validation === 'string' ? validation : 'Output validation failed'
			throw ElsiumError.validation(errorMsg)
		}
	}

	function sanitizeOutputText(
		outputText: string,
		message: Message,
	): { outputText: string; message: Message } {
		if (!agentSecurity) {
			return { outputText, message }
		}
		const securityResult = agentSecurity.sanitizeOutput(outputText)
		if (!securityResult.safe && securityResult.redactedOutput) {
			return {
				outputText: securityResult.redactedOutput,
				message: { ...message, content: securityResult.redactedOutput },
			}
		}
		return { outputText, message }
	}

	async function runSemanticValidation(
		inputMessages: Message[],
		outputText: string,
		iterations: number,
	): Promise<
		| { action: 'retry'; feedbackMessage: string }
		| { action: 'continue'; result: SemanticValidationResult | null }
	> {
		if (!semanticValidator) {
			return { action: 'continue', result: null }
		}

		const inputText = inputMessages.map((m) => extractText(m.content)).join('\n')
		const semanticResult = await semanticValidator.validate(inputText, outputText)

		if (semanticResult.valid) {
			return { action: 'continue', result: semanticResult }
		}

		const autoRetry = guardrails.semantic?.autoRetry
		if (autoRetry?.enabled && iterations < (autoRetry.maxRetries ?? 2) + 1) {
			return {
				action: 'retry',
				feedbackMessage: `Your previous response failed semantic validation: ${formatFailedChecks(semanticResult.checks)}. Please correct your response.`,
			}
		}

		throw ElsiumError.validation(
			`Semantic validation failed: ${formatFailedChecks(semanticResult.checks)}`,
		)
	}

	async function scoreConfidence(
		inputMessages: Message[],
		outputText: string,
		semanticResult: SemanticValidationResult | null,
	) {
		if (!confidenceScorer) {
			return undefined
		}
		const inputText = inputMessages.map((m) => extractText(m.content)).join('\n')
		return confidenceScorer.score(inputText, outputText, semanticResult ?? undefined)
	}

	async function processOutput(
		responseMessage: Message,
		inputMessages: Message[],
		iterations: number,
		usage: AgentResult['usage'],
		toolCallHistory: AgentResult['toolCalls'],
		traceId: string,
	): Promise<OutputProcessResult> {
		const rawText = extractText(responseMessage.content)

		validateOutput(rawText)

		const sanitized = sanitizeOutputText(rawText, responseMessage)

		const semanticOutcome = await runSemanticValidation(
			inputMessages,
			sanitized.outputText,
			iterations,
		)
		if (semanticOutcome.action === 'retry') {
			return semanticOutcome
		}

		const confidence = await scoreConfidence(
			inputMessages,
			sanitized.outputText,
			semanticOutcome.result,
		)

		const agentResult: AgentResult = {
			message: sanitized.message,
			usage,
			toolCalls: toolCallHistory,
			traceId,
			confidence,
		}

		await safeHook(() => config.hooks?.onComplete?.(agentResult))

		return { action: 'return', result: agentResult }
	}

	function checkBudget(totalInputTokens: number, totalOutputTokens: number): void {
		if (totalInputTokens + totalOutputTokens > guardrails.maxTokenBudget) {
			throw ElsiumError.budgetExceeded(
				totalInputTokens + totalOutputTokens,
				guardrails.maxTokenBudget,
			)
		}
	}

	function checkAborted(options: AgentRunOptions): void {
		if (options.signal?.aborted) {
			throw new ElsiumError({
				code: 'VALIDATION_ERROR',
				message: `Agent "${config.name}" was aborted`,
				retryable: false,
			})
		}
	}

	function buildCompletionRequest(conversationMessages: Message[]): CompletionRequest {
		return {
			messages: conversationMessages,
			model: config.model,
			system: config.system,
			tools: config.tools?.map((t) => t.toDefinition()),
		}
	}

	async function handleNonToolResponse(
		response: LLMResponse,
		inputMessages: Message[],
		iterations: number,
		totalInputTokens: number,
		totalOutputTokens: number,
		totalCost: number,
		toolCallHistory: AgentResult['toolCalls'],
		traceId: string,
		conversationMessages: Message[],
	): Promise<AgentResult | null> {
		const usage = {
			totalInputTokens,
			totalOutputTokens,
			totalTokens: totalInputTokens + totalOutputTokens,
			totalCost,
			iterations,
		}

		const processed = await processOutput(
			response.message,
			inputMessages,
			iterations,
			usage,
			toolCallHistory,
			traceId,
		)

		if (processed.action === 'retry') {
			conversationMessages.push({ role: 'user', content: processed.feedbackMessage })
			return null
		}

		return processed.result
	}

	async function executeLoop(messages: Message[], options: AgentRunOptions): Promise<AgentResult> {
		const traceId = options.traceId ?? generateTraceId()
		let totalInputTokens = 0
		let totalOutputTokens = 0
		let totalCost = 0
		let iterations = 0
		const toolCallHistory: AgentResult['toolCalls'] = []

		// Scoped copy of memory for concurrency safety
		const scopedMessages = [...memory.getMessages()]
		const conversationMessages = [...scopedMessages, ...messages]

		while (iterations < guardrails.maxIterations) {
			iterations++

			checkAborted(options)
			checkBudget(totalInputTokens, totalOutputTokens)

			const request = buildCompletionRequest(conversationMessages)
			const response = await resolvedDeps.complete(request)

			totalInputTokens += response.usage.inputTokens
			totalOutputTokens += response.usage.outputTokens
			totalCost += response.cost.totalCost

			await safeHook(() => config.hooks?.onMessage?.(response.message))

			conversationMessages.push(response.message)

			if (!response.message.toolCalls?.length || response.stopReason !== 'tool_use') {
				const result = await handleNonToolResponse(
					response,
					messages,
					iterations,
					totalInputTokens,
					totalOutputTokens,
					totalCost,
					toolCallHistory,
					traceId,
					conversationMessages,
				)

				if (result) {
					commitToMemory(conversationMessages, scopedMessages.length, memory)
					return result
				}
				continue
			}

			const toolResults = await executeToolCalls(
				response.message.toolCalls,
				toolCallHistory,
				options,
			)

			const toolMessage: Message = {
				role: 'tool',
				content: '',
				toolResults,
			}

			conversationMessages.push(toolMessage)
		}

		throw new ElsiumError({
			code: 'MAX_ITERATIONS',
			message: `Agent "${config.name}" reached maximum iterations (${guardrails.maxIterations})`,
			retryable: false,
			metadata: { iterations, maxIterations: guardrails.maxIterations },
		})
	}

	async function executeToolCalls(
		toolCalls: ToolCall[],
		history: AgentResult['toolCalls'],
		options: AgentRunOptions = {},
	) {
		const results = []

		for (const tc of toolCalls) {
			await safeHook(() => config.hooks?.onToolCall?.({ name: tc.name, arguments: tc.arguments }))

			// Check approval gate before executing tool
			if (
				approvalGate &&
				shouldRequireApproval(config.guardrails?.approval?.requireApprovalFor, {
					toolName: tc.name,
				})
			) {
				const decision = await approvalGate.requestApproval(
					'tool_call',
					`Execute tool: ${tc.name}`,
					{ toolName: tc.name, arguments: tc.arguments },
				)
				if (!decision.approved) {
					const deniedResult: ToolExecutionResult = {
						success: false,
						error: `Tool call denied: ${decision.reason ?? 'Approval denied'}`,
						toolCallId: tc.id,
						durationMs: 0,
					}
					await safeHook(() => config.hooks?.onToolResult?.(deniedResult))
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
				await safeHook(() => config.hooks?.onToolResult?.(errorResult))
				history.push({ name: tc.name, arguments: tc.arguments, result: errorResult })
				results.push(formatToolResult(errorResult))
				continue
			}

			const result = await tool.execute(tc.arguments, {
				toolCallId: tc.id,
				signal: options.signal,
			})
			await safeHook(() => config.hooks?.onToolResult?.(result))
			history.push({ name: tc.name, arguments: tc.arguments, result })
			results.push(formatToolResult(result))
		}

		return results
	}

	return {
		name: config.name,
		config,

		async run(input: string, options: AgentRunOptions = {}): Promise<AgentResult> {
			validateInputText(input)

			if (config.states && config.initialState) {
				return executeStateMachine(
					config,
					{ states: config.states, initialState: config.initialState },
					resolvedDeps,
					input,
					options,
				)
			}

			const userMessage: Message = { role: 'user', content: input }
			return executeLoop([userMessage], options)
		},

		stream(input: string, options: AgentRunOptions = {}): AgentStream {
			validateInputText(input)

			const streamDeps = resolvedDeps as StreamingAgentDependencies
			if (!streamDeps.stream) {
				throw ElsiumError.validation(
					'Streaming requires a stream function in agent dependencies. ' +
						'Pass { complete, stream } or use a provider that supports streaming.',
				)
			}

			const userMessage: Message = { role: 'user', content: input }
			return createAgentStream([userMessage], {
				config,
				deps: streamDeps,
				memory,
				toolMap,
				options,
				maxIterations: guardrails.maxIterations,
				maxTokenBudget: guardrails.maxTokenBudget,
			})
		},

		async chat(messages: Message[], options: AgentRunOptions = {}): Promise<AgentResult> {
			// Validate user-role messages
			for (const msg of messages) {
				if (msg.role !== 'user') continue
				validateInputText(extractText(msg.content))
			}

			// State machine mode
			if (config.states && config.initialState) {
				const inputText = messages
					.filter((m) => m.role === 'user')
					.map((m) => extractText(m.content))
					.join('\n')
				return executeStateMachine(
					config,
					{ states: config.states, initialState: config.initialState },
					resolvedDeps,
					inputText || '',
					options,
				)
			}

			return executeLoop(messages, options)
		},

		resetMemory() {
			memory.clear()
		},
	}
}
