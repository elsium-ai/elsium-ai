/**
 * Drift detection (O5).
 *
 * Compares output distributions between two snapshots of the same canonical
 * input set — typically "yesterday's model version" vs "today's". Reports
 * exact-match rate, length distribution shift, tool-call divergence, and
 * (optionally, via a pluggable provider) semantic similarity drift.
 *
 * Lives in @elsium-ai/observe rather than @elsium-ai/testing because it is
 * designed to run in production against sampled real traffic, not only in CI.
 *
 * Framework-agnostic about semantic similarity: the SimilarityProvider port
 * is bring-your-own (cosine over your embeddings, an LLM-as-judge, anything).
 * No embedding library is bundled.
 */

import { ElsiumError } from '@elsium-ai/core'

// ─── Sample shape ───────────────────────────────────────────────

export interface DriftSample {
	/** Stable identifier matching baseline ↔ current. Usually a hash of the input prompt. */
	readonly input: string
	readonly output: string
	readonly tokens?: number
	readonly toolCalls?: readonly string[]
}

// ─── Pluggable semantic similarity port ─────────────────────────

export interface SimilarityProvider {
	/** Return similarity in [0, 1]. Implementation is the user's choice. */
	similarity(a: string, b: string): Promise<number>
}

// ─── Configuration ──────────────────────────────────────────────

export interface DriftDetectionConfig {
	readonly baseline: readonly DriftSample[]
	readonly current: readonly DriftSample[]
	/** Optional semantic similarity provider. If absent, semantic metrics are omitted. */
	readonly similarity?: SimilarityProvider
	/** Weights for the composite overallDrift score. Defaults sum to 1. */
	readonly weights?: DriftWeights
}

export interface DriftWeights {
	readonly exactMismatch?: number
	readonly length?: number
	readonly toolCalls?: number
	readonly semantic?: number
}

const DEFAULT_WEIGHTS: Required<DriftWeights> = {
	exactMismatch: 0.4,
	length: 0.2,
	toolCalls: 0.2,
	semantic: 0.2,
}

// ─── Report shape ───────────────────────────────────────────────

export interface PerInputComparison {
	readonly input: string
	readonly baselineOutput: string
	readonly currentOutput: string
	readonly exactMatch: boolean
	readonly lengthDelta: number
	readonly similarityScore?: number
	readonly toolCallsBaseline: readonly string[]
	readonly toolCallsCurrent: readonly string[]
}

export interface DriftReport {
	readonly comparedCount: number
	readonly mismatchedInputs: readonly string[]
	readonly exactMatchRate: number
	readonly meanLengthDelta: number
	readonly meanAbsoluteLengthDelta: number
	readonly toolCallDivergence: number
	readonly meanSimilarity?: number
	readonly overallDrift: number
	readonly perInput: readonly PerInputComparison[]
}

// ─── Helpers ────────────────────────────────────────────────────

function jaccardDistance(a: readonly string[], b: readonly string[]): number {
	if (a.length === 0 && b.length === 0) return 0
	const sa = new Set(a)
	const sb = new Set(b)
	let intersection = 0
	for (const x of sa) if (sb.has(x)) intersection++
	const union = sa.size + sb.size - intersection
	if (union === 0) return 0
	return 1 - intersection / union
}

function clamp01(x: number): number {
	if (!Number.isFinite(x)) return 0
	if (x < 0) return 0
	if (x > 1) return 1
	return x
}

function normalizeWeights(w: DriftWeights | undefined): Required<DriftWeights> {
	const merged = { ...DEFAULT_WEIGHTS, ...w }
	const sum = merged.exactMismatch + merged.length + merged.toolCalls + merged.semantic
	if (sum <= 0) throw ElsiumError.validation('DriftWeights must sum to a positive number')
	return {
		exactMismatch: merged.exactMismatch / sum,
		length: merged.length / sum,
		toolCalls: merged.toolCalls / sum,
		semantic: merged.semantic / sum,
	}
}

async function computePerInput(
	baseline: DriftSample,
	current: DriftSample,
	similarity: SimilarityProvider | undefined,
): Promise<PerInputComparison> {
	const lengthDelta = current.output.length - baseline.output.length
	const exactMatch = current.output === baseline.output
	let similarityScore: number | undefined
	if (similarity) {
		const s = await similarity.similarity(baseline.output, current.output)
		similarityScore = clamp01(s)
	}
	return {
		input: baseline.input,
		baselineOutput: baseline.output,
		currentOutput: current.output,
		exactMatch,
		lengthDelta,
		similarityScore,
		toolCallsBaseline: baseline.toolCalls ?? [],
		toolCallsCurrent: current.toolCalls ?? [],
	}
}

function pairUp(
	baseline: readonly DriftSample[],
	current: readonly DriftSample[],
): { pairs: Array<[DriftSample, DriftSample]>; mismatched: string[] } {
	const currentByInput = new Map<string, DriftSample>()
	for (const c of current) currentByInput.set(c.input, c)
	const pairs: Array<[DriftSample, DriftSample]> = []
	const mismatched: string[] = []
	for (const b of baseline) {
		const c = currentByInput.get(b.input)
		if (c) {
			pairs.push([b, c])
		} else {
			mismatched.push(b.input)
		}
	}
	for (const c of current) {
		if (!baseline.some((b) => b.input === c.input)) {
			mismatched.push(c.input)
		}
	}
	return { pairs, mismatched }
}

// ─── Public API ─────────────────────────────────────────────────

export async function detectDrift(config: DriftDetectionConfig): Promise<DriftReport> {
	const weights = normalizeWeights(config.weights)

	const { pairs, mismatched } = pairUp(config.baseline, config.current)

	if (pairs.length === 0) {
		return {
			comparedCount: 0,
			mismatchedInputs: mismatched,
			exactMatchRate: 0,
			meanLengthDelta: 0,
			meanAbsoluteLengthDelta: 0,
			toolCallDivergence: 0,
			meanSimilarity: config.similarity ? 0 : undefined,
			overallDrift: 0,
			perInput: [],
		}
	}

	const perInput = await Promise.all(
		pairs.map(([b, c]) => computePerInput(b, c, config.similarity)),
	)

	const exactMatches = perInput.filter((p) => p.exactMatch).length
	const exactMatchRate = exactMatches / perInput.length

	const lengthDeltas = perInput.map((p) => p.lengthDelta)
	const meanLengthDelta = lengthDeltas.reduce((sum, d) => sum + d, 0) / lengthDeltas.length
	const meanAbsoluteLengthDelta =
		lengthDeltas.reduce((sum, d) => sum + Math.abs(d), 0) / lengthDeltas.length

	const toolCallDivergence =
		perInput.reduce((sum, p) => sum + jaccardDistance(p.toolCallsBaseline, p.toolCallsCurrent), 0) /
		perInput.length

	const meanSimilarity = config.similarity
		? perInput.reduce((sum, p) => sum + (p.similarityScore ?? 0), 0) / perInput.length
		: undefined

	// Normalize meanAbsoluteLengthDelta against the mean baseline length to keep it ∈ [0, 1].
	const meanBaselineLength = pairs.reduce((sum, [b]) => sum + b.output.length, 0) / pairs.length
	const normalizedLengthDrift =
		meanBaselineLength > 0 ? clamp01(meanAbsoluteLengthDelta / meanBaselineLength) : 0

	// Composite drift: weighted sum where higher = more drift.
	const semanticDrift = meanSimilarity !== undefined ? 1 - meanSimilarity : 0
	const overallDriftRaw =
		weights.exactMismatch * (1 - exactMatchRate) +
		weights.length * normalizedLengthDrift +
		weights.toolCalls * toolCallDivergence +
		(meanSimilarity !== undefined ? weights.semantic * semanticDrift : 0)
	const overallDrift = clamp01(
		meanSimilarity !== undefined ? overallDriftRaw : overallDriftRaw / (1 - weights.semantic), // re-normalize when semantic is absent
	)

	return {
		comparedCount: pairs.length,
		mismatchedInputs: mismatched,
		exactMatchRate,
		meanLengthDelta,
		meanAbsoluteLengthDelta,
		toolCallDivergence,
		meanSimilarity,
		overallDrift,
		perInput,
	}
}
