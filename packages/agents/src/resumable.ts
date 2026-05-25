import {
	type AgentPauseSignal,
	ElsiumError,
	type Message,
	type StateStore,
	createInMemoryStateStore,
	generateId,
	isAgentPauseSignal,
} from '@elsium-ai/core'
import type { Agent } from './agent'
import type { AgentResult, AgentRunOptions } from './types'

/**
 * Snapshot persisted to a StateStore when an agent pauses. The minimal viable
 * scope is to checkpoint at pause boundaries only — not every iteration — so
 * production users wanting full crash-recovery should plug in a StateStore
 * with stronger durability and pair it with explicit `pauseAgent()` calls
 * inside tool handlers.
 */
export interface AgentSnapshot {
	resumeToken: string
	agentName: string
	createdAt: number
	originalInput: string | Message[]
	messages: Message[]
	pausedAt: {
		reason?: string
		context?: Record<string, unknown>
	}
	options: AgentRunOptions
}

export type AgentRunOutcome =
	| { status: 'complete'; result: AgentResult }
	| {
			status: 'paused'
			resumeToken: string
			pausedAt: number
			reason?: string
			context?: Record<string, unknown>
	  }

export interface ResumableRunConfig {
	stateStore?: StateStore<AgentSnapshot>
}

export interface ResumeOptions {
	stateStore?: StateStore<AgentSnapshot>
	/** Optional follow-up message to append before continuing (e.g. carrying a human decision back to the LLM). */
	followUpMessage?: Message
}

const STATE_KEY_PREFIX = 'elsium:agent-snapshot:'

let defaultStore: StateStore<AgentSnapshot> | undefined

function resolveStore(store?: StateStore<AgentSnapshot>): StateStore<AgentSnapshot> {
	if (store) return store
	if (!defaultStore) defaultStore = createInMemoryStateStore<AgentSnapshot>()
	return defaultStore
}

function buildSnapshot(args: {
	agentName: string
	originalInput: string | Message[]
	messages: Message[]
	signal: AgentPauseSignal
	options: AgentRunOptions
}): AgentSnapshot {
	return {
		resumeToken: `${STATE_KEY_PREFIX}${generateId('resume')}`,
		agentName: args.agentName,
		createdAt: Date.now(),
		originalInput: args.originalInput,
		messages: args.messages,
		pausedAt: { reason: args.signal.reason, context: args.signal.context },
		options: args.options,
	}
}

function pausedOutcome(snapshot: AgentSnapshot): AgentRunOutcome {
	return {
		status: 'paused',
		resumeToken: snapshot.resumeToken,
		pausedAt: snapshot.createdAt,
		reason: snapshot.pausedAt.reason,
		context: snapshot.pausedAt.context,
	}
}

export async function runResumable(
	agent: Agent,
	input: string | Message[],
	options: AgentRunOptions = {},
	config: ResumableRunConfig = {},
): Promise<AgentRunOutcome> {
	const store = resolveStore(config.stateStore)
	try {
		const result =
			typeof input === 'string' ? await agent.run(input, options) : await agent.chat(input, options)
		return { status: 'complete', result }
	} catch (error) {
		if (!isAgentPauseSignal(error)) throw error
		const messages: Message[] =
			typeof input === 'string' ? [{ role: 'user', content: input }] : [...input]
		const snapshot = buildSnapshot({
			agentName: agent.name,
			originalInput: input,
			messages,
			signal: error,
			options,
		})
		await store.save(snapshot.resumeToken, snapshot)
		return pausedOutcome(snapshot)
	}
}

export async function resumeAgent(
	agent: Agent,
	resumeToken: string,
	options: ResumeOptions = {},
): Promise<AgentRunOutcome> {
	const store = resolveStore(options.stateStore)
	const snapshot = await store.load(resumeToken)
	if (!snapshot) {
		throw new ElsiumError({
			code: 'VALIDATION_ERROR',
			message: `resumeAgent: no snapshot found for resumeToken "${resumeToken}"`,
			retryable: false,
		})
	}
	if (snapshot.agentName !== agent.name) {
		throw new ElsiumError({
			code: 'VALIDATION_ERROR',
			message: `resumeAgent: snapshot belongs to agent "${snapshot.agentName}", got "${agent.name}"`,
			retryable: false,
		})
	}

	const continuation: Message[] = [...snapshot.messages]
	if (options.followUpMessage) continuation.push(options.followUpMessage)

	try {
		const result = await agent.chat(continuation, snapshot.options)
		await store.delete(resumeToken)
		return { status: 'complete', result }
	} catch (error) {
		if (!isAgentPauseSignal(error)) throw error
		const next = buildSnapshot({
			agentName: agent.name,
			originalInput: snapshot.originalInput,
			messages: continuation,
			signal: error,
			options: snapshot.options,
		})
		await store.save(next.resumeToken, next)
		await store.delete(resumeToken)
		return pausedOutcome(next)
	}
}
