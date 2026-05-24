import { DEFAULT_JUDGE_AGGREGATOR } from './defaults'
import type { CalibratedScore, ConfidenceStrategy, GenerateSample, Judge } from './types'

export type EnsembleAggregator = 'mean' | 'median' | 'min'

export interface JudgeEnsembleOptions<T> {
	judges: Judge<T>[]
	aggregator?: EnsembleAggregator
}

function aggregate(scores: number[], mode: EnsembleAggregator): number {
	if (scores.length === 0) return 0
	if (mode === 'min') return Math.min(...scores)
	if (mode === 'median') {
		const sorted = [...scores].sort((a, b) => a - b)
		const mid = Math.floor(sorted.length / 2)
		return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
	}
	return scores.reduce((s, v) => s + v, 0) / scores.length
}

export function judgeEnsemble<T>(options: JudgeEnsembleOptions<T>): ConfidenceStrategy<T> {
	if (!options.judges?.length) {
		throw new Error('judgeEnsemble: requires at least one judge')
	}
	const aggregator: EnsembleAggregator = options.aggregator ?? DEFAULT_JUDGE_AGGREGATOR

	return {
		name: `judge-ensemble(${options.judges.length},${aggregator})`,
		async score(generate: GenerateSample<T>): Promise<CalibratedScore<T>> {
			const sample = await generate()
			const judgments = await Promise.all(
				options.judges.map(async (judge) => {
					const result = await judge.score(sample.value, sample.raw)
					return { judge: judge.name, score: result.score, reason: result.reason }
				}),
			)
			const confidence = aggregate(
				judgments.map((j) => j.score),
				aggregator,
			)

			return {
				value: sample.value,
				confidence,
				strategy: this.name,
				samples: [sample],
				details: { aggregator, judgments },
			}
		},
	}
}
