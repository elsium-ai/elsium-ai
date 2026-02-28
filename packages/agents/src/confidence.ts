import type { SemanticValidationResult } from './semantic-guardrails'

// ─── Types ──────────────────────────────────────────────────────

export interface ConfidenceConfig {
	hallucinationRisk?: boolean
	relevanceScore?: boolean
	citationCoverage?: boolean
	customChecks?: Array<{
		name: string
		check: (input: string, output: string) => Promise<{ score: number; reason: string }>
	}>
}

export interface ConfidenceResult {
	overall: number
	hallucinationRisk: number
	citationCoverage: number
	relevanceScore: number
	checks: Array<{ name: string; score: number; reason: string }>
}

// ─── Factory ────────────────────────────────────────────────────

export function createConfidenceScorer(config: ConfidenceConfig): {
	score(
		input: string,
		output: string,
		semanticResult?: SemanticValidationResult,
	): Promise<ConfidenceResult>
} {
	const hallucinationEnabled = config.hallucinationRisk !== false
	const relevanceEnabled = config.relevanceScore !== false
	const citationEnabled = config.citationCoverage ?? false

	const SEMANTIC_MAP: Record<string, { enabled: boolean; outName: string; invert: boolean }> = {
		hallucination: { enabled: hallucinationEnabled, outName: 'hallucinationRisk', invert: true },
		relevance: { enabled: relevanceEnabled, outName: 'relevanceScore', invert: false },
		grounding: { enabled: citationEnabled, outName: 'citationCoverage', invert: false },
	}

	function scoreFromSemantic(semanticResult: SemanticValidationResult) {
		const checks: ConfidenceResult['checks'] = []
		const scores = { hallucinationRisk: 0, relevanceScore: 0, citationCoverage: 0 }

		for (const check of semanticResult.checks) {
			const mapping = SEMANTIC_MAP[check.name]
			if (!mapping?.enabled) continue

			const mapped = mapping.invert ? 1 - check.score : check.score
			scores[mapping.outName as keyof typeof scores] = mapped
			checks.push({ name: mapping.outName, score: mapped, reason: check.reason })
		}

		return { checks, ...scores }
	}

	function scoreFromHeuristics(input: string, output: string) {
		const checks: ConfidenceResult['checks'] = []
		const scores = { hallucinationRisk: 0, relevanceScore: 0, citationCoverage: 0 }

		if (hallucinationEnabled) {
			const hr = computeHallucinationRisk(input, output)
			scores.hallucinationRisk = hr.score
			checks.push({ name: 'hallucinationRisk', ...hr })
		}
		if (relevanceEnabled) {
			const rel = computeRelevance(input, output)
			scores.relevanceScore = rel.score
			checks.push({ name: 'relevanceScore', ...rel })
		}
		if (citationEnabled) {
			checks.push({
				name: 'citationCoverage',
				score: 0,
				reason: 'No RAG context available for citation coverage',
			})
		}

		return { checks, ...scores }
	}

	async function score(
		input: string,
		output: string,
		semanticResult?: SemanticValidationResult,
	): Promise<ConfidenceResult> {
		const base = semanticResult
			? scoreFromSemantic(semanticResult)
			: scoreFromHeuristics(input, output)

		// Run custom checks
		if (config.customChecks) {
			for (const custom of config.customChecks) {
				const result = await custom.check(input, output)
				base.checks.push({ name: custom.name, score: result.score, reason: result.reason })
			}
		}

		const overall =
			base.checks.length > 0
				? base.checks.reduce((sum, c) => sum + c.score, 0) / base.checks.length
				: 0

		return {
			overall,
			hallucinationRisk: base.hallucinationRisk,
			citationCoverage: base.citationCoverage,
			relevanceScore: base.relevanceScore,
			checks: base.checks,
		}
	}

	return { score }
}

// ─── Heuristics ─────────────────────────────────────────────────

function computeHallucinationRisk(
	input: string,
	output: string,
): { score: number; reason: string } {
	// Heuristic: check word overlap between input context and output
	// Higher overlap → lower hallucination risk
	const inputWords = new Set(
		input
			.toLowerCase()
			.split(/\s+/)
			.filter((w) => w.length > 3),
	)
	const outputWords = output
		.toLowerCase()
		.split(/\s+/)
		.filter((w) => w.length > 3)

	if (outputWords.length === 0 || inputWords.size === 0) {
		return { score: 0.5, reason: 'Insufficient text for hallucination estimation' }
	}

	const overlap = outputWords.filter((w) => inputWords.has(w)).length
	const overlapRatio = overlap / outputWords.length

	// Hallucination risk: lower overlap → higher risk
	const risk = 1 - Math.min(overlapRatio * 2, 1)

	return {
		score: risk,
		reason:
			risk > 0.5
				? 'Output has low overlap with input — potential hallucination'
				: 'Output appears grounded in input context',
	}
}

function computeRelevance(input: string, output: string): { score: number; reason: string } {
	const inputWords = new Set(
		input
			.toLowerCase()
			.split(/\s+/)
			.filter((w) => w.length > 3),
	)
	const outputWords = output
		.toLowerCase()
		.split(/\s+/)
		.filter((w) => w.length > 3)

	if (outputWords.length === 0 || inputWords.size === 0) {
		return { score: 0, reason: 'Insufficient text for relevance estimation' }
	}

	const overlap = outputWords.filter((w) => inputWords.has(w)).length
	const score = Math.min(overlap / Math.max(inputWords.size, 1), 1)

	return {
		score,
		reason:
			score >= 0.5 ? 'Output is relevant to input' : 'Output may not be relevant to the input',
	}
}
