import { describe, expect, it } from 'vitest'
import { createConfidenceScorer } from './confidence'
import type { SemanticValidationResult } from './semantic-guardrails'

describe('createConfidenceScorer', () => {
	describe('with semantic result', () => {
		it('maps hallucination score to hallucinationRisk (inverted)', async () => {
			const scorer = createConfidenceScorer({ hallucinationRisk: true })
			const semanticResult: SemanticValidationResult = {
				valid: true,
				checks: [{ name: 'hallucination', passed: true, score: 0.9, reason: 'No hallucinations' }],
			}

			const result = await scorer.score('input', 'output', semanticResult)
			expect(result.hallucinationRisk).toBeCloseTo(0.1)
			expect(result.checks.find((c) => c.name === 'hallucinationRisk')?.score).toBeCloseTo(0.1)
		})

		it('maps relevance score directly', async () => {
			const scorer = createConfidenceScorer({ relevanceScore: true })
			const semanticResult: SemanticValidationResult = {
				valid: true,
				checks: [{ name: 'relevance', passed: true, score: 0.85, reason: 'Relevant' }],
			}

			const result = await scorer.score('input', 'output', semanticResult)
			expect(result.relevanceScore).toBeCloseTo(0.85)
		})

		it('maps grounding score to citationCoverage', async () => {
			const scorer = createConfidenceScorer({ citationCoverage: true })
			const semanticResult: SemanticValidationResult = {
				valid: true,
				checks: [{ name: 'grounding', passed: true, score: 0.75, reason: 'Grounded' }],
			}

			const result = await scorer.score('input', 'output', semanticResult)
			expect(result.citationCoverage).toBeCloseTo(0.75)
		})

		it('computes overall as average of all checks', async () => {
			const scorer = createConfidenceScorer({
				hallucinationRisk: true,
				relevanceScore: true,
			})
			const semanticResult: SemanticValidationResult = {
				valid: true,
				checks: [
					{ name: 'hallucination', passed: true, score: 0.8, reason: 'OK' },
					{ name: 'relevance', passed: true, score: 0.6, reason: 'OK' },
				],
			}

			const result = await scorer.score('input', 'output', semanticResult)
			// hallucinationRisk = 1 - 0.8 = 0.2, relevanceScore = 0.6
			// overall = (0.2 + 0.6) / 2 = 0.4
			expect(result.overall).toBeCloseTo(0.4)
		})
	})

	describe('without semantic result (heuristic mode)', () => {
		it('computes hallucination risk based on word overlap', async () => {
			const scorer = createConfidenceScorer({ hallucinationRisk: true, relevanceScore: false })

			// High overlap → low hallucination risk
			const result = await scorer.score(
				'TypeScript programming language features types interfaces',
				'TypeScript offers strong typing with interfaces and types for programming',
			)
			expect(result.hallucinationRisk).toBeLessThan(0.8)
			expect(result.checks).toHaveLength(1)
		})

		it('computes relevance score based on word overlap', async () => {
			const scorer = createConfidenceScorer({ hallucinationRisk: false, relevanceScore: true })

			const result = await scorer.score(
				'Tell me about machine learning algorithms',
				'Machine learning uses various algorithms like neural networks',
			)
			expect(result.relevanceScore).toBeGreaterThan(0)
			expect(result.checks).toHaveLength(1)
		})

		it('returns zero citation coverage without RAG context', async () => {
			const scorer = createConfidenceScorer({
				hallucinationRisk: false,
				relevanceScore: false,
				citationCoverage: true,
			})

			const result = await scorer.score('input', 'output')
			expect(result.citationCoverage).toBe(0)
		})

		it('handles empty input gracefully', async () => {
			const scorer = createConfidenceScorer({ hallucinationRisk: true, relevanceScore: true })
			const result = await scorer.score('', 'Some output text')
			expect(result.overall).toBeDefined()
			expect(typeof result.overall).toBe('number')
		})

		it('handles empty output gracefully', async () => {
			const scorer = createConfidenceScorer({ hallucinationRisk: true, relevanceScore: true })
			const result = await scorer.score('Some input text', '')
			expect(result.overall).toBeDefined()
		})
	})

	describe('custom checks', () => {
		it('runs custom check functions', async () => {
			const scorer = createConfidenceScorer({
				hallucinationRisk: false,
				relevanceScore: false,
				customChecks: [
					{
						name: 'tone',
						check: async (_input, output) => ({
							score: output.includes('please') ? 1 : 0.5,
							reason: output.includes('please') ? 'Polite tone' : 'Neutral tone',
						}),
					},
				],
			})

			const result = await scorer.score('Ask nicely', 'Could you please help me?')
			expect(result.checks.find((c) => c.name === 'tone')?.score).toBe(1)
		})

		it('includes custom checks in overall average', async () => {
			const scorer = createConfidenceScorer({
				hallucinationRisk: false,
				relevanceScore: false,
				customChecks: [
					{
						name: 'always-high',
						check: async () => ({ score: 1.0, reason: 'Perfect' }),
					},
					{
						name: 'always-low',
						check: async () => ({ score: 0.0, reason: 'Bad' }),
					},
				],
			})

			const result = await scorer.score('input', 'output')
			expect(result.overall).toBeCloseTo(0.5)
		})
	})

	describe('disabled checks', () => {
		it('skips hallucination when disabled', async () => {
			const scorer = createConfidenceScorer({ hallucinationRisk: false })
			const result = await scorer.score('input', 'output')
			expect(result.checks.find((c) => c.name === 'hallucinationRisk')).toBeUndefined()
		})

		it('skips relevance when disabled', async () => {
			const scorer = createConfidenceScorer({ relevanceScore: false })
			const result = await scorer.score('input', 'output')
			expect(result.checks.find((c) => c.name === 'relevanceScore')).toBeUndefined()
		})
	})
})
