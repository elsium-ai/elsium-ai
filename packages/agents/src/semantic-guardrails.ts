import type { CompletionRequest, LLMResponse } from '@elsium-ai/core'
import { extractText } from '@elsium-ai/core'

export interface SemanticGuardrailConfig {
	hallucination?: {
		enabled: boolean
		ragContext?: string[]
		threshold?: number
	}
	relevance?: {
		enabled: boolean
		threshold?: number
	}
	grounding?: {
		enabled: boolean
		sources?: string[]
	}
	customChecks?: SemanticCheck[]
	autoRetry?: {
		enabled: boolean
		maxRetries?: number
	}
}

export interface SemanticCheck {
	name: string
	check: (input: string, output: string) => Promise<SemanticCheckResult>
}

export interface SemanticCheckResult {
	passed: boolean
	score: number
	reason: string
}

export interface SemanticValidationResult {
	valid: boolean
	checks: Array<{
		name: string
		passed: boolean
		score: number
		reason: string
	}>
}

export type LLMComplete = (request: CompletionRequest) => Promise<LLMResponse>

export interface SemanticValidator {
	validate(input: string, output: string): Promise<SemanticValidationResult>
	checkHallucination(output: string, context: string[]): Promise<SemanticCheckResult>
	checkRelevance(input: string, output: string): Promise<SemanticCheckResult>
	checkGrounding(output: string, sources: string[]): Promise<SemanticCheckResult>
}

export function createSemanticValidator(
	config: SemanticGuardrailConfig,
	llmComplete?: LLMComplete,
): SemanticValidator {
	async function checkHallucination(
		output: string,
		context: string[],
	): Promise<SemanticCheckResult> {
		if (!context.length) {
			return { passed: true, score: 1, reason: 'No context provided for hallucination check' }
		}

		if (llmComplete) {
			const response = await llmComplete({
				messages: [
					{
						role: 'user',
						content: `You are a hallucination detector. Given the following context and output, determine if the output contains claims not supported by the context.

Context:
${context.join('\n---\n')}

Output to check:
${output}

Respond with a JSON object: {"score": <0-1 where 1 means no hallucination>, "hallucinated_claims": [<list of unsupported claims>]}
Only respond with JSON, nothing else.`,
					},
				],
				temperature: 0,
			})

			try {
				const text = extractText(response.message.content)
				const jsonMatch = text.match(/\{[\s\S]*\}/)
				if (jsonMatch) {
					const parsed = JSON.parse(jsonMatch[0])
					const score = parsed.score ?? 0.5
					const threshold = config.hallucination?.threshold ?? 0.7
					const claims = parsed.hallucinated_claims ?? []
					return {
						passed: score >= threshold,
						score,
						reason:
							claims.length > 0
								? `Hallucinated claims: ${claims.join('; ')}`
								: 'No hallucinations detected',
					}
				}
			} catch {
				// fallback to heuristic
			}
		}

		// Heuristic fallback: check if output terms appear in context
		const contextText = context.join(' ').toLowerCase()
		const outputSentences = output.split(/[.!?]+/).filter((s) => s.trim().length > 10)
		let supported = 0

		for (const sentence of outputSentences) {
			const words = sentence
				.toLowerCase()
				.split(/\s+/)
				.filter((w) => w.length > 3)
			const matchCount = words.filter((w) => contextText.includes(w)).length
			if (matchCount / Math.max(words.length, 1) > 0.3) {
				supported++
			}
		}

		const score = outputSentences.length > 0 ? supported / outputSentences.length : 1
		const threshold = config.hallucination?.threshold ?? 0.7

		return {
			passed: score >= threshold,
			score,
			reason:
				score >= threshold
					? 'Output appears grounded in context'
					: `Only ${(score * 100).toFixed(0)}% of claims supported by context`,
		}
	}

	async function checkRelevance(input: string, output: string): Promise<SemanticCheckResult> {
		if (llmComplete) {
			const response = await llmComplete({
				messages: [
					{
						role: 'user',
						content: `Rate the relevance of this output to the input on a scale of 0 to 1.

Input: ${input}
Output: ${output}

Respond with a JSON object: {"score": <0-1>, "reason": "<brief explanation>"}
Only respond with JSON, nothing else.`,
					},
				],
				temperature: 0,
			})

			try {
				const text = extractText(response.message.content)
				const jsonMatch = text.match(/\{[\s\S]*\}/)
				if (jsonMatch) {
					const parsed = JSON.parse(jsonMatch[0])
					const score = parsed.score ?? 0.5
					const threshold = config.relevance?.threshold ?? 0.5
					return {
						passed: score >= threshold,
						score,
						reason:
							parsed.reason ??
							(score >= threshold ? 'Output is relevant' : 'Output lacks relevance'),
					}
				}
			} catch {
				// fallback to heuristic
			}
		}

		// Heuristic: word overlap between input and output
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
		const overlap = outputWords.filter((w) => inputWords.has(w)).length

		const score = outputWords.length > 0 ? Math.min(overlap / Math.max(inputWords.size, 1), 1) : 0
		const threshold = config.relevance?.threshold ?? 0.5

		return {
			passed: score >= threshold,
			score,
			reason:
				score >= threshold
					? 'Output is relevant to input'
					: 'Output may not be relevant to the input',
		}
	}

	async function checkGrounding(output: string, sources: string[]): Promise<SemanticCheckResult> {
		if (!sources.length) {
			return { passed: true, score: 1, reason: 'No sources provided for grounding check' }
		}

		if (llmComplete) {
			const response = await llmComplete({
				messages: [
					{
						role: 'user',
						content: `You are a fact checker. Check if the claims in the output are supported by the provided sources.

Sources:
${sources.join('\n---\n')}

Output to verify:
${output}

Respond with a JSON object: {"score": <0-1 where 1 means fully grounded>, "ungrounded_claims": [<list of claims not in sources>]}
Only respond with JSON, nothing else.`,
					},
				],
				temperature: 0,
			})

			try {
				const text = extractText(response.message.content)
				const jsonMatch = text.match(/\{[\s\S]*\}/)
				if (jsonMatch) {
					const parsed = JSON.parse(jsonMatch[0])
					const score = parsed.score ?? 0.5
					const claims = parsed.ungrounded_claims ?? []
					return {
						passed: score >= 0.7,
						score,
						reason:
							claims.length > 0
								? `Ungrounded claims: ${claims.join('; ')}`
								: 'All claims are grounded in sources',
					}
				}
			} catch {
				// fallback to heuristic
			}
		}

		// Heuristic: check term overlap with sources
		const sourceText = sources.join(' ').toLowerCase()
		const outputWords = output
			.toLowerCase()
			.split(/\s+/)
			.filter((w) => w.length > 4)
		const grounded = outputWords.filter((w) => sourceText.includes(w)).length
		const score = outputWords.length > 0 ? grounded / outputWords.length : 1

		return {
			passed: score >= 0.5,
			score,
			reason:
				score >= 0.5
					? 'Output appears grounded in sources'
					: 'Output contains claims not found in sources',
		}
	}

	return {
		async validate(input: string, output: string): Promise<SemanticValidationResult> {
			const checks: SemanticValidationResult['checks'] = []

			if (config.hallucination?.enabled && config.hallucination.ragContext) {
				const result = await checkHallucination(output, config.hallucination.ragContext)
				checks.push({ name: 'hallucination', ...result })
			}

			if (config.relevance?.enabled) {
				const result = await checkRelevance(input, output)
				checks.push({ name: 'relevance', ...result })
			}

			if (config.grounding?.enabled && config.grounding.sources) {
				const result = await checkGrounding(output, config.grounding.sources)
				checks.push({ name: 'grounding', ...result })
			}

			if (config.customChecks) {
				for (const customCheck of config.customChecks) {
					const result = await customCheck.check(input, output)
					checks.push({ name: customCheck.name, ...result })
				}
			}

			return {
				valid: checks.every((c) => c.passed),
				checks,
			}
		},

		checkHallucination,
		checkRelevance,
		checkGrounding,
	}
}
