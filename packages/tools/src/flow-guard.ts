import type { FlowDecision, FlowTracker, Origin } from '@elsium-ai/core'
import { createLabel } from '@elsium-ai/core'
import type { Tool, ToolContext, ToolExecutionResult } from './define'

export interface FlowGuardOptions {
	tracker: FlowTracker
	/**
	 * Sink identity for this tool. Defaults to `tool:<name>`.
	 *
	 * Set it to something more specific when the tool reaches a known
	 * destination — `network:api.stripe.com` lets one rule govern every tool
	 * that talks to that host, rather than enumerating tool names.
	 */
	sink?: string
	/**
	 * Classes this tool's output carries. A tool that reads customer records
	 * should declare `['pii']` so downstream sinks see it.
	 */
	outputClasses?: readonly string[]
	/**
	 * Trust level of the tool's output. Defaults to `untrusted` — a tool
	 * result is data returned by something outside the operator's control,
	 * even when the tool itself is trusted.
	 */
	outputOrigin?: Origin
	onDeny?: (decision: FlowDecision) => void
}

function denialResult<TOutput>(
	decision: FlowDecision,
	context: Partial<ToolContext> = {},
): ToolExecutionResult<TOutput> {
	return {
		success: false,
		error: `Flow denied: ${decision.reason}`,
		toolCallId: context.toolCallId ?? 'unknown',
		durationMs: 0,
	}
}

/**
 * Gate a tool on the accumulated provenance of the context it runs in.
 *
 * This is the half that capability tokens cannot cover. A token asks "may this
 * agent call `send_email`?" and the answer is yes — it is a legitimate tool
 * the agent is meant to use. This asks a different question: given everything
 * that has entered the context by now, may data reach that destination at all?
 *
 * When a poisoned document convinces the model to call `send_email` with a
 * secret in the body, the capability check passes and this one does not.
 *
 * Denial returns an unsuccessful `ToolExecutionResult` rather than throwing,
 * matching `withCapability` — the agent loop sees a failed tool call and can
 * carry on, which keeps a blocked exfiltration attempt from crashing the run.
 */
export function withFlowControl<TInput, TOutput>(
	tool: Tool<TInput, TOutput>,
	options: FlowGuardOptions,
): Tool<TInput, TOutput> {
	const { tracker, outputClasses, outputOrigin, onDeny } = options
	const inner = tool
	const sink = options.sink ?? `tool:${tool.name}`

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
		get sideEffectLevel() {
			return inner.sideEffectLevel
		},

		toDefinition: () => inner.toDefinition(),
		dispose: inner.dispose ? () => inner.dispose?.() ?? Promise.resolve() : undefined,

		async execute(input, context): Promise<ToolExecutionResult<TOutput>> {
			const decision = tracker.check(sink)
			if (!decision.allowed) {
				onDeny?.(decision)
				return denialResult<TOutput>(decision, context)
			}

			const result = await inner.execute(input, context)

			// Whatever came back is now part of the context. Record it before
			// anything downstream can read it.
			if (result.success) {
				tracker.record(
					createLabel({
						classes: outputClasses,
						origin: outputOrigin ?? 'untrusted',
						source: `tool:${inner.name}`,
					}),
				)
			}

			return result
		},
	}
}
