import type { ConfidenceSample, Voter } from './types'

function canonicalize(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value)
	if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
	const keys = Object.keys(value as Record<string, unknown>).sort()
	const entries = keys.map(
		(k) => `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k])}`,
	)
	return `{${entries.join(',')}}`
}

export function createMajorityVoter<T>(): Voter<T> {
	return {
		name: 'majority',
		vote(samples) {
			const counts = new Map<string, { value: T; n: number }>()
			for (const sample of samples) {
				const key = canonicalize(sample.value)
				const existing = counts.get(key)
				if (existing) existing.n++
				else counts.set(key, { value: sample.value, n: 1 })
			}

			let bestKey = ''
			let best: { value: T; n: number } | undefined
			for (const [key, entry] of counts.entries()) {
				if (!best || entry.n > best.n) {
					best = entry
					bestKey = key
				}
			}

			const winner = (best?.value ?? samples[0]?.value) as T
			const confidence = best ? best.n / samples.length : 0
			return {
				winner,
				confidence,
				details: {
					winnerKey: bestKey,
					distribution: Array.from(counts.entries()).map(([key, entry]) => ({
						key,
						count: entry.n,
					})),
					totalSamples: samples.length,
				},
			}
		},
	}
}

export interface SimilarityVoterOptions<T> {
	similarity: (a: T, b: T) => Promise<number> | number
	threshold?: number
}

export function createSimilarityVoter<T>(options: SimilarityVoterOptions<T>): Voter<T> {
	const threshold = options.threshold ?? 0.85

	return {
		name: 'similarity-cluster',
		async vote(samples) {
			if (samples.length === 0) {
				throw new Error('similarity voter requires at least one sample')
			}

			const clusters: ConfidenceSample<T>[][] = []
			for (const sample of samples) {
				let placed = false
				for (const cluster of clusters) {
					const sim = await options.similarity(sample.value, cluster[0].value)
					if (sim >= threshold) {
						cluster.push(sample)
						placed = true
						break
					}
				}
				if (!placed) clusters.push([sample])
			}

			clusters.sort((a, b) => b.length - a.length)
			const winnerCluster = clusters[0]
			return {
				winner: winnerCluster[0].value,
				confidence: winnerCluster.length / samples.length,
				details: {
					clusterCount: clusters.length,
					winnerClusterSize: winnerCluster.length,
					totalSamples: samples.length,
				},
			}
		},
	}
}
