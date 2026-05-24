import {
	type CapabilityCheckReason,
	type CapabilityToken,
	type CapabilityVerifier,
	type DataClass,
	type Middleware,
	canCallLLM,
} from '@elsium-ai/core'
import { ElsiumError } from '@elsium-ai/core'
import { calculateCost } from './pricing'

export interface CapabilityDenialEvent {
	tokenId: string
	subject: string
	provider: string
	model: string
	reason: CapabilityCheckReason | undefined
	detail?: string
}

export interface CapabilityMiddlewareOptions {
	token: CapabilityToken
	verifier?: CapabilityVerifier
	dataClasses?: DataClass[]
	estimateInputTokens?: (input: string) => number
	onDeny?: (event: CapabilityDenialEvent) => void
}

const DEFAULT_TOKEN_ESTIMATOR = (text: string): number => Math.ceil(text.length / 4)

function extractInputText(
	messages: { content: string | { type: string; text?: string }[] }[],
): string {
	let total = ''
	for (const msg of messages) {
		if (typeof msg.content === 'string') {
			total += msg.content
		} else {
			for (const part of msg.content) {
				if (part.type === 'text' && part.text) total += part.text
			}
		}
	}
	return total
}

function buildDenial(
	options: CapabilityMiddlewareOptions,
	provider: string,
	model: string,
	reason: CapabilityCheckReason | undefined,
	detail: string | undefined,
): ElsiumError {
	if (options.onDeny) {
		options.onDeny({
			tokenId: options.token.tokenId,
			subject: options.token.subject.agent,
			provider,
			model,
			reason,
			detail,
		})
	}
	return new ElsiumError({
		code: 'AUTH_ERROR',
		message: `capability denied for LLM call: ${reason}${detail ? ` — ${detail}` : ''}`,
		retryable: false,
		provider,
		metadata: { tokenId: options.token.tokenId, reason },
	})
}

export function capabilityMiddleware(options: CapabilityMiddlewareOptions): Middleware {
	const estimator = options.estimateInputTokens ?? DEFAULT_TOKEN_ESTIMATOR

	return async (ctx, next) => {
		if (options.verifier) {
			const tokenCheck = options.verifier.verifyToken(options.token)
			if (!tokenCheck.valid) {
				throw buildDenial(options, ctx.provider, ctx.model, tokenCheck.reason, tokenCheck.detail)
			}
		}

		const inputText = extractInputText(ctx.request.messages)
		const inputTokens = estimator(inputText)
		const maxOutputTokens = ctx.request.maxTokens ?? 4096
		const estimated = calculateCost(ctx.model, {
			inputTokens,
			outputTokens: maxOutputTokens,
			totalTokens: inputTokens + maxOutputTokens,
		})

		const scopeCheck = canCallLLM(options.token, {
			provider: ctx.provider,
			model: ctx.model,
			estimatedCost: estimated.totalCost,
			estimatedTokens: inputTokens + maxOutputTokens,
		})

		if (!scopeCheck.allowed) {
			throw buildDenial(options, ctx.provider, ctx.model, scopeCheck.reason, scopeCheck.detail)
		}

		return next(ctx)
	}
}
