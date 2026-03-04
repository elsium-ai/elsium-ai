import type { CompletionRequest, LLMResponse } from '@elsium-ai/core'
import type { Tracer } from './tracer'

export function instrumentComplete(
	complete: (request: CompletionRequest) => Promise<LLMResponse>,
	tracer: Tracer,
): (request: CompletionRequest) => Promise<LLMResponse> {
	return async (request: CompletionRequest): Promise<LLMResponse> => {
		const span = tracer.startSpan('llm.complete', 'llm')

		span.setMetadata('model', request.model ?? 'default')
		span.setMetadata('messageCount', request.messages.length)

		try {
			const response = await complete(request)

			span.setMetadata('inputTokens', response.usage.inputTokens)
			span.setMetadata('outputTokens', response.usage.outputTokens)
			span.setMetadata('totalCost', response.cost.totalCost)
			span.setMetadata('provider', response.provider)
			span.setMetadata('latencyMs', response.latencyMs)

			tracer.trackLLMCall({
				model: response.model,
				inputTokens: response.usage.inputTokens,
				outputTokens: response.usage.outputTokens,
				cost: response.cost.totalCost,
				latencyMs: response.latencyMs,
			})

			span.end({ status: 'ok' })
			return response
		} catch (error) {
			span.setMetadata('error', error instanceof Error ? error.message : String(error))
			span.end({ status: 'error' })
			throw error
		}
	}
}

export interface InstrumentableAgent {
	readonly name: string
	run(input: string, options?: Record<string, unknown>): Promise<unknown>
}

export function instrumentAgent<T extends InstrumentableAgent>(agent: T, tracer: Tracer): T {
	const originalRun = agent.run.bind(agent)

	const instrumented = Object.create(agent) as T
	;(instrumented as Record<string, unknown>).run = async (
		input: string,
		options?: Record<string, unknown>,
	) => {
		const span = tracer.startSpan(`agent.${agent.name}`, 'agent')
		span.setMetadata('agentName', agent.name)

		try {
			const result = await originalRun(input, options)
			span.end({ status: 'ok' })
			return result
		} catch (error) {
			span.setMetadata('error', error instanceof Error ? error.message : String(error))
			span.end({ status: 'error' })
			throw error
		}
	}

	return instrumented
}
