import type { Message } from '@elsium-ai/core'
import type { Agent } from './agent'
import type { AgentResult, AgentRunOptions } from './types'

export interface MultiAgentConfig {
	agents: Agent[]
	strategy: 'sequential' | 'parallel' | 'supervisor'
	supervisor?: Agent
}

export async function runSequential(
	agents: Agent[],
	input: string,
	options?: AgentRunOptions,
): Promise<AgentResult[]> {
	const results: AgentResult[] = []
	let currentInput = input

	for (const agent of agents) {
		const result = await agent.run(currentInput, options)
		results.push(result)

		const outputText = typeof result.message.content === 'string' ? result.message.content : ''
		currentInput = outputText
	}

	return results
}

export async function runParallel(
	agents: Agent[],
	input: string,
	options?: AgentRunOptions,
): Promise<AgentResult[]> {
	return Promise.all(agents.map((agent) => agent.run(input, options)))
}

export async function runSupervisor(
	supervisor: Agent,
	workers: Agent[],
	input: string,
	options?: AgentRunOptions,
): Promise<AgentResult> {
	const workerDescriptions = workers
		.map((w) => `- ${w.name}: ${w.config.system.slice(0, 100)}`)
		.join('\n')

	const supervisorInput = [
		'You are coordinating the following workers:',
		workerDescriptions,
		'',
		`User request: ${input}`,
		'',
		'Decide which worker(s) to delegate to and synthesize their results.',
	].join('\n')

	return supervisor.run(supervisorInput, options)
}
