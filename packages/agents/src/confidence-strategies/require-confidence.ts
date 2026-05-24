import type { CalibratedScore, ConfidenceStrategy, GenerateSample } from './types'

export type BelowThresholdAction<T> =
	| 'abort'
	| 'escalate'
	| ((ctx: { value: T; confidence: number; score: CalibratedScore<T> }) => Promise<
			CalibratedScore<T>
	  >)

export interface RequireConfidenceOptions<T> {
	strategy: ConfidenceStrategy<T>
	min: number
	below?: BelowThresholdAction<T>
	onLowConfidence?: (score: CalibratedScore<T>) => void
}

export type RequireConfidenceStatus = 'ok' | 'escalated' | 'aborted'

export interface RequireConfidenceResult<T> {
	status: RequireConfidenceStatus
	value: T | undefined
	confidence: number
	score: CalibratedScore<T>
	escalatedScore?: CalibratedScore<T>
}

export class ConfidenceTooLowError extends Error {
	readonly confidence: number
	readonly min: number
	readonly score: CalibratedScore<unknown>

	constructor(score: CalibratedScore<unknown>, min: number) {
		super(`confidence ${score.confidence.toFixed(3)} is below required ${min}`)
		this.name = 'ConfidenceTooLowError'
		this.confidence = score.confidence
		this.min = min
		this.score = score
	}
}

export async function requireConfidence<T>(
	generate: GenerateSample<T>,
	options: RequireConfidenceOptions<T>,
): Promise<RequireConfidenceResult<T>> {
	if (!Number.isFinite(options.min) || options.min < 0 || options.min > 1) {
		throw new Error('requireConfidence: min must be a finite number in [0, 1]')
	}

	const initial = await options.strategy.score(generate)
	if (initial.confidence >= options.min) {
		return {
			status: 'ok',
			value: initial.value,
			confidence: initial.confidence,
			score: initial,
		}
	}

	options.onLowConfidence?.(initial)
	const action: BelowThresholdAction<T> = options.below ?? 'abort'

	if (action === 'abort') {
		throw new ConfidenceTooLowError(initial as CalibratedScore<unknown>, options.min)
	}

	if (action === 'escalate') {
		return {
			status: 'escalated',
			value: initial.value,
			confidence: initial.confidence,
			score: initial,
		}
	}

	const escalated = await action({
		value: initial.value,
		confidence: initial.confidence,
		score: initial,
	})
	return {
		status: escalated.confidence >= options.min ? 'ok' : 'escalated',
		value: escalated.value,
		confidence: escalated.confidence,
		score: initial,
		escalatedScore: escalated,
	}
}
