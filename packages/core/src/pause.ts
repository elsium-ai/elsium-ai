/**
 * Special error thrown from a tool handler to signal that the agent runtime
 * should pause execution and snapshot its state for later resumption.
 *
 * The agent's `runResumable()` catches this signal, persists a snapshot to
 * the configured StateStore, and returns `{ status: 'paused', resumeToken }`.
 * Any non-resumable execution path (plain `run()`) re-throws it like any
 * other error so misuse fails loudly.
 */
export class AgentPauseSignal extends Error {
	readonly isAgentPauseSignal = true
	readonly reason?: string
	readonly context?: Record<string, unknown>

	constructor(options: { reason?: string; context?: Record<string, unknown> } = {}) {
		super(options.reason ?? 'agent paused')
		this.name = 'AgentPauseSignal'
		this.reason = options.reason
		this.context = options.context
	}
}

export function isAgentPauseSignal(value: unknown): value is AgentPauseSignal {
	return (
		value instanceof AgentPauseSignal ||
		(typeof value === 'object' &&
			value !== null &&
			(value as { isAgentPauseSignal?: boolean }).isAgentPauseSignal === true)
	)
}

export function pauseAgent(reason?: string, context?: Record<string, unknown>): never {
	throw new AgentPauseSignal({ reason, context })
}
