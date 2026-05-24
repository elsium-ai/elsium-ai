import type { LLMResponse } from '@elsium-ai/core'
import type { CalibratedScore, ConfidenceStrategy, GenerateSample } from './types'

export type LogprobAggregator = 'mean' | 'geometric-mean' | 'min'

export interface LogprobScoreOptions {
	extractLogprobs?: (raw: LLMResponse) => number[] | undefined
	aggregator?: LogprobAggregator
	fallbackConfidence?: number
}

function defaultExtractLogprobs(raw: LLMResponse): number[] | undefined {
	const metadata = raw.message.metadata as
		| { logprobs?: number[] | { token: string; logprob: number }[] }
		| undefined
	const lp = metadata?.logprobs
	if (!Array.isArray(lp)) return undefined
	if (lp.length === 0) return []
	if (typeof lp[0] === 'number') return lp as number[]
	return (lp as { logprob: number }[]).map((entry) => entry.logprob)
}

function aggregateLogprobs(logprobs: number[], mode: LogprobAggregator): number {
	if (logprobs.length === 0) return 0
	const probs = logprobs.map((lp) => Math.exp(lp))

	if (mode === 'min') return Math.min(...probs)
	if (mode === 'geometric-mean') {
		const sumLog = logprobs.reduce((s, lp) => s + lp, 0)
		return Math.exp(sumLog / logprobs.length)
	}
	return probs.reduce((s, p) => s + p, 0) / probs.length
}

export function logprobScore<T>(options: LogprobScoreOptions = {}): ConfidenceStrategy<T> {
	const extract = options.extractLogprobs ?? defaultExtractLogprobs
	const aggregator: LogprobAggregator = options.aggregator ?? 'geometric-mean'
	const fallback = options.fallbackConfidence ?? 0.5

	return {
		name: `logprob(${aggregator})`,
		async score(generate: GenerateSample<T>): Promise<CalibratedScore<T>> {
			const sample = await generate()
			const logprobs = sample.raw ? extract(sample.raw) : undefined

			if (!logprobs || logprobs.length === 0) {
				return {
					value: sample.value,
					confidence: fallback,
					strategy: this.name,
					samples: [sample],
					details: { reason: 'no logprobs available; using fallback' },
				}
			}

			const confidence = aggregateLogprobs(logprobs, aggregator)
			return {
				value: sample.value,
				confidence,
				strategy: this.name,
				samples: [sample],
				details: { aggregator, tokenCount: logprobs.length },
			}
		},
	}
}
