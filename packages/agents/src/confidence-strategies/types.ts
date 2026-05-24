import type { LLMResponse } from '@elsium-ai/core'

export interface ConfidenceSample<T> {
	value: T
	raw?: LLMResponse
	metadata?: Record<string, unknown>
}

export interface CalibratedScore<T> {
	value: T
	confidence: number
	strategy: string
	samples?: ConfidenceSample<T>[]
	details?: Record<string, unknown>
}

export type GenerateSample<T> = () => Promise<ConfidenceSample<T>>

export interface ConfidenceStrategy<T> {
	readonly name: string
	score(generate: GenerateSample<T>): Promise<CalibratedScore<T>>
}

export interface VoteResult<T> {
	winner: T
	confidence: number
	details?: Record<string, unknown>
}

export interface Voter<T> {
	readonly name: string
	vote(samples: ConfidenceSample<T>[]): VoteResult<T> | Promise<VoteResult<T>>
}

export interface Judge<T> {
	readonly name: string
	score(value: T, raw?: LLMResponse): Promise<{ score: number; reason?: string }>
}
