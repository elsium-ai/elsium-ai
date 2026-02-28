import { describe, expect, it } from 'vitest'
import { createSemanticValidator } from './semantic-guardrails'

describe('createSemanticValidator', () => {
	describe('hallucination check (heuristic)', () => {
		it('should pass when output is grounded in context', async () => {
			const validator = createSemanticValidator({
				hallucination: {
					enabled: true,
					ragContext: [
						'The capital of France is Paris.',
						'Paris has a population of about 2 million.',
					],
					threshold: 0.5,
				},
			})

			const result = await validator.checkHallucination(
				'Paris is the capital of France with a population of around 2 million people.',
				['The capital of France is Paris.', 'Paris has a population of about 2 million.'],
			)

			expect(result.passed).toBe(true)
			expect(result.score).toBeGreaterThan(0)
		})

		it('should fail when output is not grounded', async () => {
			const validator = createSemanticValidator({
				hallucination: {
					enabled: true,
					ragContext: ['The weather today is sunny.'],
					threshold: 0.7,
				},
			})

			const result = await validator.checkHallucination(
				'Quantum computing will revolutionize artificial intelligence and machine learning algorithms significantly.',
				['The weather today is sunny.'],
			)

			expect(result.passed).toBe(false)
		})

		it('should pass with empty context', async () => {
			const validator = createSemanticValidator({
				hallucination: { enabled: true, ragContext: [] },
			})

			const result = await validator.checkHallucination('Any output here.', [])
			expect(result.passed).toBe(true)
		})
	})

	describe('relevance check (heuristic)', () => {
		it('should pass when output is relevant', async () => {
			const validator = createSemanticValidator({
				relevance: { enabled: true, threshold: 0.2 },
			})

			const result = await validator.checkRelevance(
				'What is the weather like today?',
				'The weather today is sunny and warm with temperatures around 75 degrees.',
			)

			expect(result.passed).toBe(true)
		})

		it('should fail when output is irrelevant', async () => {
			const validator = createSemanticValidator({
				relevance: { enabled: true, threshold: 0.8 },
			})

			const result = await validator.checkRelevance(
				'What is the weather?',
				'Quantum physics describes the behavior of subatomic particles at extremely small scales.',
			)

			expect(result.passed).toBe(false)
		})
	})

	describe('grounding check (heuristic)', () => {
		it('should pass when output is grounded', async () => {
			const validator = createSemanticValidator({
				grounding: {
					enabled: true,
					sources: ['Python is a programming language. It was created by Guido van Rossum.'],
				},
			})

			const result = await validator.checkGrounding(
				'Python is a programming language created by Guido van Rossum.',
				['Python is a programming language. It was created by Guido van Rossum.'],
			)

			expect(result.passed).toBe(true)
		})

		it('should pass with empty sources', async () => {
			const validator = createSemanticValidator({
				grounding: { enabled: true, sources: [] },
			})

			const result = await validator.checkGrounding('Any text.', [])
			expect(result.passed).toBe(true)
		})
	})

	describe('validate', () => {
		it('should run all enabled checks', async () => {
			const validator = createSemanticValidator({
				hallucination: {
					enabled: true,
					ragContext: ['Cats are animals.'],
					threshold: 0.3,
				},
				relevance: { enabled: true, threshold: 0.1 },
			})

			const result = await validator.validate(
				'Tell me about cats.',
				'Cats are wonderful animals that make great pets.',
			)

			expect(result.checks).toHaveLength(2)
			expect(result.checks.find((c) => c.name === 'hallucination')).toBeDefined()
			expect(result.checks.find((c) => c.name === 'relevance')).toBeDefined()
		})

		it('should skip disabled checks', async () => {
			const validator = createSemanticValidator({
				hallucination: { enabled: false },
				relevance: { enabled: true, threshold: 0.1 },
			})

			const result = await validator.validate('Hello', 'Hi there!')
			expect(result.checks).toHaveLength(1)
			expect(result.checks[0].name).toBe('relevance')
		})

		it('should run custom checks', async () => {
			const validator = createSemanticValidator({
				customChecks: [
					{
						name: 'no-profanity',
						check: async (_input, output) => ({
							passed: !output.toLowerCase().includes('bad_word'),
							score: 1,
							reason: 'No profanity detected',
						}),
					},
				],
			})

			const result = await validator.validate('Hello', 'This is a clean response.')
			expect(result.valid).toBe(true)
			expect(result.checks).toHaveLength(1)
			expect(result.checks[0].name).toBe('no-profanity')
		})
	})
})
