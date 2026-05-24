import {
	type CapabilityCheckResult,
	type CapabilityToken,
	type CapabilityVerifier,
	type DataClass,
	canCallTool,
} from '@elsium-ai/core'
import type { Tool, ToolContext, ToolExecutionResult } from './define'

export interface CapabilityDenialEvent {
	toolName: string
	tokenId: string
	subject: string
	reason: CapabilityCheckResult['reason']
	detail?: string
}

export interface CapabilityGuardOptions {
	token: CapabilityToken
	verifier?: CapabilityVerifier
	dataClasses?: DataClass[]
	onDeny?: (event: CapabilityDenialEvent) => void
}

function denialResult<TOutput>(
	tool: Tool<unknown, TOutput>,
	reason: CapabilityCheckResult['reason'],
	detail: string | undefined,
	context: Partial<ToolContext> = {},
): ToolExecutionResult<TOutput> {
	return {
		success: false,
		error: `capability denied: ${reason}${detail ? ` — ${detail}` : ''}`,
		toolCallId: context.toolCallId ?? `denied_${Date.now()}`,
		durationMs: 0,
	}
}

function emitDenial(
	tool: Tool<unknown, unknown>,
	token: CapabilityToken,
	check: CapabilityCheckResult,
	onDeny?: (event: CapabilityDenialEvent) => void,
): void {
	if (!onDeny) return
	onDeny({
		toolName: tool.name,
		tokenId: token.tokenId,
		subject: token.subject.agent,
		reason: check.reason,
		detail: check.detail,
	})
}

export function withCapability<TInput, TOutput>(
	tool: Tool<TInput, TOutput>,
	options: CapabilityGuardOptions,
): Tool<TInput, TOutput> {
	const { token, verifier, dataClasses, onDeny } = options
	const inner = tool

	return {
		get name() {
			return inner.name
		},
		get description() {
			return inner.description
		},
		get inputSchema() {
			return inner.inputSchema
		},
		get outputSchema() {
			return inner.outputSchema
		},
		get rawSchema() {
			return inner.rawSchema
		},
		get timeoutMs() {
			return inner.timeoutMs
		},
		get sandbox() {
			return inner.sandbox
		},

		toDefinition: () => inner.toDefinition(),
		dispose: inner.dispose ? () => inner.dispose?.() ?? Promise.resolve() : undefined,

		async execute(input, context) {
			if (verifier) {
				const tokenCheck = verifier.verifyToken(token)
				if (!tokenCheck.valid) {
					const denial: CapabilityCheckResult = {
						allowed: false,
						reason: tokenCheck.reason,
						detail: tokenCheck.detail,
					}
					emitDenial(inner as Tool<unknown, unknown>, token, denial, onDeny)
					return denialResult(
						inner as Tool<unknown, TOutput>,
						denial.reason,
						denial.detail,
						context,
					)
				}
			}

			const scopeCheck = canCallTool(token, inner.name, { input, dataClasses })
			if (!scopeCheck.allowed) {
				emitDenial(inner as Tool<unknown, unknown>, token, scopeCheck, onDeny)
				return denialResult(
					inner as Tool<unknown, TOutput>,
					scopeCheck.reason,
					scopeCheck.detail,
					context,
				)
			}

			return inner.execute(input, context)
		},
	}
}
