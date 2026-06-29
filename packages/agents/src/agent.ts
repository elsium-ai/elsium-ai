import type {
	AgentTrace,
	CompletionRequest,
	LLMResponse,
	Message,
	ReplayResult,
	StepOverride,
	ToolCall,
	TraceRecorder,
} from '@elsium-ai/core'
import {
	ElsiumError,
	type ElsiumStream,
	createTraceRecorder,
	extractText,
	generateTraceId,
	replayFrom,
} from '@elsium-ai/core'
import { zodToJsonSchema } from '@elsium-ai/core'
import { gateway, redactSecrets } from '@elsium-ai/gateway'
import type { ToolExecutionResult } from '@elsium-ai/tools'
import { formatToolResult } from '@elsium-ai/tools'
import type { z } from 'zod'
import { type ApprovalGate, createApprovalGate, shouldRequireApproval } from './approval'
import { type AskHumanOptions, askHuman } from './ask-human'
import { createConfidenceScorer } from './confidence'
import { type Memory, createMemory } from './memory'
import { type RuntimePolicyEnforcer, createRuntimePolicyEnforcer } from './runtime-policy'
import { createAgentSecurity } from './security'
import type { SemanticValidationResult } from './semantic-guardrails'
import { createSemanticValidator } from './semantic-guardrails'
import { executeStateMachine } from './state-machine'
import type { AgentStream, StreamingAgentDependencies } from './streaming'
import { createAgentStream } from './streaming'
import type { AgentConfig, AgentResult, AgentRunOptions, GuardrailConfig } from './types'
import { withVerifiers } from './verification/fluent'

export interface AgentGenerateResult<T> {
	data: T
	result: AgentResult
}

export interface Agent {
	readonly name: string
	readonly config: AgentConfig
	run(input: string, options?: AgentRunOptions): Promise<AgentResult>
	generate<T>(
		input: string,
		schema: z.ZodType<T>,
		options?: AgentRunOptions,
	): Promise<AgentGenerateResult<T>>
	stream(input: string, options?: AgentRunOptions): AgentStream
	chat(messages: Message[], options?: AgentRunOptions): Promise<AgentResult>
	resetMemory(): void
	withVerifier(verifier: import('./verification/types').Validator<AgentResult>): Agent
	withRetryPolicy(policy: import('./verification/fluent').AgentRetryPolicy): Agent
	runResumable(
		input: string | Message[],
		options?: AgentRunOptions,
		config?: import('./resumable').ResumableRunConfig,
	): Promise<import('./resumable').AgentRunOutcome>
	resume(
		resumeToken: string,
		options?: import('./resumable').ResumeOptions,
	): Promise<import('./resumable').AgentRunOutcome>
	getTrace(traceId: string): AgentTrace | undefined
	listTraces(): AgentTrace[]
	replayFrom(
		traceId: string,
		options: {
			fromStep: number | string
			overrides?: Record<string, StepOverride | { prompt: string }>
		},
	): Promise<ReplayResult>
	askHuman<TOption extends string = string>(
		options: import('./ask-human').AskHumanOptions<TOption> & { timeout?: string | number },
	): Promise<import('./ask-human').AskHumanDecision<TOption>>
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

type ResolvedGuardrails = Required<
	Omit<GuardrailConfig, 'semantic' | 'security' | 'approval' | 'runtimePolicy'>
> & {
	semantic?: GuardrailConfig['semantic']
	security?: GuardrailConfig['security']
	approval?: GuardrailConfig['approval']
	runtimePolicy?: GuardrailConfig['runtimePolicy']
}

function resolveGuardrails(config: AgentConfig): ResolvedGuardrails {
	return {
		maxIterations: config.guardrails?.maxIterations ?? 10,
		maxTokenBudget: config.guardrails?.maxTokenBudget ?? 500_000,
		maxDurationMs: config.guardrails?.maxDurationMs ?? 0,
		inputValidator: config.guardrails?.inputValidator ?? (() => true),
		outputValidator: config.guardrails?.outputValidator ?? (() => true),
		semantic: config.guardrails?.semantic,
		security: config.guardrails?.security,
		runtimePolicy: config.guardrails?.runtimePolicy,
	}
}

const MAX_TRACES_PER_AGENT = 100

export function defineAgent(config: AgentConfig, deps?: AgentDependencies): Agent {
	const resolvedDeps = resolveDependencies(config, deps)
	const memory: Memory = createMemory(
		config.memory ?? { strategy: 'sliding-window', maxMessages: 50 },
	)

	const toolMap = new Map((config.tools ?? []).map((t) => [t.name, t]))
	const guardrails = resolveGuardrails(config)
	const traces = new Map<string, AgentTrace>()

	function rememberTrace(trace: AgentTrace): void {
		traces.set(trace.id, trace)
		while (traces.size > MAX_TRACES_PER_AGENT) {
			const oldest = traces.keys().next().value
			if (oldest === undefined) break
			traces.delete(oldest)
		}
	}

	const semanticValidator = guardrails.semantic
		? createSemanticValidator(guardrails.semantic, resolvedDeps.complete)
		: null

	const agentSecurity = guardrails.security ? createAgentSecurity(guardrails.security) : null
	const approvalGate: ApprovalGate | null = config.guardrails?.approval
		? createApprovalGate(config.guardrails.approval)
		: null

	const runtimePolicy: RuntimePolicyEnforcer | null = guardrails.runtimePolicy
		? createRuntimePolicyEnforcer(guardrails.runtimePolicy)
		: null

	const maxDurationMs = config.guardrails?.maxDurationMs ?? 0

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

	/** Redact secrets / PII from input text before it reaches the model. */
	function redactInputText(text: string): string {
		if (!agentSecurity) return text
		const result = agentSecurity.sanitizeInput(text)
		return result.redactedOutput ?? text
	}

	/** Optional async (e.g. LLM-backed) injection classifier — throws on detection. */
	async function runInjectionClassifier(text: string): Promise<void> {
		const classifier = guardrails.security?.injectionClassifier
		if (!classifier) return
		if (await classifier(text)) {
			throw ElsiumError.validation('Input rejected: flagged as prompt injection by classifier')
		}
	}

	/**
	 * Input guardrail pipeline: detection (throws) → async classifier (throws) →
	 * redaction (transform). Returns the sanitized text to send to the model.
	 */
	async function prepareInput(text: string): Promise<string> {
		validateInputText(text)
		await runInjectionClassifier(text)
		return redactInputText(text)
	}

	/** Recursively redact secrets from string values inside tool arguments. */
	function redactArgValue(value: unknown): unknown {
		if (typeof value === 'string') return redactSecrets(value).redacted
		if (Array.isArray(value)) return value.map(redactArgValue)
		if (value && typeof value === 'object') {
			const out: Record<string, unknown> = {}
			for (const [k, v] of Object.entries(value)) out[k] = redactArgValue(v)
			return out
		}
		return value
	}

	function redactToolArguments(args: Record<string, unknown>): Record<string, unknown> {
		if (!guardrails.security?.redactToolArgSecrets) return args
		return redactArgValue(args) as Record<string, unknown>
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

	function checkDuration(startTime: number): void {
		if (maxDurationMs > 0 && performance.now() - startTime > maxDurationMs) {
			throw new ElsiumError({
				code: 'TIMEOUT',
				message: `Agent "${config.name}" exceeded maximum duration (${maxDurationMs}ms)`,
				retryable: false,
				metadata: { maxDurationMs },
			})
		}
	}

	async function executeLoop(messages: Message[], options: AgentRunOptions): Promise<AgentResult> {
		const traceId = options.traceId ?? generateTraceId()
		const recorder: TraceRecorder = createTraceRecorder({
			agentId: config.name,
			traceId,
		})
		let totalInputTokens = 0
		let totalOutputTokens = 0
		let totalCost = 0
		let iterations = 0
		const toolCallHistory: AgentResult['toolCalls'] = []
		const loopStartTime = performance.now()

		// Scoped copy of memory for concurrency safety
		const scopedMessages = [...memory.getMessages()]
		const conversationMessages = [...scopedMessages, ...messages]

		while (iterations < guardrails.maxIterations) {
			iterations++

			checkAborted(options)
			checkBudget(totalInputTokens, totalOutputTokens)
			checkDuration(loopStartTime)

			const request = buildCompletionRequest(conversationMessages)
			const llmStart = performance.now()
			const response = await resolvedDeps.complete(request)
			recorder.recordStep({
				key: `llm:iter_${iterations}`,
				input: request,
				output: response,
				durationMs: performance.now() - llmStart,
			})

			totalInputTokens += Number.isFinite(response.usage?.inputTokens)
				? response.usage.inputTokens
				: 0
			totalOutputTokens += Number.isFinite(response.usage?.outputTokens)
				? response.usage.outputTokens
				: 0
			totalCost += Number.isFinite(response.cost?.totalCost) ? response.cost.totalCost : 0

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
					rememberTrace(recorder.finish())
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

	async function checkApprovalGate(tc: ToolCall): Promise<ToolExecutionResult | null> {
		if (!approvalGate) return null
		if (
			!shouldRequireApproval(config.guardrails?.approval?.requireApprovalFor, {
				toolName: tc.name,
			})
		)
			return null

		const decision = await approvalGate.requestApproval('tool_call', `Execute tool: ${tc.name}`, {
			toolName: tc.name,
			arguments: tc.arguments,
		})
		if (decision.approved) return null

		return {
			success: false,
			error: `Tool call denied: ${decision.reason ?? 'Approval denied'}`,
			toolCallId: tc.id,
			durationMs: 0,
		}
	}

	function checkRuntimePolicy(tc: ToolCall, options: AgentRunOptions): void {
		if (!runtimePolicy) return
		runtimePolicy.evaluateToolCall({
			toolName: tc.name,
			toolArguments: tc.arguments,
			model: config.model,
			actor: options.metadata?.actor as string | undefined,
			role: options.metadata?.role as string | undefined,
		})
	}

	async function executeSingleToolCall(
		tc: ToolCall,
		options: AgentRunOptions,
	): Promise<ToolExecutionResult> {
		const denied = await checkApprovalGate(tc)
		if (denied) return denied

		checkRuntimePolicy(tc, options)

		const tool = toolMap.get(tc.name)
		if (!tool) {
			return {
				success: false,
				error: `Unknown tool: ${tc.name}. Available: ${Array.from(toolMap.keys()).join(', ')}`,
				toolCallId: tc.id,
				durationMs: 0,
			}
		}

		return tool.execute(tc.arguments, { toolCallId: tc.id, signal: options.signal })
	}

	async function executeToolCalls(
		toolCalls: ToolCall[],
		history: AgentResult['toolCalls'],
		options: AgentRunOptions = {},
	) {
		const results = []

		for (const tc of toolCalls) {
			const safeArgs = redactToolArguments(tc.arguments)
			const safeTc = safeArgs === tc.arguments ? tc : { ...tc, arguments: safeArgs }
			await safeHook(() => config.hooks?.onToolCall?.({ name: safeTc.name, arguments: safeArgs }))
			const result = await executeSingleToolCall(safeTc, options)
			await safeHook(() => config.hooks?.onToolResult?.(result))
			history.push({ name: safeTc.name, arguments: safeArgs, result })
			results.push(formatToolResult(result))
		}

		return results
	}

	const baseAgent: Agent = {
		name: config.name,
		config,

		// Placeholders — overridden by withVerifiers wrapper below
		withVerifier: undefined as unknown as Agent['withVerifier'],
		withRetryPolicy: undefined as unknown as Agent['withRetryPolicy'],
		runResumable: undefined as unknown as Agent['runResumable'],
		resume: undefined as unknown as Agent['resume'],

		getTrace(traceId: string) {
			return traces.get(traceId)
		},

		listTraces() {
			return Array.from(traces.values())
		},

		async replayFrom(traceId: string, opts) {
			const trace = traces.get(traceId)
			if (!trace) {
				throw ElsiumError.validation(
					`Agent "${config.name}" has no trace recorded for traceId "${traceId}"`,
				)
			}
			const normalizedOverrides: Record<string, StepOverride> = {}
			for (const [key, ov] of Object.entries(opts.overrides ?? {})) {
				if ('prompt' in ov && typeof ov.prompt === 'string') {
					const newPrompt = ov.prompt
					normalizedOverrides[key] = {
						kind: 'transform',
						input: (req: unknown) => ({
							...(req as CompletionRequest),
							system: newPrompt,
						}),
					}
				} else {
					normalizedOverrides[key] = ov as StepOverride
				}
			}
			return replayFrom(trace, {
				fromStep: opts.fromStep,
				overrides: normalizedOverrides,
				executor: async ({ key, input, originalStep }) => {
					if (key.startsWith('llm:')) {
						return resolvedDeps.complete(input as CompletionRequest)
					}
					return originalStep?.output
				},
			})
		},

		askHuman<TOption extends string = string>(
			options: AskHumanOptions<TOption> & { timeout?: string | number },
		) {
			const { timeout, ...rest } = options as AskHumanOptions<TOption> & {
				timeout?: string | number
				timeoutMs?: string | number
			}
			return askHuman<TOption>({
				...(rest as AskHumanOptions<TOption>),
				timeoutMs: (timeout ?? rest.timeoutMs) as number | undefined,
			})
		},

		async run(input: string, options: AgentRunOptions = {}): Promise<AgentResult> {
			const prepared = await prepareInput(input)

			if (config.states && config.initialState) {
				return executeStateMachine(
					config,
					{ states: config.states, initialState: config.initialState },
					resolvedDeps,
					prepared,
					options,
				)
			}

			const userMessage: Message = { role: 'user', content: prepared }
			return executeLoop([userMessage], options)
		},

		async generate<T>(
			input: string,
			schema: z.ZodType<T>,
			options: AgentRunOptions = {},
		): Promise<AgentGenerateResult<T>> {
			const prepared = await prepareInput(input)

			const jsonSchema = zodToJsonSchema(schema)
			const schemaInstruction = [
				'You MUST respond with valid JSON matching this schema:',
				JSON.stringify(jsonSchema, null, 2),
				'Respond ONLY with the JSON object, no markdown or explanation.',
			].join('\n')

			const augmentedInput = `${prepared}\n\n${schemaInstruction}`
			const userMessage: Message = { role: 'user', content: augmentedInput }
			const agentResult = await executeLoop([userMessage], options)

			const text = extractText(agentResult.message.content)
			const cleaned = text.replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/gm, '$1').trim()
			const jsonMatch = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
			if (!jsonMatch) {
				throw ElsiumError.validation('Agent response did not contain valid JSON')
			}

			const parsed = schema.safeParse(JSON.parse(jsonMatch[0]))
			if (!parsed.success) {
				throw ElsiumError.validation('Agent response did not match schema', {
					errors: parsed.error.issues,
				})
			}

			return { data: parsed.data, result: agentResult }
		},

		stream(input: string, options: AgentRunOptions = {}): AgentStream {
			validateInputText(input)
			// Streaming applies synchronous input redaction only; the async
			// injectionClassifier is skipped (it would block stream construction).
			const prepared = redactInputText(input)

			const streamDeps = resolvedDeps as StreamingAgentDependencies
			if (!streamDeps.stream) {
				throw ElsiumError.validation(
					'Streaming requires a stream function in agent dependencies. ' +
						'Pass { complete, stream } or use a provider that supports streaming.',
				)
			}

			const userMessage: Message = { role: 'user', content: prepared }
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
			// Run the input guardrail pipeline on each user-role message. Redaction
			// only replaces string content; multimodal (ContentPart[]) content is
			// validated but left intact to avoid dropping non-text parts.
			const preparedMessages: Message[] = []
			for (const msg of messages) {
				if (msg.role !== 'user') {
					preparedMessages.push(msg)
					continue
				}
				const text = extractText(msg.content)
				const prepared = await prepareInput(text)
				if (typeof msg.content === 'string' && prepared !== text) {
					preparedMessages.push({ ...msg, content: prepared })
				} else {
					preparedMessages.push(msg)
				}
			}

			// State machine mode
			if (config.states && config.initialState) {
				const inputText = preparedMessages
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

			return executeLoop(preparedMessages, options)
		},

		resetMemory() {
			memory.clear()
		},
	}

	return withVerifiers(baseAgent, [], {})
}
