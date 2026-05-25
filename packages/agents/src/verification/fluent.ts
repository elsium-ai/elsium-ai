import { ElsiumError } from '@elsium-ai/core'
import type { Agent, AgentGenerateResult } from '../agent'
import { resumeAgent, runResumable } from '../resumable'
import type { AgentResult, AgentRunOptions } from '../types'
import { runWithVerification } from './runner'
import type { Validator, VerificationOutcome } from './types'

export interface AgentRetryPolicy {
	maxAttempts?: number
	semantic?: boolean
}

const DEFAULT_AGENT_RETRY_POLICY: Required<AgentRetryPolicy> = {
	maxAttempts: 3,
	semantic: true,
}

function buildRepairedInput(input: string, repairPrompt?: string): string {
	if (!repairPrompt) return input
	return `${input}\n\nThe previous attempt failed verification:\n${repairPrompt}\n\nProduce a corrected response.`
}

function unwrap<T>(outcome: VerificationOutcome<T>, agentName: string): T {
	if (outcome.status === 'ok' || outcome.status === 'repaired') return outcome.value
	const reasons =
		outcome.history[outcome.history.length - 1]?.outcome.failures
			.map((f) => `${f.validator}: ${f.reason}`)
			.join('; ') ?? 'unrecoverable'
	throw new ElsiumError({
		code: 'VALIDATION_ERROR',
		message: `Agent "${agentName}" verification failed after ${outcome.attempts} attempts: ${reasons}`,
		retryable: false,
		metadata: { attempts: outcome.attempts, status: outcome.status },
	})
}

export function withVerifiers(
	base: Agent,
	verifiers: Validator<AgentResult>[],
	policy: AgentRetryPolicy = {},
): Agent {
	const effectivePolicy: Required<AgentRetryPolicy> = {
		...DEFAULT_AGENT_RETRY_POLICY,
		...policy,
	}

	async function verifiedRun(
		input: string,
		options: AgentRunOptions | undefined,
		invoke: (input: string, options?: AgentRunOptions) => Promise<AgentResult>,
	): Promise<AgentResult> {
		if (verifiers.length === 0) return invoke(input, options)
		const outcome = await runWithVerification<AgentResult>(
			async (repair) => invoke(buildRepairedInput(input, repair?.repairPrompt), options),
			{ validators: verifiers, maxRepairs: Math.max(effectivePolicy.maxAttempts - 1, 0) },
		)
		return unwrap(outcome, base.name)
	}

	const wrapped: Agent = {
		name: base.name,
		config: base.config,
		resetMemory: () => base.resetMemory(),

		run(input: string, options?: AgentRunOptions): Promise<AgentResult> {
			return verifiedRun(input, options, (i, o) => base.run(i, o))
		},

		async generate<T>(
			input: string,
			schema: import('zod').z.ZodType<T>,
			options?: AgentRunOptions,
		): Promise<AgentGenerateResult<T>> {
			if (verifiers.length === 0) return base.generate(input, schema, options)
			let captured: AgentGenerateResult<T> | undefined
			const outcome = await runWithVerification<AgentResult>(
				async (repair) => {
					const inputWithRepair = buildRepairedInput(input, repair?.repairPrompt)
					captured = await base.generate(inputWithRepair, schema, options)
					return captured.result
				},
				{ validators: verifiers, maxRepairs: Math.max(effectivePolicy.maxAttempts - 1, 0) },
			)
			unwrap(outcome, base.name)
			if (!captured) {
				throw new ElsiumError({
					code: 'VALIDATION_ERROR',
					message: `Agent "${base.name}" verification produced no captured generate result`,
					retryable: false,
				})
			}
			return captured
		},

		stream: (input, options) => base.stream(input, options),

		chat(messages, options) {
			return base.chat(messages, options)
		},

		withVerifier(verifier: Validator<AgentResult>) {
			return withVerifiers(base, [...verifiers, verifier], effectivePolicy)
		},

		withRetryPolicy(next: AgentRetryPolicy) {
			return withVerifiers(base, verifiers, { ...effectivePolicy, ...next })
		},

		runResumable(input, options, config) {
			return runResumable(wrapped, input, options, config)
		},

		resume(resumeToken, options) {
			return resumeAgent(wrapped, resumeToken, options)
		},

		getTrace(traceId) {
			return base.getTrace(traceId)
		},

		listTraces() {
			return base.listTraces()
		},

		replayFrom(traceId, opts) {
			return base.replayFrom(traceId, opts)
		},
	}

	return wrapped
}
