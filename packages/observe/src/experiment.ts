import { createHash } from 'node:crypto'
import { createLogger } from '@elsium-ai/core'

const log = createLogger()

export interface ExperimentVariant {
	name: string
	weight: number
	config: Record<string, unknown>
}

export interface ExperimentResults {
	name: string
	totalAssignments: number
	variants: Record<
		string,
		{
			assignments: number
			metrics: Record<string, { sum: number; count: number; avg: number }>
		}
	>
}

export interface Experiment {
	assign(userId?: string): ExperimentVariant
	record(variant: string, metrics: Record<string, number>): void
	results(): ExperimentResults
}

export interface ExperimentConfig {
	name: string
	variants: ExperimentVariant[]
}

export function createExperiment(config: ExperimentConfig): Experiment {
	const { name, variants } = config

	if (variants.length === 0) {
		throw new Error('Experiment must have at least one variant')
	}

	const totalWeight = variants.reduce((sum, v) => sum + v.weight, 0)

	const stats: Record<
		string,
		{
			assignments: number
			metrics: Record<string, { sum: number; count: number }>
		}
	> = {}

	for (const v of variants) {
		stats[v.name] = { assignments: 0, metrics: {} }
	}

	function hashAssign(userId: string): ExperimentVariant {
		const hash = createHash('sha256').update(`${name}:${userId}`).digest()
		const value = (hash.readUInt32BE(0) % 10000) / 10000
		return pickVariant(value)
	}

	function randomAssign(): ExperimentVariant {
		const value = Math.random()
		return pickVariant(value)
	}

	function pickVariant(value: number): ExperimentVariant {
		let cumulative = 0
		for (const v of variants) {
			cumulative += v.weight / totalWeight
			if (value < cumulative) return v
		}
		return variants[variants.length - 1]
	}

	return {
		assign(userId?: string): ExperimentVariant {
			const variant = userId ? hashAssign(userId) : randomAssign()
			const s = stats[variant.name]
			if (s) s.assignments++
			log.debug('Experiment assignment', {
				experiment: name,
				variant: variant.name,
				userId,
			})
			return variant
		},

		record(variant: string, metrics: Record<string, number>): void {
			const s = stats[variant]
			if (!s) return

			for (const [key, value] of Object.entries(metrics)) {
				if (!s.metrics[key]) {
					s.metrics[key] = { sum: 0, count: 0 }
				}
				s.metrics[key].sum += value
				s.metrics[key].count++
			}
		},

		results(): ExperimentResults {
			let totalAssignments = 0
			const variantResults: ExperimentResults['variants'] = {}

			for (const [vName, s] of Object.entries(stats)) {
				totalAssignments += s.assignments
				const metricsResult: Record<string, { sum: number; count: number; avg: number }> = {}
				for (const [key, m] of Object.entries(s.metrics)) {
					metricsResult[key] = {
						sum: m.sum,
						count: m.count,
						avg: m.count > 0 ? m.sum / m.count : 0,
					}
				}
				variantResults[vName] = {
					assignments: s.assignments,
					metrics: metricsResult,
				}
			}

			return { name, totalAssignments, variants: variantResults }
		},
	}
}
