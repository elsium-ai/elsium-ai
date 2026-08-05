import {
	ElsiumError,
	type FlowDecision,
	type FlowTracker,
	type Middleware,
	type Origin,
	type TaintLabel,
	createLabel,
} from '@elsium-ai/core'

/**
 * Classifies message content as it enters the context.
 *
 * Defaults are deliberately conservative: `system` is operator-authored and
 * therefore trusted, `assistant` is model output, and `user` is untrusted —
 * a user message is data, never instructions, no matter what it says.
 */
export type MessageClassifier = (message: {
	role: string
	text: string
}) => Partial<{ classes: readonly string[]; origin: Origin; source: string }> | undefined

const ROLE_ORIGIN: Record<string, Origin> = {
	system: 'trusted',
	assistant: 'model',
	user: 'untrusted',
	tool: 'untrusted',
}

export interface FlowMiddlewareConfig {
	tracker: FlowTracker
	/**
	 * Classify each message beyond the role default — e.g. tag a message
	 * containing an API key as `secret`. Return undefined to keep the default.
	 */
	classify?: MessageClassifier
	/**
	 * Called instead of throwing. Return a response to substitute one, or
	 * rethrow to abort. Without it, a denial throws.
	 */
	onDeny?: (decision: FlowDecision) => void
}

function textOf(content: unknown): string {
	if (typeof content === 'string') return content
	if (!Array.isArray(content)) return ''
	return content
		.map((part) =>
			typeof part === 'object' && part !== null && 'text' in part
				? String((part as { text: unknown }).text)
				: '',
		)
		.join(' ')
}

/**
 * Record every message's provenance, then check the accumulated label before
 * the request leaves for the provider.
 *
 * The sink is `llm:<provider>`, so a rule can keep EU-classified data off a
 * US-hosted model without knowing anything about the prompt's contents.
 */
export function flowMiddleware(config: FlowMiddlewareConfig): Middleware {
	const { tracker, classify, onDeny } = config

	return async (ctx, next) => {
		for (const message of ctx.request.messages ?? []) {
			const text = textOf(message.content)
			const override = classify?.({ role: message.role, text })
			const label: TaintLabel = createLabel({
				origin: override?.origin ?? ROLE_ORIGIN[message.role] ?? 'untrusted',
				classes: override?.classes,
				source: override?.source ?? `message:${message.role}`,
			})
			tracker.record(label)
		}

		const decision = tracker.check(`llm:${ctx.provider}`)
		if (!decision.allowed) {
			if (onDeny) {
				onDeny(decision)
			} else {
				throw ElsiumError.validation(`Flow denied: ${decision.reason}`, {
					rule: decision.rule,
					sink: decision.sink,
					label: decision.label,
				})
			}
		}

		const response = await next(ctx)

		// Model output inherits the context it was produced from: it cannot be
		// cleaner than what it read.
		tracker.record(createLabel({ origin: 'model', source: `llm:${ctx.provider}` }))

		return response
	}
}
