import { DEFAULT_SELF_CONSISTENCY_CONCURRENCY, DEFAULT_SELF_CONSISTENCY_SAMPLES } from './defaults'
import type {
	CalibratedScore,
	ConfidenceSample,
	ConfidenceStrategy,
	GenerateSample,
	Voter,
} from './types'
import { createMajorityVoter } from './voters'

export interface SelfConsistencyOptions<T> {
	samples?: number
	voter?: Voter<T>
	concurrency?: number
}

async function runConcurrent<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
	const results: T[] = new Array(tasks.length)
	let next = 0
	const workers: Promise<void>[] = []

	const claim = async (): Promise<void> => {
		while (true) {
			const idx = next++
			if (idx >= tasks.length) return
			results[idx] = await tasks[idx]()
		}
	}

	for (let i = 0; i < Math.min(concurrency, tasks.length); i++) workers.push(claim())
	await Promise.all(workers)
	return results
}

export function selfConsistency<T>(options: SelfConsistencyOptions<T> = {}): ConfidenceStrategy<T> {
	const n = options.samples ?? DEFAULT_SELF_CONSISTENCY_SAMPLES
	const voter = options.voter ?? createMajorityVoter<T>()
	const concurrency = options.concurrency ?? Math.min(n, DEFAULT_SELF_CONSISTENCY_CONCURRENCY)

	if (n < 1 || !Number.isInteger(n)) {
		throw new Error('selfConsistency: samples must be a positive integer')
	}

	return {
		name: `self-consistency(${n},${voter.name})`,
		async score(generate: GenerateSample<T>): Promise<CalibratedScore<T>> {
			const tasks = Array.from({ length: n }, () => generate)
			const samples: ConfidenceSample<T>[] = await runConcurrent(tasks, concurrency)
			const vote = await voter.vote(samples)

			return {
				value: vote.winner,
				confidence: vote.confidence,
				strategy: this.name,
				samples,
				details: { voter: voter.name, ...vote.details },
			}
		},
	}
}
