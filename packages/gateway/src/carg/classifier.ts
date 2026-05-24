import type { CompletionRequest, LLMResponse } from '@elsium-ai/core'
import type { LLMClassifier, RequestClassification } from './types'

const REASONING_KEYWORDS =
	/\b(prove|explain why|analyze|compare|contrast|evaluate|critique|debate|reason|deduce|infer|justify|argue|synthesize|hypothesize|derive)\b/i

const CODE_KEYWORDS =
	/\b(implement|refactor|debug|optimize|architect|design pattern|algorithm|data structure|write code|code review|fix the bug|type system)\b/i

const CREATIVE_KEYWORDS =
	/\b(write a (story|essay|poem|article|report|paper)|compose|draft|create a (plan|proposal|strategy))\b/i

const MATH_KEYWORDS =
	/\b(calculate|compute|solve|equation|integral|derivative|matrix|probability|statistical|proof|theorem|formula)\b/i

function extractText(request: CompletionRequest): string {
	const parts: string[] = []
	for (const m of request.messages) {
		if (typeof m.content === 'string') parts.push(m.content)
		else if (Array.isArray(m.content)) {
			for (const p of m.content) if (p.type === 'text') parts.push(p.text)
		}
	}
	if (request.system) parts.push(request.system)
	return parts.join(' ')
}

function heuristicDomain(text: string): string | undefined {
	if (CODE_KEYWORDS.test(text)) return 'code'
	if (MATH_KEYWORDS.test(text)) return 'math'
	if (REASONING_KEYWORDS.test(text)) return 'reasoning'
	if (CREATIVE_KEYWORDS.test(text)) return 'creative'
	return undefined
}

function computeShapeScore(request: CompletionRequest, totalChars: number): number {
	let score = 0
	if (totalChars > 2000) score += 0.3
	if (totalChars > 5000) score += 0.2
	if (request.tools?.length) score += 0.2
	if ((request.tools?.length ?? 0) > 3) score += 0.1
	if (request.system && request.system.length > 500) score += 0.1
	if (request.messages.length > 10) score += 0.1
	return score
}

function computeKeywordScore(text: string): number {
	let score = 0
	if (REASONING_KEYWORDS.test(text)) score += 0.5
	if (CODE_KEYWORDS.test(text)) score += 0.5
	if (CREATIVE_KEYWORDS.test(text)) score += 0.2
	if (MATH_KEYWORDS.test(text)) score += 0.5
	return score
}

function computeTotalChars(request: CompletionRequest): number {
	return request.messages.reduce((sum, m) => {
		const len = typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length
		return sum + len
	}, 0)
}

export function createHeuristicClassifier(): LLMClassifier {
	return {
		name: 'heuristic',
		classify(request: CompletionRequest): RequestClassification {
			const totalChars = computeTotalChars(request)
			const text = extractText(request)
			const score = computeShapeScore(request, totalChars) + computeKeywordScore(text)
			const difficulty = Math.min(score, 1)
			return {
				difficulty,
				domain: heuristicDomain(text),
				reason: `len=${totalChars}, tools=${request.tools?.length ?? 0}, msgs=${request.messages.length}`,
			}
		},
	}
}

const CLASSIFIER_SYSTEM = `You are a request difficulty classifier. Given the user's request, output ONLY a JSON object with this shape:
{"difficulty": <number between 0 and 1>, "domain": "<short domain label>"}

Rules:
- difficulty=0 → trivial (greeting, simple fact lookup, short paraphrase)
- difficulty=0.3 → easy reasoning, short answers, well-known topics
- difficulty=0.6 → multi-step reasoning, technical detail, ambiguity
- difficulty=0.9 → complex synthesis, novel problem solving, long context
- domain examples: "qa", "code", "math", "creative", "reasoning", "summarization"
Respond ONLY with the JSON. No prose, no markdown fences.`

export interface LLMClassifierOptions {
	complete: (request: CompletionRequest) => Promise<LLMResponse>
	model?: string
	maxTokens?: number
}

function parseClassification(text: string): RequestClassification | null {
	const match = text.match(/\{[\s\S]*?\}/)
	if (!match) return null
	try {
		const parsed = JSON.parse(match[0]) as Record<string, unknown>
		const difficulty = typeof parsed.difficulty === 'number' ? parsed.difficulty : Number.NaN
		if (!Number.isFinite(difficulty)) return null
		return {
			difficulty: Math.max(0, Math.min(1, difficulty)),
			domain: typeof parsed.domain === 'string' ? parsed.domain : undefined,
			reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
		}
	} catch {
		return null
	}
}

export function createLLMClassifier(options: LLMClassifierOptions): LLMClassifier {
	return {
		name: 'llm',
		async classify(request: CompletionRequest): Promise<RequestClassification> {
			const userText = extractText(request).slice(0, 4000)
			const response = await options.complete({
				messages: [{ role: 'user', content: userText }],
				system: CLASSIFIER_SYSTEM,
				model: options.model,
				maxTokens: options.maxTokens ?? 64,
				temperature: 0,
			})

			const text =
				typeof response.message.content === 'string'
					? response.message.content
					: response.message.content.map((p) => (p.type === 'text' ? p.text : '')).join('')

			const parsed = parseClassification(text)
			if (parsed) return parsed

			return {
				difficulty: 0.5,
				reason: `LLM classifier failed to parse: ${text.slice(0, 120)}`,
			}
		},
	}
}
